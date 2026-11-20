import assert from 'node:assert/strict';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { TicketCommands } from '../src/tickets/ticket-commands.js';

const db=new PrismaService();
try {
  const sample=await db.ticket.findUniqueOrThrow({where:{ticketNo:'T-001'}});
  const no='LOCK-'+crypto.randomUUID();
  const {id:_id,...fields}=sample;
  const ticket=await db.ticket.create({data:{...fields,ticketNo:no,status:'pending_assignment'}});
  const users=await Promise.all(['department_lead','operator','operator'].map((role,i)=>
    db.user.create({data:{username:no+i,displayName:role,role,departmentId:ticket.departmentId,registrationStatus:'approved'}})));
  try {
    const cmd=new TicketCommands(db);
    const results=await Promise.allSettled(users.slice(1).map(u=>
      cmd.apply(no,{source:'user',id:users[0].id},'assign',0,u.id)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(await db.ticketEvent.count({where:{ticketId:ticket.id}}),1);
    assert.equal((await db.ticket.findUniqueOrThrow({where:{id:ticket.id}})).version,1);
    console.log('两次并发派单：一次成功，一次冲突，一条事件，版本 1');
  } finally {
    await db.ticketEvent.deleteMany({where:{ticketId:ticket.id}});
    await db.ticket.delete({where:{id:ticket.id}});
    await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
  }
} finally {await db.$disconnect();}

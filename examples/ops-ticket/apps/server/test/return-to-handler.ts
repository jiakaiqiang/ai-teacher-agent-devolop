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
    const lead={source:'user' as const,id:users[0].id};
    const operator={source:'user' as const,id:users[1].id};
    const reporter={source:'user' as const,id:sample.reporterId};
    await cmd.apply(no,lead,'assign',0,operator.id);
    await cmd.apply(no,operator,'handle',1);
    await cmd.apply(no,lead,'approve',2);
    await cmd.apply(no,reporter,'unresolved',3,undefined,'故障再次出现');
    const returned=await db.ticket.findUniqueOrThrow({where:{id:ticket.id}});
    assert.equal(returned.assigneeId,operator.id);
    assert.equal(returned.status,'human_processing');
    await cmd.apply(no,operator,'handle',4);
    await cmd.apply(no,lead,'approve',5);
    await cmd.apply(no,reporter,'resolved',6);
    assert.equal(await db.ticketEvent.count({where:{ticketId:ticket.id}}),7);
    const events=await db.ticketEvent.findMany({where:{ticketId:ticket.id},orderBy:{resultingVersion:'asc'}});
    assert.deepEqual(events.map(e=>e.resultingVersion),[1,2,3,4,5,6,7]);
    console.log('退回原处理人，再处理、复核和确认完成，共七个动作');
  } finally {
    await db.ticketEvent.deleteMany({where:{ticketId:ticket.id}});
    await db.ticket.delete({where:{id:ticket.id}});
    await db.user.deleteMany({where:{id:{in:users.map(u=>u.id)}}});
  }
} finally {await db.$disconnect();}

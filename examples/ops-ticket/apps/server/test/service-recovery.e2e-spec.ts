import { spawnSync } from 'node:child_process';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { submitOperation } from '../src/agent/pending-operation.js';
import { approveOperation } from '../src/agent/approve-operation.js';
import { applyOperation } from '../src/agent/apply-operation.js';

it('确认快照与有效期约束改派，恢复进程复用预览回执',async()=>{
  const db=new PrismaService(), ticketNo='D132-'+crypto.randomUUID();
  const staffIds:string[]=[];
  try {
    const seed=await db.ticket.findUniqueOrThrow({where:{ticketNo:'T-001'}});
    const staff=await Promise.all(['department_lead','operator','operator'].map(role=>db.user.create({data:{
      role,username:crypto.randomUUID(),displayName:role,registrationStatus:'approved',departmentId:seed.departmentId}})));
    staffIds.push(...staff.map(u=>u.id));
    const [lead,first,second]=staff;
    const ticket=await db.ticket.create({data:{ticketNo,title:'改派演练',description:'已派单',
      companyId:seed.companyId,departmentId:seed.departmentId,categoryId:seed.categoryId,reporterId:seed.reporterId,
      status:'human_processing',assigneeId:first!.id}});
    const submit=(key:string,command:object)=>submitOperation(db,lead!.id,ticket.ticketNo,key,command);
    const key=crypto.randomUUID(), cmd={action:'reassign',assignee:second!.username,version:0,reason:'同部门换班'};
    const job=await submit(key,cmd);
    expect((await submit(key,cmd)).id).toBe(job.id);
    await expect(submit(key,{...cmd,reason:'改参'})).rejects.toThrow();
    await expect(approveOperation(db,lead!.id,job.id,'wrong')).rejects.toThrow();
    await approveOperation(db,lead!.id,job.id,job.digest);
    expect(await applyOperation(db,job.id)).toBe(true);
    expect(await applyOperation(db,job.id)).toBe(false);
    expect(await db.ticket.findUniqueOrThrow({where:{id:ticket.id}})).toMatchObject({version:1,assigneeId:second!.id});
    expect(await db.ticketEvent.count({where:{ticketId:ticket.id,action:'reassign'}})).toBe(1);
    const command={action:'restart',service:'diagnosis-preview',version:1,reason:'恢复预览'};
    const expired=await submit(crypto.randomUUID(),command);
    await db.$executeRaw`UPDATE operation_tasks SET valid_until=now() WHERE id=${expired.id}::uuid`;
    await expect(approveOperation(db,lead!.id,expired.id,expired.digest)).rejects.toThrow();
    const live=await submit(crypto.randomUUID(),command);
    await approveOperation(db,lead!.id,live.id,live.digest);
    for(const [flags,code] of [[['--interrupt-before-ack'],75],[[],0],[[],0]] as const) {
      const child=spawnSync(process.execPath,['dist/agent/resume-operation.js',live.id,...flags],{encoding:'utf8',timeout:10000});
      expect(child.status,child.stderr).toBe(code);
    }
    const [row]=await db.$queryRaw<{state:string;receipts:number}[]>`SELECT state,
      (SELECT count(*)::int FROM preview_receipts WHERE task_id=t.id) receipts FROM operation_tasks t WHERE t.id=${live.id}::uuid`;
    expect(row).toEqual({state:'done',receipts:1});
  }finally{
    await db.$executeRaw`DELETE FROM preview_receipts WHERE task_id IN (SELECT id FROM operation_tasks WHERE ticket_no=${ticketNo})`;
    await db.$executeRaw`DELETE FROM operation_tasks WHERE ticket_no=${ticketNo}`;
    await db.notice.deleteMany({where:{ticketNo}});
    await db.ticketEvent.deleteMany({where:{ticket:{ticketNo}}});
    await db.ticket.deleteMany({where:{ticketNo}});
    await db.user.deleteMany({where:{id:{in:staffIds}}});
    await db.$disconnect();
  }
},30000);

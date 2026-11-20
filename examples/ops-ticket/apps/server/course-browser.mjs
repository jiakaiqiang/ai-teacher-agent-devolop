import { NestFactory } from '@nestjs/core';
import { AppModule } from './dist/app.module.js';
import { configureApp } from './dist/app.setup.js';
import { PrismaService } from './dist/prisma/prisma.service.js';
import { hashPassword } from './dist/auth/password.js';
import { diagnosisQueue, diagnosisWorker } from './dist/queue/diagnosis.js';
import { deliverPending } from './dist/queue/outbox.js';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const { chromium }=await import(pathToFileURL(process.env.PLAYWRIGHT_ENTRY).href);
const { preview }=await import(pathToFileURL(process.env.VITE_ENTRY).href);
const app=await NestFactory.create(AppModule,{logger:false});
configureApp(app);await app.listen(0,'127.0.0.1');
const db=app.get(PrismaService), worker=diagnosisWorker(db), queue=diagnosisQueue();
const web=await preview({root:'../web',configFile:false,preview:{host:'127.0.0.1',port:0,proxy:{'/api':await app.getUrl()}}});
const origin='http://127.0.0.1:'+web.httpServer.address().port;
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXE,headless:true});
const current=await db.ticket.findUniqueOrThrow({where:{ticketNo:'T-001'}});
const pass=randomUUID();
const hash=await hashPassword(pass);
async function firstNotice(page,last=0){
 return page.evaluate(async last=>{
   const session=JSON.parse(sessionStorage.getItem('ops-ticket.session'));
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),6000);
   try {
     const response=await fetch('/api/notices/stream',{headers:{Authorization:'Bearer '+session.accessToken,'Last-Event-ID':String(last)},signal:controller.signal});
     if(!response.ok)throw new Error('通知 HTTP '+response.status);
     const reader=response.body.pipeThrough(new TextDecoderStream()).getReader();
     let buffer='';
     do {const {value,done}=await reader.read();if(done)throw new Error('通知流提前结束');buffer+=value;}while(!buffer.includes('\n\n'));
     const frame=buffer.split('\n\n')[0];return JSON.parse(frame.split('\n').find(l=>l.startsWith('data:')).slice(5));
   }finally{clearTimeout(timer);controller.abort();}
 },last);
}

const roles=['reporter','department_lead','operator'];
try {
 const pages={};
 for(const role of roles) {
   const user=await db.user.create({data:{username:randomUUID(),role,displayName:'演练'+role+pass.slice(0,4),registrationStatus:'approved',
     ...(role==='reporter'?{companyId:current.companyId}:{departmentId:current.departmentId}),passwordHash:hash}});
   const page=await browser.newPage();
   page.on('pageerror',error=>console.error('pageerror',error.message));
   pages[role]=page;await page.goto(origin+'/login');
   await page.getByLabel('用户名').fill(user.username);await page.getByLabel('密码').fill(pass);
   await page.getByRole('button',{name:'登录',exact:true}).click();
   await page.getByRole('heading',{name:'工单列表'}).waitFor();
 }
 const reporter=pages.reporter, lead=pages.department_lead, op=pages.operator;
 await reporter.getByRole('link',{name:'上报问题'}).click();
 await reporter.getByLabel('问题分类').selectOption({label:'网络问题'});
 await reporter.getByLabel('标题').fill('浏览器验收');await reporter.getByLabel('问题描述').fill('网络请求持续超时');await reporter.getByLabel('日志').fill('connection timeout');
 await reporter.getByRole('button',{name:'提交工单'}).click();
 await reporter.waitForURL('**/tickets/T-*');
 const detail=reporter.url(), no=new URL(detail).pathname.split('/').at(-1);
 await deliverPending(db,queue);
 const deadline=Date.now()+25000;
 while(Date.now()<deadline && (await db.ticket.findUniqueOrThrow({where:{ticketNo:no}})).status==='agent_processing') await new Promise(r=>setTimeout(r,200));
 await reporter.reload();await reporter.getByRole('button',{name:'人工接入'}).click();
 await reporter.getByText('request_human · pending_assignment',{exact:false}).first().waitFor();
 await lead.goto(detail);await lead.getByRole('combobox').selectOption({label:'演练operator'+pass.slice(0,4)});
 await lead.getByRole('button',{name:'派单',exact:true}).click();
 await lead.getByText('assign · human_processing',{exact:false}).first().waitFor();
 const first=await firstNotice(lead);
 assert.equal(first.action,'request_human');
 for(const step of [0,1]){
   await op.goto(detail);await op.getByLabel('处理或复核说明').fill(step?'调整配置并重试成功':'核查链路');
   await op.getByRole('button',{name:'提交处理结果'}).click();
   await op.getByRole('button',{name:'提交处理结果'}).waitFor({state:'hidden'});
   if(step===0) {const resumed=await firstNotice(lead,first.id);assert.ok(resumed.id>first.id);assert.equal(resumed.action,'handle');}
   await lead.goto(detail);await lead.getByRole('button',{name:'复核通过并发送'}).click();
   await lead.getByRole('button',{name:'复核通过并发送'}).waitFor({state:'hidden'});
   await reporter.goto(detail);await reporter.getByRole('button',{name:step?'已解决':'未解决',exact:true}).click();
   await reporter.getByRole('button',{name:'未解决',exact:true}).waitFor({state:'hidden'});
 }
 const row=await db.ticket.findUniqueOrThrow({where:{ticketNo:no}});
 const events=await db.ticketEvent.findMany({where:{ticketId:row.id},orderBy:{createdAt:'asc'}});
 assert.equal(row.status,'completed');assert.equal(row.version,9);
 assert.deepEqual(events.map(e=>e.toStatus),['agent_processing','handoff_offered','pending_assignment','human_processing','handled','reviewed','human_processing','handled','reviewed','completed']);
 console.log(JSON.stringify({browser:browser.version(),roles,events:events.map(e=>e.toStatus),version:row.version,notificationReconnect:true}));
}finally{await browser.close();await web.close();await worker.close();await queue.close();await app.close();}

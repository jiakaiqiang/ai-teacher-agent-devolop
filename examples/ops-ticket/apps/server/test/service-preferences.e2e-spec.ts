import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { bearer } from './login-fixtures.js';
it('跨会话保留本公司本人的偏好，删除后仍可读原工单',async()=>{
  const mod=await Test.createTestingModule({imports:[AppModule]}).compile();
  const app=mod.createNestApplication();configureApp(app);await app.init();
  try {
    const api=request(app.getHttpServer()),alice=await bearer(app),bob=await bearer(app,'wu');
    const path='/api/agent/me/preferences/handover';
    const response=await api.put(path).set('authorization',alice).send({layout:'evidence-first',days:2,expected:null}).expect(200);
    const {revision}=response.body.data;
    expect((await api.get(path).set('authorization',bob).expect(200)).body.data.preference).toBeNull();
    const original=(await api.get('/api/tickets/T-001').set('authorization',alice)).body.data.events;
    await api.delete(path+'/'+revision).set('authorization',await bearer(app)).expect(200);
    expect((await api.get(path).set('authorization',alice)).body.data.preference).toBeNull();
    expect((await api.get('/api/tickets/T-001').set('authorization',alice)).body.data.events).toEqual(original);
  }finally{await app.close();}
});

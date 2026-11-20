import { describe, expect, it } from 'vitest';
import { transition, type TicketSnapshot, type Actor } from './workflow.js';
const reporter: Actor = {id:'lin',role:'reporter',companyId:'A'};
const agent: Actor = {id:'agent',role:'agent'};
const lead: Actor = {id:'lead',role:'department_lead',departmentId:'network'};
const engineer: Actor = {id:'eng',role:'operator',departmentId:'network'};
const initial: TicketSnapshot = {status:'agent_processing',reporterId:'lin',companyId:'A',departmentId:'network',assigneeId:null};
describe('按用户意愿交接', () => {
  it('无法排查时先等用户点击，再进入负责人待派', () => {
    const offered=transition(initial,agent,'offer_handoff');
    expect(offered.status).toBe('handoff_offered');
    expect(() => transition(offered,lead,'assign',engineer)).toThrow();
    expect(transition(offered,reporter,'request_human').status).toBe('pending_assignment');
  });
  it('用户拒绝建议直接转人工；人工结果被退回时回到原人', () => {
    const advised=transition(initial,agent,'suggest');
    const pending=transition(advised,reporter,'unresolved');
    const assigned=transition(pending,lead,'assign',engineer);
    const handled=transition(assigned,engineer,'handle');
    const reviewed=transition(handled,lead,'approve');
    expect(transition(reviewed,reporter,'unresolved')).toMatchObject({status:'human_processing',assigneeId:'eng'});
    expect(transition(reviewed,reporter,'resolved').status).toBe('completed');
  });
  it('客户管理员不能验收，也不能被派单', () => {
    const admin: Actor={id:'admin',role:'customer_admin',companyId:'A'};
    expect(() => transition({...initial,status:'awaiting_feedback'},admin,'resolved')).toThrow();
    expect(() => transition({...initial,status:'pending_assignment'},lead,'assign',admin)).toThrow();
  });
});

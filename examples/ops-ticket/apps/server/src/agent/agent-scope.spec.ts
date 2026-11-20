import {agentScope} from './agent-scope.js';
it('区分本人、客户公司和承办部门',()=>{
 const user={id:'a',role:'reporter',companyId:'c',departmentId:null};
 expect(agentScope(user)).toEqual({reporterId:'a',companyId:'c'});
 expect(agentScope({...user,role:'customer_admin'})).toEqual({companyId:'c'});
 expect(agentScope({...user,role:'department_lead',departmentId:'d'})).toEqual({departmentId:'d'});
});

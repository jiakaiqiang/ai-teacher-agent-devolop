import {appendFileSync} from 'node:fs';
import {auditQuota as audit} from './quota-audit.js';
const scope={userId:'synthetic-user',period:'2026-11-17'};
const auditQuota=(input:object)=>audit({...scope,...input});
const pending={...scope,id:'p',reserved:50000,status:'pending',charged:null,inputTokens:null,outputTokens:null};
const exact={...scope,id:'e',reserved:50000,status:'exact',charged:20,inputTokens:10,outputTokens:5};
const estimated={...scope,id:'u',reserved:50000,status:'estimated',charged:50000,inputTokens:0,outputTokens:0};
describe('额度离线核账（D63）',()=>{
 it('pending占用与已结算消耗共同核对余额',()=>{const result=auditQuota({initial:200000,available:99980,rows:[pending,exact,estimated]});expect(result).toEqual({expected:99980,actual:99980,difference:0,balanced:true,pending:1,estimated:1,exact:1,needsReview:2});if(process.env.D63_EVIDENCE_FILE)appendFileSync(process.env.D63_EVIDENCE_FILE,JSON.stringify({case:'quota-audit',synthetic:true,...result})+'\n');});
 it('差额只报告不修改输入',()=>{const data={initial:200000,available:200000,rows:[exact]};const before=JSON.stringify(data);expect(auditQuota(data).difference).toBe(20);expect(auditQuota(data).balanced).toBe(false);expect(JSON.stringify(data)).toBe(before);});
 it('重复ID拒绝而不是重复计费',()=>{expect(()=>auditQuota({initial:200000,available:0,rows:[exact,exact]})).toThrow('AUDIT_DUPLICATE_ID');});
 it('精确结算必须符合教学费率',()=>{expect(()=>auditQuota({initial:200000,available:0,rows:[{...exact,charged:0}]})).toThrow('AUDIT_EXACT_MISMATCH');});
 it('估算至少包含预留和已知消耗',()=>{expect(()=>auditQuota({initial:200000,available:0,rows:[{...estimated,charged:1}]})).toThrow('AUDIT_ESTIMATE_UNDERCOUNT');});
 it('pending不能混入结算字段',()=>{expect(()=>auditQuota({initial:200000,available:0,rows:[{...pending,charged:1}]})).toThrow('AUDIT_INVALID_PENDING');});
 it('支持真实超额后的负余额',()=>{const row={...exact,charged:250000,inputTokens:250000,outputTokens:0};expect(auditQuota({initial:200000,available:-50000,rows:[row]}).balanced).toBe(true);});
 it('拒绝负数消耗和超长集合',()=>{expect(()=>auditQuota({initial:200000,available:0,rows:[{...exact,charged:-1}]})).toThrow();expect(()=>auditQuota({initial:200000,available:0,rows:Array(10001).fill(exact)})).toThrow();});
 it('不能混入其他用户或日期的流水',()=>{expect(()=>auditQuota({initial:200000,available:0,rows:[{...exact,userId:'other'}]})).toThrow('AUDIT_SCOPE');expect(()=>auditQuota({initial:200000,available:0,rows:[{...exact,period:'2026-11-18'}]})).toThrow('AUDIT_SCOPE');});
});

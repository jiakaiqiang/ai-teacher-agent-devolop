import { checkGrant } from '../diagnosis-grant.js';
import { grantRead } from './authority.js';

describe('角色授权', () => {
  it('分诊只能取摘要而复核不能读取工具', () => {
    expect(() => grantRead('triage', 'u', 'r', 'ticket_log_counts')).toThrow('没有该工具');
    expect(() => grantRead('review', 'u', 'r', 'ticket_summary')).toThrow('没有该工具');
    expect(() => grantRead('diagnosis', 'u', 'r', 'ticket_summary')).toThrow('没有该工具');
    expect(() => grantRead('diagnosis', 'u', 'r', 'ticket_log_counts')).not.toThrow();
  });
  it('单项授权仍绑定原用户和运行', () => {
    const handle = grantRead('single', 'u', 'r', 'ticket_summary');
    expect(() => checkGrant(handle, 'u', 'r', 'ticket_summary')).not.toThrow();
    expect(() => checkGrant(handle, 'u', 'other', 'ticket_summary')).toThrow();
    expect(() => checkGrant(handle, 'other', 'r', 'ticket_summary')).toThrow();
    expect(() => checkGrant(handle, 'u', 'r', 'ticket_log_counts')).toThrow();
  });
});

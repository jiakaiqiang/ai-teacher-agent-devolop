import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export type Passage = { id: string; group: string; text: string };
export type Label = { id: string; split: 'dev' | 'holdout'; family: string; group: string; query: string; relevant: string[] };
export const passages: Passage[] = [
  { id: 'vpn', group: 'shared', text: 'VPN E401：更换手机后动态口令失效。核对账户后重新绑定验证器，再尝试远程连接。' },
  { id: 'remote', group: 'A', text: '远程桌面 R17 超时：确认 VPN 已连通，再检查桌面主机是否休眠。' },
  { id: 'paper', group: 'A', text: '打印机 P21 卡纸：断开打印机电源，取出进纸通道内的纸张，再自检打印。' },
  { id: 'queue', group: 'A', text: '打印任务 Q18 停在队列但未卡纸：取消阻塞作业并恢复打印队列。' },
  { id: 'cert', group: 'A', text: '网关 C32 证书过期：核对有效期，申请续签并更新证书链。' },
  { id: 'disk', group: 'A', text: '磁盘 D09 空间告警：检查日志目录占用，按保留策略归档旧日志。' },
  { id: 'screen', group: 'A', text: '会议室投影 V24 黑屏：先切换到正确的 HDMI 输入源，再检查连接线。' },
  { id: 'dns', group: 'B', text: '内网 N72 无法解析域名：确认 DNS 地址和对应区域记录。' },
  { id: 'adapter', group: 'B', text: '投影 V90 没有供电：复核适配器与插座，联系设备组更换。' },
];
export const labels: Label[] = [
  { id:'d1',split:'dev',family:'auth',group:'A',query:'换了新手机，公司 VPN 口令不对怎么办？',relevant:['vpn'] },
  { id:'d2',split:'dev',family:'auth',group:'A',query:'E401，远程身份验证失败',relevant:['vpn'] },
  { id:'d3',split:'dev',family:'print',group:'A',query:'P21 进纸卡住怎么处理？',relevant:['paper'] },
  { id:'d4',split:'dev',family:'print',group:'A',query:'Q18 打印作业暂停，纸路检查正常',relevant:['queue'] },
  { id:'d5',split:'dev',family:'benefits',group:'A',query:'差旅报销的餐费标准是多少？',relevant:[] },
  { id:'d6',split:'dev',family:'auth',group:'B',query:'E401 动态口令重绑流程是什么？',relevant:['vpn'] },
  { id:'d7',split:'dev',family:'print',group:'A',query:'打印任务不出纸，现场还没确认是卡纸还是队列阻塞',relevant:['paper','queue'] },
  { id:'h1',split:'holdout',family:'tls',group:'A',query:'网关提示 C32 有效期已过，怎么续期？',relevant:['cert'] },
  { id:'h2',split:'holdout',family:'storage',group:'A',query:'D09 磁盘快满了，日志占用太大',relevant:['disk'] },
  { id:'h3',split:'holdout',family:'display',group:'A',query:'V24 会议室投影有电却一直黑屏',relevant:['screen'] },
  { id:'h4',split:'holdout',family:'name',group:'B',query:'N72 内网主机名字解析失败',relevant:['dns'] },
  { id:'h5',split:'holdout',family:'name',group:'A',query:'N72 内网域名解析流程',relevant:[] },
  { id:'h6',split:'holdout',family:'leave',group:'A',query:'陪产假应该在什么系统申请？',relevant:[] },
  { id:'h7',split:'holdout',family:'display',group:'B',query:'V90 投影仪电源灯不亮',relevant:['adapter'] },
];

export function validateSet(docs: Passage[], cases: Label[]) {
  const ids = new Map(docs.map(d => [d.id, d]));
  if (ids.size !== docs.length || new Set(cases.map(c => c.id)).size !== cases.length) throw Error('DUPLICATE_ID');
  const partitions = new Map<string, string>();
  for (const c of cases) {
    if (partitions.has(c.family) && partitions.get(c.family) !== c.split) throw Error('FAMILY_LEAK');
    partitions.set(c.family,c.split);
    if (new Set(c.relevant).size !== c.relevant.length) throw Error('DUPLICATE_LABEL');
    for (const key of c.relevant) {
      if (!['shared',c.group].includes(ids.get(key)?.group ?? '')) throw Error('INVALID_LABEL');
    }
  }
  return createHash('sha256').update(JSON.stringify([docs,cases])).digest('hex');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify({ digest: validateSet(passages,labels), docs: passages.length,
    dev: labels.filter(c => c.split === 'dev').length, holdout: labels.filter(c => c.split === 'holdout').length,
    noAnswer: labels.filter(c => !c.relevant.length).length }));
}

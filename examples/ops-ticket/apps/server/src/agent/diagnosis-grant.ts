import { CallError, type Name } from './tool-catalog.js';

type Bound = { userId: string; runId: string; names: ReadonlySet<Name>; expires: number };
// 引用只在本机本次运行里传递。序列化所得的空对象没有调用能力。
const grants = new WeakMap<object, Bound>();
export function issueGrant(userId: string, runId: string, names: readonly Name[], now = Date.now()) {
  const handle = Object.freeze({});
  grants.set(handle, { userId, runId, names: new Set(names), expires: now + 30_000 });
  return handle;
}
export function checkGrant(handle: object, userId: string, runId: string, name: Name, now = Date.now()) {
  const grant = grants.get(handle);
  if (!grant || now >= grant.expires || grant.userId !== userId || grant.runId !== runId || !grant.names.has(name)) {
    throw new CallError('TOOL_GRANT_INVALID');
  }
}

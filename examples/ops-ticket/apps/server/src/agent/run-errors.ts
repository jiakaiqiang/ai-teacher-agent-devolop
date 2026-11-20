// Agent 运行相关的失败只携带固定码；HTTP 状态在控制器按码映射。
export class RunFailure extends Error {
  constructor(readonly code: string) { super(code); }
}

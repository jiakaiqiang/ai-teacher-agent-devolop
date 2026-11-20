-- CreateTable
CREATE TABLE "agent_runs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "request_key" UUID NOT NULL,
    "ticket_no" VARCHAR(64) NOT NULL,
    "goal" VARCHAR(500) NOT NULL,
    "scope_hash" VARCHAR(64) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
    "stop_reason" VARCHAR(32),
    "version" INTEGER NOT NULL DEFAULT 0,
    "step_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_runs_user_id_created_at_idx" ON "agent_runs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "agent_runs_user_id_request_key_key" ON "agent_runs"("user_id", "request_key");

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 状态与停止原因的取值在库里也约束一次：应用有 bug 时写不进非法状态。
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_status_check"
    CHECK ("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled'));
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_stop_reason_check"
    CHECK ("stop_reason" IS NULL OR "stop_reason" IN ('answered', 'step_limit', 'time_limit',
        'token_limit', 'tool_failed', 'model_failed', 'user_cancelled'));
-- 终态必须有停止原因和结束时间；非终态都不允许有。
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_terminal_check"
    CHECK (("status" IN ('succeeded', 'failed', 'cancelled'))
        = ("stop_reason" IS NOT NULL AND "ended_at" IS NOT NULL));
-- queued 还没开始；running 必须有开始时间。queued 直接取消时仍然没有开始时间。
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_started_check"
    CHECK (("status" <> 'queued' OR "started_at" IS NULL)
        AND ("status" <> 'running' OR "started_at" IS NOT NULL));
-- 步数不为负。
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_step_count_check"
    CHECK ("step_count" >= 0);

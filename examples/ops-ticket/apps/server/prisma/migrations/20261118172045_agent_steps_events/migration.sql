-- AlterTable
ALTER TABLE "agent_runs" ADD COLUMN     "event_seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "agent_steps" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "phase" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'running',
    "summary" VARCHAR(500) NOT NULL DEFAULT '',
    "error_code" VARCHAR(64),
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "agent_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_events" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_id" UUID,
    "seq" INTEGER NOT NULL,
    "type" VARCHAR(32) NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_steps_run_id_ordinal_key" ON "agent_steps"("run_id", "ordinal");

-- CreateIndex
CREATE INDEX "agent_events_run_id_seq_idx" ON "agent_events"("run_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "agent_events_run_id_seq_key" ON "agent_events"("run_id", "seq");

-- AddForeignKey
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "agent_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 单步的阶段与状态取值；终态必须有结束时间，running 不能有。
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_phase_check"
    CHECK ("phase" IN ('plan', 'tool', 'answer'));
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_status_check"
    CHECK ("status" IN ('running', 'succeeded', 'failed'));
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_terminal_check"
    CHECK (("status" = 'running') = ("ended_at" IS NULL));
-- 失败才允许带错误码。
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_error_check"
    CHECK (("status" = 'failed') OR "error_code" IS NULL);
ALTER TABLE "agent_steps" ADD CONSTRAINT "agent_steps_ordinal_check"
    CHECK ("ordinal" >= 1);

-- 事件序号从 1 开始连续递增；类型取值固定。
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_seq_check" CHECK ("seq" >= 1);
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_type_check"
    CHECK ("type" IN ('run_started', 'step_started', 'step_finished', 'run_finished'));

-- CreateTable
CREATE TABLE "agent_traces" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "step_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "input" VARCHAR(2000) NOT NULL,
    "output" VARCHAR(2000) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_traces_step_id_key" ON "agent_traces"("step_id");

-- CreateIndex
CREATE INDEX "agent_traces_run_id_ordinal_idx" ON "agent_traces"("run_id", "ordinal");

-- AddForeignKey
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "agent_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 轨迹的类型取值；token 与耗时不为负；序号从 1 开始。
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_kind_check"
    CHECK ("kind" IN ('model', 'tool'));
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_tokens_check"
    CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "duration_ms" >= 0);
ALTER TABLE "agent_traces" ADD CONSTRAINT "agent_traces_ordinal_check" CHECK ("ordinal" >= 1);

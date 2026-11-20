CREATE TABLE "agent_context_packets" (
    "run_id" UUID NOT NULL REFERENCES "agent_runs"("id") ON DELETE CASCADE,
    "ordinal" INTEGER NOT NULL CHECK ("ordinal" > 0),
    "snapshot" JSONB NOT NULL,
    PRIMARY KEY ("run_id", "ordinal")
);

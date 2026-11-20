CREATE TABLE "agent_preferences" (
  "tenant_key" VARCHAR(64) NOT NULL,
  "user_id" UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "revision" UUID NOT NULL,
  "layout" VARCHAR(24) NOT NULL CHECK ("layout" IN ('summary-first', 'evidence-first')),
  "expires_at" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("tenant_key", "user_id")
);

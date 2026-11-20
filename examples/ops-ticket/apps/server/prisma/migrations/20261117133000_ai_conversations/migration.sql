-- 仅新增技术记录，不重建或删除现有业务表。
CREATE TABLE "ai_conversations" (
  "id" UUID NOT NULL, "user_id" UUID NOT NULL, "scope_hash" VARCHAR(64) NOT NULL,
  "title" VARCHAR(200) NOT NULL, "version" INTEGER NOT NULL DEFAULT 0, "active_turn_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_conversations_version_check" CHECK ("version" >= 0),
  CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ai_conversations_user_id_updated_at_idx" ON "ai_conversations"("user_id", "updated_at" DESC);
CREATE TABLE "ai_chat_turns" (
  "id" UUID NOT NULL, "conversation_id" UUID NOT NULL, "request_key" UUID NOT NULL,
  "ordinal" INTEGER NOT NULL, "question" VARCHAR(2000) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'running', "mode" VARCHAR(8),
  "transcript" JSONB NOT NULL DEFAULT '[]', "answer" TEXT NOT NULL DEFAULT '', "error_code" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "ended_at" TIMESTAMPTZ,
  CONSTRAINT "ai_chat_turns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_chat_turns_status_check" CHECK ("status" IN ('running','completed','failed')),
  CONSTRAINT "ai_chat_turns_mode_check" CHECK ("mode" IS NULL OR "mode" IN ('mock','model')),
  CONSTRAINT "ai_chat_turns_ordinal_check" CHECK ("ordinal" BETWEEN 1 AND 40),
  CONSTRAINT "ai_chat_turns_end_check" CHECK (("status" = 'running' AND "ended_at" IS NULL) OR ("status" <> 'running' AND "ended_at" IS NOT NULL)),
  CONSTRAINT "ai_chat_turns_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ai_chat_turns_conversation_id_request_key_key" ON "ai_chat_turns"("conversation_id", "request_key");
CREATE UNIQUE INDEX "ai_chat_turns_conversation_id_ordinal_key" ON "ai_chat_turns"("conversation_id", "ordinal");

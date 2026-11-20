-- 只新增表，不重置开发数据。
CREATE TABLE ai_quotas (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 period varchar(10) NOT NULL,
 available integer NOT NULL DEFAULT 200000,
 PRIMARY KEY (user_id,period)
);
CREATE TABLE ai_usage (
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL,
 period varchar(10) NOT NULL,
 request_key uuid NOT NULL,
 reserved integer NOT NULL CHECK (reserved > 0),
 charged integer CHECK (charged >= 0),
 status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','exact','estimated')),
 input_tokens integer CHECK (input_tokens >= 0),
 output_tokens integer CHECK (output_tokens >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 settled_at timestamptz,
 FOREIGN KEY (user_id,period) REFERENCES ai_quotas(user_id,period) ON DELETE RESTRICT,
 CONSTRAINT ai_usage_settlement_complete CHECK (
  (status='pending' AND charged IS NULL AND input_tokens IS NULL AND output_tokens IS NULL AND settled_at IS NULL)
  OR (status IN ('exact','estimated') AND charged IS NOT NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL AND settled_at IS NOT NULL)
 )
);
CREATE UNIQUE INDEX ai_usage_user_request_unique ON ai_usage(user_id,request_key);
CREATE INDEX ai_usage_user_id_period_idx ON ai_usage(user_id,period);

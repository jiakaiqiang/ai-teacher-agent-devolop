CREATE TABLE audit_logs(
 id uuid PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(), actor_id uuid NOT NULL REFERENCES users(id),
 actor_username varchar(64) NOT NULL,action varchar(64) NOT NULL,entity_type varchar(32) NOT NULL,
 entity_key varchar(64) NOT NULL,before jsonb,after jsonb,request_id varchar(64));
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity_type,entity_key,occurred_at);

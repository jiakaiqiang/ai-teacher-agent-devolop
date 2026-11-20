CREATE TABLE operation_tasks (
 id uuid PRIMARY KEY, request_key uuid NOT NULL, owner_id uuid NOT NULL REFERENCES users(id),
 ticket_no text NOT NULL REFERENCES tickets(ticket_no), command jsonb NOT NULL, digest text NOT NULL,
 state text NOT NULL CHECK (state IN ('waiting','ready','dispatching','done','cancelled')),
 valid_until timestamptz NOT NULL, approved_digest text, UNIQUE(owner_id,request_key)
);

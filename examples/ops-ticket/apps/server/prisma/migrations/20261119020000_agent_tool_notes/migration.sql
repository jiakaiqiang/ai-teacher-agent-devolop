CREATE TABLE agent_tool_notes (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  request_key UUID NOT NULL,
  hash VARCHAR(64) NOT NULL,
  text VARCHAR(300) NOT NULL,
  CONSTRAINT agent_tool_notes_actor_key UNIQUE (user_id, request_key)
);
CREATE INDEX agent_tool_notes_page ON agent_tool_notes (user_id, ticket_id, id);

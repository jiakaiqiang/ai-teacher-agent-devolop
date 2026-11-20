ALTER TABLE knowledge_entries
 ADD COLUMN source_ticket_id uuid REFERENCES tickets(id),
 ADD COLUMN approved_version integer,
 ADD COLUMN approved_digest text,
 ADD COLUMN reviewer_id uuid REFERENCES users(id);
CREATE UNIQUE INDEX one_solution_per_ticket ON knowledge_entries(source_ticket_id) WHERE kind='solution';

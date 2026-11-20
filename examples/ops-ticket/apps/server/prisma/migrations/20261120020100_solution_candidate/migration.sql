ALTER TABLE knowledge_entries DROP CONSTRAINT knowledge_entries_state_check;
ALTER TABLE knowledge_entries ADD CHECK (state IN ('candidate','draft','published','withdrawn'));

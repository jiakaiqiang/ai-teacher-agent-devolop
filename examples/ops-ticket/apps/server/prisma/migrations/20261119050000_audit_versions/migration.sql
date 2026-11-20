ALTER TABLE ticket_events ADD COLUMN previous_version INTEGER, ADD COLUMN resulting_version INTEGER;
ALTER TABLE ticket_events ADD CONSTRAINT event_version_pair CHECK ((previous_version IS NULL AND resulting_version IS NULL) OR (previous_version IS NOT NULL AND resulting_version=previous_version+1 AND resulting_version IS NOT NULL));

ALTER TABLE tickets ADD COLUMN request_key TEXT, ADD COLUMN request_hash TEXT;
CREATE UNIQUE INDEX tickets_reporter_id_request_key_key ON tickets(reporter_id,request_key);

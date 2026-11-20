CREATE TABLE preview_receipts(task_id uuid PRIMARY KEY REFERENCES operation_tasks(id), accepted_at timestamptz NOT NULL DEFAULT now());

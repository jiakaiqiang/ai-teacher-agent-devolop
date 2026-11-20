CREATE TABLE knowledge_entries (
  id uuid PRIMARY KEY, kind text NOT NULL CHECK (kind IN ('manual','solution')),
  company_id uuid REFERENCES companies(id), title text NOT NULL, body text NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  state text NOT NULL CHECK (state IN ('draft','published','withdrawn')),
  CHECK (kind <> 'solution' OR company_id IS NULL)
);

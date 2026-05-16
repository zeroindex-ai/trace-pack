CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source          TEXT NOT NULL,
  event           TEXT NOT NULL,
  ts              TEXT NOT NULL,
  model           TEXT,
  question        TEXT,
  question_hash   TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  retrieved_ids   TEXT,
  citation_count  INTEGER,
  retrieval_ms    INTEGER,
  first_token_ms  INTEGER,
  total_ms        INTEGER,
  error_message   TEXT,
  raw_json        TEXT NOT NULL,
  UNIQUE (source, ts, question_hash)
);

CREATE INDEX IF NOT EXISTS idx_events_source_ts
  ON events (source, ts DESC);

CREATE INDEX IF NOT EXISTS idx_events_source_outcome
  ON events (source, outcome);

CREATE INDEX IF NOT EXISTS idx_events_source_hash
  ON events (source, question_hash);

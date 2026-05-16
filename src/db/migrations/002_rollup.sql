CREATE TABLE IF NOT EXISTS rollup_daily (
  source              TEXT NOT NULL,
  day                 TEXT NOT NULL,
  events              INTEGER NOT NULL,
  ok                  INTEGER NOT NULL,
  retrieval_failed    INTEGER NOT NULL,
  stream_failed       INTEGER NOT NULL,
  aborted             INTEGER NOT NULL,
  p50_total_ms        INTEGER,
  p95_total_ms        INTEGER,
  p99_total_ms        INTEGER,
  p50_first_token_ms  INTEGER,
  p95_first_token_ms  INTEGER,
  p99_first_token_ms  INTEGER,
  avg_citations       REAL,
  PRIMARY KEY (source, day)
);

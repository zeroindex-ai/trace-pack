-- Token-bucket state for /api/ingest rate limiting. One row per client key
-- (the forwarded client IP, or a UA+Accept-Language fingerprint hash when no
-- forwarded IP is present). `tokens` is fractional because the bucket refills
-- continuously; `updated_at` is epoch milliseconds. Idempotent: the runner
-- replays every migration on each deploy.
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key        TEXT PRIMARY KEY,
  tokens     REAL NOT NULL,
  updated_at INTEGER NOT NULL
);

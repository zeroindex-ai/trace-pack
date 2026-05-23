-- 004_multi_app.sql — generalize the single, ask-shaped event model into a
-- universal core (status + tokens + cost) so trace-pack can observe any
-- Claude-based app, not just the RAG Q&A consumer. See docs/v0.2-multi-app-design.md.
--
-- NOT idempotent on its own (ALTER TABLE has no IF NOT EXISTS). The migrate()
-- runner records applied files in schema_migrations, so this runs exactly once.

-- Universal core: a coarse status axis, an app-specific reason, and the spend
-- dimension every Claude app shares (input/output + prompt-cache token classes).
ALTER TABLE events ADD COLUMN status TEXT;
ALTER TABLE events ADD COLUMN outcome_reason TEXT;
ALTER TABLE events ADD COLUMN input_tokens INTEGER;
ALTER TABLE events ADD COLUMN output_tokens INTEGER;
ALTER TABLE events ADD COLUMN cache_creation_input_tokens INTEGER;
ALTER TABLE events ADD COLUMN cache_read_input_tokens INTEGER;
ALTER TABLE events ADD COLUMN cost_usd REAL;

-- Backfill the coarse status + reason from the existing `ask` outcome vocabulary
-- (ok -> ok, aborted -> aborted, *_failed -> error + reason). See design §2.2.
UPDATE events
   SET status = CASE outcome
                  WHEN 'ok'      THEN 'ok'
                  WHEN 'aborted' THEN 'aborted'
                  ELSE 'error'
                END,
       outcome_reason = CASE
                  WHEN outcome IN ('retrieval_failed', 'stream_failed') THEN outcome
                  ELSE NULL
                END;

-- The idempotency key was misnamed: it's the dedup hash, not specifically a
-- question hash (for `ask` it's derived from the question; for other event types
-- from an idempotency key or the raw body). RENAME COLUMN updates the dependent
-- UNIQUE constraint and idx_events_source_hash automatically — no table rebuild.
-- See design §2.4.
ALTER TABLE events RENAME COLUMN question_hash TO dedup_hash;

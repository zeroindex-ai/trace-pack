-- 005_rollup_multi_app.sql — extend the daily rollup with the universal status
-- axis and the spend dimension, so the multi-app overview + spend views read
-- precomputed numbers instead of scanning raw events. See docs/v0.2-multi-app-design.md §4.
--
-- NOT idempotent on its own (ALTER TABLE has no IF NOT EXISTS); the migrate()
-- runner records applied files in schema_migrations, so this runs exactly once.

ALTER TABLE rollup_daily ADD COLUMN n_ok INTEGER;
ALTER TABLE rollup_daily ADD COLUMN n_error INTEGER;
ALTER TABLE rollup_daily ADD COLUMN n_aborted INTEGER;
ALTER TABLE rollup_daily ADD COLUMN sum_cost_usd REAL;
ALTER TABLE rollup_daily ADD COLUMN sum_input_tokens INTEGER;
ALTER TABLE rollup_daily ADD COLUMN sum_output_tokens INTEGER;

-- Status counts backfill cleanly from the existing ask outcome columns
-- (ok -> ok, retrieval_failed + stream_failed -> error, aborted -> aborted).
-- Token/cost sums can't be backfilled (no historical token data) and stay NULL
-- for pre-existing days; the next rollup run fills them going forward.
UPDATE rollup_daily
   SET n_ok      = ok,
       n_error   = retrieval_failed + stream_failed,
       n_aborted = aborted;

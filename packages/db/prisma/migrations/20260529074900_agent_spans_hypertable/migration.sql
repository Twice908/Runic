-- Convert AgentSpan into a TimescaleDB hypertable partitioned on startedAt.
-- The Prisma migration (add_pao_models) must have already created the
-- "AgentSpan" table before this runs. The composite PK @@id([id, startedAt])
-- satisfies TimescaleDB's requirement that the partition column appear in all
-- unique constraints — same pattern as RequestLog and RateLimitEvent.
SELECT create_hypertable('"AgentSpan"', 'startedAt', if_not_exists => TRUE);

-- Composite indexes for time-range scans per run and per project.
-- Prisma's migration already creates these without DESC; IF NOT EXISTS is a
-- no-op here but keeps the migration idempotent on re-deploy.
CREATE INDEX IF NOT EXISTS "AgentSpan_runId_startedAt_idx"
  ON "AgentSpan" ("runId", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentSpan_projectId_startedAt_idx"
  ON "AgentSpan" ("projectId", "startedAt" DESC);

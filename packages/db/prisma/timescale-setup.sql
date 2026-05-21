-- Enable the TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Convert RequestLog into a TimescaleDB hypertable partitioned on timestamp.
-- The Prisma migration must have already created the "RequestLog" table before running this.
SELECT create_hypertable('"RequestLog"', 'timestamp', if_not_exists => TRUE);

-- ============================================================
-- Phase 3: Continuous Aggregates for Analytics
-- ============================================================
-- NOTE: percentile_cont is an ordered-set aggregate and cannot
-- be materialized in TimescaleDB continuous aggregates on the
-- standard image (timescale/timescaledb, not timescaledb-ha).
-- P50/P90/P99 are computed in API routes directly from the
-- hypertable using time_bucket + percentile_cont on bounded
-- time ranges. All count/avg queries use these views.
-- ============================================================

-- Hourly aggregate: per project, route, and method.
-- sum_response_time is stored alongside avg so weighted averages
-- across multiple rows stay accurate (sum/count, not avg-of-avgs).
CREATE MATERIALIZED VIEW IF NOT EXISTS request_stats_hourly
WITH (timescaledb.continuous) AS
SELECT
  "projectId",
  route,
  method,
  time_bucket('1 hour', timestamp)            AS bucket,
  count(*)                                    AS request_count,
  count(*) FILTER (WHERE "statusCode" >= 400) AS error_count,
  avg("responseTime")                         AS avg_response_time,
  sum("responseTime")                         AS sum_response_time,
  min("responseTime")                         AS min_response_time,
  max("responseTime")                         AS max_response_time
FROM "RequestLog"
GROUP BY "projectId", route, method, time_bucket('1 hour', timestamp)
WITH NO DATA;

-- Refresh every 30 minutes, keeping the last 3 hours current.
SELECT add_continuous_aggregate_policy('request_stats_hourly',
  start_offset      => INTERVAL '3 hours',
  end_offset        => INTERVAL '1 minute',
  schedule_interval => INTERVAL '30 minutes',
  if_not_exists     => true
);

-- Daily aggregate: used for 6h → 7d range queries.
-- Same columns as the hourly view, different bucket width.
CREATE MATERIALIZED VIEW IF NOT EXISTS request_stats_daily
WITH (timescaledb.continuous) AS
SELECT
  "projectId",
  route,
  method,
  time_bucket('1 day', timestamp)             AS bucket,
  count(*)                                    AS request_count,
  count(*) FILTER (WHERE "statusCode" >= 400) AS error_count,
  avg("responseTime")                         AS avg_response_time,
  sum("responseTime")                         AS sum_response_time,
  min("responseTime")                         AS min_response_time,
  max("responseTime")                         AS max_response_time
FROM "RequestLog"
GROUP BY "projectId", route, method, time_bucket('1 day', timestamp)
WITH NO DATA;

-- Refresh every hour, keeping the last 3 days current.
SELECT add_continuous_aggregate_policy('request_stats_daily',
  start_offset      => INTERVAL '3 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists     => true
);

-- Composite index for projectId + time-range scans on raw data.
-- Used by latency percentile queries that must read RequestLog directly
-- and by the < 1h fallback path in all analytics routes.
CREATE INDEX IF NOT EXISTS "RequestLog_projectId_timestamp_idx"
  ON "RequestLog" ("projectId", timestamp DESC);

-- ============================================================
-- Rate Limiter: RateLimitEvent hypertable
-- ============================================================
-- Convert RateLimitEvent into a TimescaleDB hypertable partitioned
-- on timestamp. The Prisma migration must have already created the
-- "RateLimitEvent" table before running this.
SELECT create_hypertable('"RateLimitEvent"', 'timestamp', if_not_exists => TRUE);

-- Composite indexes for projectId + ruleId time-range scans
-- (used by analytics routes and top-offender queries).
CREATE INDEX IF NOT EXISTS "RateLimitEvent_projectId_timestamp_idx"
  ON "RateLimitEvent" ("projectId", timestamp DESC);
CREATE INDEX IF NOT EXISTS "RateLimitEvent_ruleId_timestamp_idx"
  ON "RateLimitEvent" ("ruleId", timestamp DESC);

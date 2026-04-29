CREATE TABLE IF NOT EXISTS event_social_metrics (
  event_id          text PRIMARY KEY,
  reaction_count    bigint NOT NULL DEFAULT 0,
  like_count        bigint NOT NULL DEFAULT 0,
  dislike_count     bigint NOT NULL DEFAULT 0,
  repost_count      bigint NOT NULL DEFAULT 0,
  zap_count         bigint NOT NULL DEFAULT 0,
  zap_total_msats   bigint NOT NULL DEFAULT 0,
  last_activity_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_social_metrics_activity
  ON event_social_metrics (last_activity_at DESC);

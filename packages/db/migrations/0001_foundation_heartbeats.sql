-- Development connectivity only. This is not the tenant/project/run data model.
CREATE TABLE foundation_heartbeats (
  service_key text PRIMARY KEY,
  last_seen_at timestamptz NOT NULL
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL,
  display_name text NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (issuer, subject)
);
CREATE TABLE organisations (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE projects (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (organisation_id, id)
);
CREATE TABLE project_memberships (
  user_id uuid NOT NULL REFERENCES users(id),
  organisation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner','editor','viewer')),
  PRIMARY KEY (user_id, project_id),
  FOREIGN KEY (organisation_id, project_id) REFERENCES projects(organisation_id, id)
);
CREATE TABLE project_tokens (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('editor','viewer')),
  token_hash text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  FOREIGN KEY (organisation_id, project_id) REFERENCES projects(organisation_id, id),
  UNIQUE (organisation_id, project_id, id)
);
CREATE TABLE scenarios (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  scenario_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organisation_id, project_id) REFERENCES projects(organisation_id, id),
  UNIQUE (organisation_id, project_id, id),
  UNIQUE (project_id, scenario_key)
);
CREATE TABLE scenario_versions (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  scenario_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  definition jsonb NOT NULL,
  definition_hash text NOT NULL CHECK (length(definition_hash) = 64),
  published_by uuid NOT NULL REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organisation_id, project_id, scenario_id) REFERENCES scenarios(organisation_id, project_id, id),
  UNIQUE (scenario_id, version_number),
  UNIQUE (organisation_id, project_id, id)
);
CREATE TABLE runs (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  scenario_version_id uuid NOT NULL,
  manifest jsonb NOT NULL,
  manifest_hash text NOT NULL CHECK (length(manifest_hash) = 64),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  created_by_user uuid REFERENCES users(id),
  created_by_token uuid,
  execution_status text NOT NULL DEFAULT 'QUEUED' CHECK (execution_status IN ('QUEUED','PREPARING','RUNNING','EVALUATING','CLEANING','FINISHED','ERROR','CANCELLED')),
  verdict text CHECK (verdict IN ('PASS','FAIL','INCONCLUSIVE','NOT_TESTED')),
  cleanup_status text NOT NULL DEFAULT 'PENDING' CHECK (cleanup_status IN ('NOT_REQUIRED','PENDING','RUNNING','COMPLETE','FAILED')),
  cancel_requested boolean NOT NULL DEFAULT false,
  fixture_attempted boolean NOT NULL DEFAULT false,
  attempt_id uuid,
  candidate_attested boolean,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  finished_at timestamptz,
  FOREIGN KEY (organisation_id, project_id, scenario_version_id) REFERENCES scenario_versions(organisation_id, project_id, id),
  FOREIGN KEY (organisation_id, project_id, created_by_token) REFERENCES project_tokens(organisation_id, project_id, id),
  CHECK ((created_by_user IS NOT NULL)::integer + (created_by_token IS NOT NULL)::integer = 1),
  UNIQUE (project_id, idempotency_key),
  UNIQUE (organisation_id, project_id, id)
);
CREATE INDEX runs_project_created_idx ON runs(project_id, created_at DESC);
CREATE TABLE run_outbox (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  run_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('RUN','CLEANUP')),
  workflow_id text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz,
  dispatched_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (organisation_id, project_id, run_id) REFERENCES runs(organisation_id, project_id, id)
);
CREATE INDEX run_outbox_pending_idx ON run_outbox(available_at) WHERE dispatched_at IS NULL;
CREATE TABLE run_evidence (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  run_id uuid NOT NULL,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  attempt_id uuid,
  kind text NOT NULL,
  source text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  payload jsonb NOT NULL,
  FOREIGN KEY (organisation_id, project_id, run_id) REFERENCES runs(organisation_id, project_id, id)
);
CREATE INDEX run_evidence_run_idx ON run_evidence(run_id, sequence);
CREATE TABLE run_assertions (
  organisation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  run_id uuid NOT NULL,
  check_id text NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (run_id, check_id),
  FOREIGN KEY (organisation_id, project_id, run_id) REFERENCES runs(organisation_id, project_id, id)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  organisation_id uuid NOT NULL,
  project_id uuid NOT NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','service')),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  resource_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  metadata jsonb NOT NULL DEFAULT '{}',
  FOREIGN KEY (organisation_id, project_id) REFERENCES projects(organisation_id, id)
);
CREATE FUNCTION reject_immutable_record_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Published versions and recorded evidence are immutable';
END;
$$;
CREATE TRIGGER scenario_versions_immutable BEFORE UPDATE OR DELETE ON scenario_versions FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER run_evidence_immutable BEFORE UPDATE OR DELETE ON run_evidence FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER run_assertions_immutable BEFORE UPDATE OR DELETE ON run_assertions FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_immutable_record_change();
CREATE FUNCTION protect_run_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.scenario_version_id IS DISTINCT FROM OLD.scenario_version_id
     OR NEW.manifest IS DISTINCT FROM OLD.manifest OR NEW.manifest_hash IS DISTINCT FROM OLD.manifest_hash
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
     OR NEW.created_by_user IS DISTINCT FROM OLD.created_by_user OR NEW.created_by_token IS DISTINCT FROM OLD.created_by_token THEN
    RAISE EXCEPTION 'Run identity and manifest are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER runs_identity_immutable BEFORE UPDATE ON runs FOR EACH ROW EXECUTE FUNCTION protect_run_identity();

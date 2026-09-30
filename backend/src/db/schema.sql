-- CallAutopsy schema

CREATE TABLE IF NOT EXISTS calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL,
  input_source TEXT NOT NULL,
  sample_id TEXT,
  injected_fault TEXT,
  stt_provider_used TEXT,
  stt_failover_occurred BOOLEAN DEFAULT FALSE,
  predicted_category TEXT,
  classifier_confidence NUMERIC,
  ab_run_id UUID,
  redacted_transcript TEXT,
  total_cost_usd NUMERIC,
  idempotency_key TEXT UNIQUE
);
ALTER TABLE calls ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE calls ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_predicted_category ON calls (predicted_category);
CREATE INDEX IF NOT EXISTS idx_calls_injected_fault ON calls (injected_fault);
CREATE INDEX IF NOT EXISTS idx_calls_ab_run_id ON calls (ab_run_id);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls (status);
CREATE INDEX IF NOT EXISTS idx_calls_stt_provider ON calls (stt_provider_used);

CREATE TABLE IF NOT EXISTS call_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id),
  stage TEXT NOT NULL,
  provider TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  raw_meta JSONB,
  cost_usd NUMERIC
);
CREATE INDEX IF NOT EXISTS idx_call_stages_call_id ON call_stages (call_id);
CREATE INDEX IF NOT EXISTS idx_call_stages_started_at ON call_stages (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_stages_provider_stage ON call_stages (provider, stage);

CREATE TABLE IF NOT EXISTS autopsy_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id UUID REFERENCES calls(id),
  report_text TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_autopsy_call_id ON autopsy_reports (call_id);

CREATE TABLE IF NOT EXISTS ab_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_a JSONB NOT NULL,
  config_b JSONB NOT NULL,
  fault_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ab_runs_created_at ON ab_runs (created_at DESC);

CREATE TABLE IF NOT EXISTS hallucination_suite_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_prompts INTEGER,
  hallucinated_count INTEGER,
  results JSONB
);
CREATE INDEX IF NOT EXISTS idx_hallucination_run_at ON hallucination_suite_runs (run_at DESC);

CREATE TABLE IF NOT EXISTS healing_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fault_type TEXT NOT NULL,
  occurrence_count INTEGER,
  suggestion_text TEXT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_healing_generated_at ON healing_suggestions (generated_at DESC);

CREATE TABLE IF NOT EXISTS sla_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  max_failure_rate_pct NUMERIC NOT NULL DEFAULT 5,
  window_minutes INTEGER NOT NULL DEFAULT 60
);

CREATE TABLE IF NOT EXISTS sla_breaches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  breached_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  observed_failure_rate_pct NUMERIC,
  notified BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_sla_breaches_breached_at ON sla_breaches (breached_at DESC);

CREATE TABLE IF NOT EXISTS user_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  fault_type TEXT,
  fault_params JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO sla_config (id, max_failure_rate_pct, window_minutes)
VALUES (1, 5, 60)
ON CONFLICT (id) DO NOTHING;

-- Per-user data isolation: every user-created call is stamped with the browser's workspace id.
-- NULL owner = system-generated (chaos / A-B / seeded demo).
ALTER TABLE calls ADD COLUMN IF NOT EXISTS owner_id UUID;
CREATE INDEX IF NOT EXISTS idx_calls_owner_started ON calls (owner_id, started_at DESC);

-- Call understanding (intent, entities, corrections, sentiment, findings) stored with the call.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS analysis JSONB;
-- A/B runs: owned by a workspace, remember which demo call they used, and tag each call with its side.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ab_side TEXT;
ALTER TABLE ab_runs ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE ab_runs ADD COLUMN IF NOT EXISTS sample_id TEXT;
ALTER TABLE ab_runs ADD COLUMN IF NOT EXISTS iterations INTEGER;
ALTER TABLE ab_runs ADD COLUMN IF NOT EXISTS fault_params JSONB;
CREATE INDEX IF NOT EXISTS idx_ab_runs_owner ON ab_runs (owner_id, created_at DESC);
-- Ops data is per workspace too.
ALTER TABLE hallucination_suite_runs ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE healing_suggestions ADD COLUMN IF NOT EXISTS owner_id UUID;
ALTER TABLE sla_breaches ADD COLUMN IF NOT EXISTS owner_id UUID;
CREATE TABLE IF NOT EXISTS workspace_sla (
  owner_id UUID PRIMARY KEY,
  max_failure_rate_pct NUMERIC NOT NULL DEFAULT 5,
  window_minutes INTEGER NOT NULL DEFAULT 60
);

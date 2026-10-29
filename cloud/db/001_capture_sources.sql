-- Isolated single-person, source-only cloud alpha. Not the canonical Memory Page store.
CREATE TABLE IF NOT EXISTS topo_cloud_capture_sources (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL CHECK (owner_id = 'alpha-owner'),
  idempotency_key text NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('manual', 'mobile-share', 'agent-tool')),
  product text NOT NULL CHECK (product IN ('chatgpt', 'claude', 'gemini', 'copilot', 'whatsapp-agent', 'other')),
  title text,
  source_url text,
  excerpt text NOT NULL CHECK (char_length(excerpt) BETWEEN 1 AND 24000),
  text_hash char(64) NOT NULL,
  trust text NOT NULL DEFAULT 'unverified' CHECK (trust = 'unverified'),
  status text NOT NULL DEFAULT 'pending-review' CHECK (status = 'pending-review'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (owner_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_topo_cloud_capture_owner_created
  ON topo_cloud_capture_sources (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topo_cloud_capture_expires
  ON topo_cloud_capture_sources (expires_at);

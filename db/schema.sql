-- HMEM schema — run this once against your Neon Postgres database
-- (Neon SQL editor, or `psql $DATABASE_URL -f db/schema.sql`)

create extension if not exists vector;
create extension if not exists pgcrypto; -- gen_random_uuid()

-- Tier 1: session working memory (scratchpad + workspace board live here as jsonb;
-- both are small, per-session, and don't need their own tables)
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  messages jsonb not null default '[]',       -- sliding-window turn buffer
  workspace jsonb not null default '[]',      -- shared board entries
  last_node_id uuid,                          -- most recent Tier 3 node, for edge-chaining
  prune_threshold real not null default 0.35, -- adaptive, tuned by scoring.ts
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tier 2: vector index cache
create table if not exists embeddings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  content text not null,
  vector vector(384) not null,
  source_turn integer not null,
  created_at timestamptz not null default now()
);
create index if not exists embeddings_session_idx on embeddings (session_id);
-- hnsw needs pgvector >= 0.5.0 (Neon's default is recent enough as of 2025).
-- If your instance is older, swap `hnsw` for `ivfflat` on both indexes below.
create index if not exists embeddings_vector_idx on embeddings
  using hnsw (vector vector_cosine_ops);

-- Tier 3: global semantic graph
create table if not exists nodes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  label text not null,
  embedding vector(384) not null,
  created_at timestamptz not null default now()
);
create index if not exists nodes_session_idx on nodes (session_id);
create index if not exists nodes_embedding_idx on nodes
  using hnsw (embedding vector_cosine_ops);

create table if not exists edges (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  source_id uuid not null references nodes(id) on delete cascade,
  target_id uuid not null references nodes(id) on delete cascade,
  weight real not null default 0.5,
  updated_at timestamptz not null default now()
);
create index if not exists edges_source_idx on edges (source_id);
create index if not exists edges_session_idx on edges (session_id);

-- Tier 4: skill & version registry
create table if not exists skill_versions (
  id uuid primary key default gen_random_uuid(),
  component text not null,               -- e.g. 'promptBuilder'
  version integer not null,
  config jsonb not null,                 -- the actual prompt template / thresholds
  metrics jsonb,                         -- { contextFidelity, semanticDrift, toolExecutionVeracity }
  status text not null default 'candidate', -- candidate | active | rejected | superseded
  created_at timestamptz not null default now()
);
create index if not exists skill_versions_component_idx on skill_versions (component, status);

-- Fixed regression set used to evaluate candidate skill versions (Tier 4 promotion gate)
create table if not exists regression_turns (
  id uuid primary key default gen_random_uuid(),
  component text not null,
  input text not null,
  context jsonb not null default '[]',   -- retrieved Tier 2/3 snippets to reason over
  target_label text,                     -- optional expected concept/action, for stricter scoring
  created_at timestamptz not null default now()
);

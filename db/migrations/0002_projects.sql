create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  name text not null,
  source text not null,            -- 'github' | 'upload'
  github_owner text, github_repo text, github_branch text,
  status text not null default 'pending',  -- pending|cloning|parsing|ready|error
  error_message text,
  -- files over the 1.5MB read cap: counted, not read (repograph-spec.md §5.1/§18)
  skipped_large_files int not null default 0,
  created_at timestamptz not null default now()
);
create index on projects(owner_id);

create table parsed_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  path text not null,
  lang text not null,              -- java|js|ts|py
  loc int not null,
  is_test boolean not null default false,
  content text,                    -- read/write only through src/lib/server/fileStorage.ts (TS) / workers/file_storage.py (worker)
  unique (project_id, path)        -- idempotency: a retry's upsert can't duplicate a row for the same file
);
create index on parsed_files(project_id);

create table parse_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  status text not null default 'pending',   -- pending|processing|done|failed
  claimed_at timestamptz,
  attempts int not null default 0,          -- bumped on each claim; past max_attempts, fail visibly instead of retrying forever
  error_message text,
  created_at timestamptz not null default now()
);
create index on parse_jobs(status, created_at);

-- An uploaded archive waiting for the worker. Lives in Postgres so the app and the
-- worker stay stateless and can run on different hosts; deleted once the job ends.
create table project_uploads (
  project_id uuid primary key references projects(id) on delete cascade,
  archive bytea not null,
  created_at timestamptz not null default now()
);

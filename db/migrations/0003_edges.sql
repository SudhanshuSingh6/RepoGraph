-- Phase 3b: resolved intra-repo imports. Written in the same worker transaction as
-- parsed_files, after every file row exists; the clear-before-parse delete of
-- parsed_files cascades here, so retries never duplicate edges.
create table parsed_edges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  from_file_id uuid not null references parsed_files(id) on delete cascade,
  to_file_id uuid not null references parsed_files(id) on delete cascade,
  unique (project_id, from_file_id, to_file_id)
);
create index on parsed_edges(project_id);

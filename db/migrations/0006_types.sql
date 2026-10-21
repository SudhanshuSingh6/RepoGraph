-- Phase 6a: class/interface declarations per file (repograph-spec.md §11), for the
-- Architecture view's class diagrams and Phase 7's dead-code rule. Supertype names are
-- stored as written (minus type arguments) and resolved to repo types in the app.
-- Written in the same worker transaction as parsed_files; the clear-before-parse
-- delete of parsed_files cascades here, so retries never duplicate rows.
create table parsed_types (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_id uuid not null references parsed_files(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('class', 'abstract', 'interface', 'enum', 'record')),
  extends text[] not null default '{}',
  implements text[] not null default '{}',
  line int not null
);
create index on parsed_types(project_id);

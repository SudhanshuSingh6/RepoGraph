-- Phase 6b: ORM entities per file (repograph-spec.md §12), for the ER Diagram.
-- Relationship targets are stored as written and resolved to entities in the app,
-- within the same language and ORM. Written in the same worker transaction as
-- parsed_files; the clear-before-parse delete cascades here, so retries never
-- duplicate rows.
create table parsed_entities (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  file_id uuid not null references parsed_files(id) on delete cascade,
  name text not null,
  table_name text not null,
  orm text not null check (orm in ('jpa', 'typeorm', 'django', 'sqlalchemy')),
  fields jsonb not null default '[]',     -- [{name, type, pk}]
  relations jsonb not null default '[]',  -- [{field, kind: 1–1|1–N|N–1|N–N|RelatedTo, target}]
  line int not null
);
create index on parsed_entities(project_id);

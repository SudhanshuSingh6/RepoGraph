-- APIs view: per-file flow facts, one row per file that has any. JSON because the app
-- always reads a project's rows whole and resolves them server-side.
--   functions  [{name, owner, line, end_line, params: [{name, type}], static, scope, synthetic, action}]
--   members    [{owner, name, type}]                class fields / injected members
--   bindings   [{local, kind, target, name, typeOnly}]   imports, resolved by the worker;
--              target = repo file path (Java package name for kind 'package'), or null
--              for a library
--   exports    [{name, local, reexport?: {target, name}}]
--   endpoints  [{framework, method, path, prefix: root|resolved|unknown, line,
--               handler: {label, path, fn, line}}]  routes declared in this file
-- Written in the same worker transaction as parsed_files; the clear-before-parse
-- delete cascades here, so retries never duplicate rows.
create table parsed_flows (
  project_id uuid not null references projects(id) on delete cascade,
  file_id uuid primary key references parsed_files(id) on delete cascade,
  functions jsonb not null default '[]',
  members jsonb not null default '[]',
  bindings jsonb not null default '[]',
  exports jsonb not null default '[]',
  endpoints jsonb not null default '[]',
  package text  -- Java package declaration
);
create index on parsed_flows(project_id);

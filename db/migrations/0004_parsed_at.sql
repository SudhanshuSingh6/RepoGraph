-- Phase 4: version stamp for the derived-graph cache. The worker sets it in the same
-- transaction that writes parsed_files/parsed_edges, so a re-import always changes it
-- and the app's cache key (project id, parsed_at) can never serve a stale graph.
alter table projects add column parsed_at timestamptz;

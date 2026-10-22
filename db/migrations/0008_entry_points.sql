-- Phase 7: whether a file looks like an entry point (repograph-spec.md §5.1), which
-- excludes it from "possibly unused" (§14). Computed by the worker, since the Python
-- `if __name__ == "__main__"` check needs the file's content.
alter table parsed_files add column is_entry boolean not null default false;

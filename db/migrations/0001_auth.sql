create table users (
  id uuid primary key default gen_random_uuid(),
  github_id bigint unique not null,
  username text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index on sessions(user_id);

-- Pending GitHub logins: the OAuth `state` and its PKCE verifier, single-use.
create table oauth_states (
  state text primary key,
  code_verifier text not null,
  expires_at timestamptz not null
);

-- Phase 10: chat runs on each user's own API key. One key per user and provider,
-- encrypted with AES-256-GCM (CHAT_KEY_SECRET); only the last four characters are kept
-- readable, as a hint. `active` marks the provider chat uses; at most one per user.
create table chat_keys (
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic', 'gemini', 'xai')),
  ciphertext bytea not null,
  iv bytea not null,
  tag bytea not null,
  hint text not null,
  model text not null,
  -- set once a probe showed `model` works with this app's endpoint and tool calling;
  -- cleared whenever the model or key changes
  model_verified_at timestamptz,
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
create unique index chat_keys_one_active on chat_keys(user_id) where active;

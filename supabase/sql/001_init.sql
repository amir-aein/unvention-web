-- Unvention: initial Supabase schema (legacy event store + auth-linked users)
--
-- Apply via Supabase Dashboard -> SQL Editor.
--
-- Design goals:
-- - Persist the existing server event stream (NDJSON) with minimal impedance.
-- - Add an auth-linked user table we can grow into.
-- - Enable RLS by default to prevent accidental public exposure via the Data API.

begin;

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- One row per authenticated user (created automatically via trigger).
create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default '',
  legacy_profile_token text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table public.app_users alter column display_name set default '';

-- Mirror of the current server-generated profiles.json (legacy identity).
create table if not exists public.legacy_profiles (
  profile_id text primary key,
  profile_token text unique,
  display_name text not null default 'Player',
  created_at_ms bigint,
  updated_at_ms bigint,
  last_seen_at_ms bigint,
  rooms jsonb not null default '[]'::jsonb,
  imported_at timestamptz not null default now()
);

-- Append-only room event stream (matches server/output/room-events.ndjson).
create table if not exists public.room_events (
  event_id text primary key,
  sequence bigint not null,
  room_code text not null,
  timestamp timestamptz not null,
  timestamp_ms bigint not null,
  type text not null,
  actor_player_id text,
  actor_profile_id text,
  profile_refs text[] not null default '{}'::text[],
  payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  constraint room_events_room_sequence_unique unique (room_code, sequence)
);

create index if not exists room_events_room_code_idx on public.room_events (room_code);
create index if not exists room_events_type_idx on public.room_events (type);
create index if not exists room_events_timestamp_ms_idx on public.room_events (timestamp_ms);

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_users_set_updated_at on public.app_users;
create trigger app_users_set_updated_at
before update on public.app_users
for each row execute procedure public.set_updated_at();

-- Create an app_users row when a new auth user signs up.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_users (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do update
    set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_auth_user();

-- RLS: default deny, then add minimal allow rules.
alter table public.app_users enable row level security;
alter table public.legacy_profiles enable row level security;
alter table public.room_events enable row level security;

-- app_users: user can read/write their own row.
drop policy if exists app_users_select_own on public.app_users;
create policy app_users_select_own
on public.app_users
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists app_users_update_own on public.app_users;
create policy app_users_update_own
on public.app_users
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- legacy tables: no public access (server uses service role key).
-- (No policies created.)

commit;

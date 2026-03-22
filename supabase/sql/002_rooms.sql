-- Unvention: persisted multiplayer rooms
--
-- Apply after 001_init.sql.

begin;

create table if not exists public.rooms (
  room_code text primary key,
  display_name text not null default '',
  status text not null default 'lobby',
  host_player_id text,
  max_players integer not null default 5,
  created_at_ms bigint not null,
  updated_at_ms bigint not null,
  archived_at_ms bigint,
  last_archive_reason text,
  turn_number integer not null default 1,
  turn_day text not null default 'Friday',
  turn_roll jsonb,
  turn_rolled_at_ms bigint,
  imported_at timestamptz not null default now()
);

create index if not exists rooms_status_idx on public.rooms (status);
create index if not exists rooms_updated_at_ms_idx on public.rooms (updated_at_ms);

create table if not exists public.room_players (
  room_code text not null references public.rooms(room_code) on delete cascade,
  player_id text not null,
  profile_id text,
  name text not null default 'Player',
  seat integer not null,
  is_host boolean not null default false,
  connected boolean not null default false,
  reconnect_token text,
  can_reconnect_until_ms bigint,
  last_seen_at_ms bigint,
  ended_turn boolean not null default false,
  turn_summary jsonb,
  live_state jsonb,
  imported_at timestamptz not null default now(),
  primary key (room_code, player_id)
);

create index if not exists room_players_profile_id_idx on public.room_players (profile_id);
create index if not exists room_players_reconnect_token_idx on public.room_players (reconnect_token);

create table if not exists public.room_snapshots (
  room_code text primary key references public.rooms(room_code) on delete cascade,
  snapshot jsonb not null default '{}'::jsonb,
  updated_at_ms bigint not null,
  imported_at timestamptz not null default now()
);

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_snapshots enable row level security;

commit;

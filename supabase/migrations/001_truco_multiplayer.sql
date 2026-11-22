-- ============================================================================
-- Truco Venezolano — Esquema Multijugador Autoritativo con Anti-Trampa (RLS)
-- ============================================================================
-- Ejecutar en Supabase Dashboard -> SQL Editor (o con `supabase db push`).
--
-- Seguridad:
-- - RLS está activado en ambas tablas SIN políticas públicas para `anon` o `authenticated`.
-- - Ningún cliente del navegador puede leer `canonical_state` ni `player_secret` directamente.
-- - Toda mutación y lectura sanitizada pasa por la Edge Function `truco-game` (service_role).

create table if not exists public.truco_rooms (
  code text primary key,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'finished')),
  config jsonb not null default '{"mode":"1v1","targetScore":24,"withFlor":true}'::jsonb,
  version integer not null default 0,
  canonical_state jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.truco_room_players (
  room_code text not null references public.truco_rooms(code) on delete cascade,
  client_id text not null,
  player_secret text not null,
  name text not null,
  seat text check (seat in ('player', 'cpu', 'partner', 'cpu2')),
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (room_code, client_id)
);

-- Un asiento físico por sala solo puede pertenecer a un jugador a la vez
create unique index if not exists truco_room_players_unique_seat_idx
  on public.truco_room_players (room_code, seat)
  where seat is not null;

create index if not exists truco_rooms_updated_at_idx
  on public.truco_rooms (updated_at desc);

create index if not exists truco_room_players_last_seen_idx
  on public.truco_room_players (room_code, last_seen desc);

-- Trigger automático para `updated_at`
create or replace function public.truco_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_truco_rooms_updated_at on public.truco_rooms;
create trigger trg_truco_rooms_updated_at
  before update on public.truco_rooms
  for each row
  execute function public.truco_touch_updated_at();

-- Bloqueo total a clientes públicos: solo `service_role` (Edge Function) accede a la BD
alter table public.truco_rooms enable row level security;
alter table public.truco_room_players enable row level security;

revoke all on public.truco_rooms from anon, authenticated;
revoke all on public.truco_room_players from anon, authenticated;

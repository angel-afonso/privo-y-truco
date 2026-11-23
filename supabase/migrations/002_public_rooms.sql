alter table public.truco_rooms
  add column visibility text not null default 'private'
  check (visibility in ('private', 'public'));

create index truco_public_lobbies_idx on public.truco_rooms (created_at desc)
  where visibility = 'public' and status = 'lobby';

create view public.truco_open_rooms with (security_invoker = true) as
select r.code, h.name as host, r.config, r.created_at,
       count(p.seat)::integer as occupied
from public.truco_rooms r
join public.truco_room_players h on h.room_code = r.code and h.is_host
join public.truco_room_players p on p.room_code = r.code
where r.visibility = 'public' and r.status = 'lobby'
  and h.last_seen >= now() - interval '60 seconds'
group by r.code, h.client_id, h.name
having count(p.seat) < case when r.config->>'mode' = '2v2' then 4 else 2 end;

revoke all on public.truco_open_rooms from public, anon, authenticated;
grant select on public.truco_open_rooms to service_role;

-- Serialize admission with other admissions and updates that start the match.
create function public.truco_join_open_room(
  p_code text, p_client_id text, p_secret text, p_name text
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  room_mode text;
  next_seat text;
begin
  select config->>'mode' into room_mode from public.truco_rooms
    where code = p_code and visibility = 'public' and status = 'lobby' for update;
  if not found then return false; end if;
  if not exists (select 1 from public.truco_open_rooms where code = p_code) then
    return false;
  end if;
  select s into next_seat
  from unnest(case when room_mode = '2v2'
    then array['player','cpu','partner','cpu2'] else array['player','cpu'] end)
    with ordinality as seats(s, ord)
  where not exists (select 1 from public.truco_room_players p where p.room_code = p_code and p.seat = s)
  order by ord limit 1;
  if next_seat is null then return false; end if;
  insert into public.truco_room_players (room_code, client_id, player_secret, name, seat)
    values (p_code, p_client_id, p_secret, p_name, next_seat)
    on conflict do nothing;
  return found;
end;
$$;
revoke all on function public.truco_join_open_room(text,text,text,text) from public, anon, authenticated;
grant execute on function public.truco_join_open_room(text,text,text,text) to service_role;

alter table public.truco_rooms add column invite_code text;
-- Existing invitation links continue to work until their first redemption.
update public.truco_rooms set invite_code = code;
alter table public.truco_rooms alter column invite_code set not null,
  alter column invite_code set default upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
create unique index truco_rooms_invite_code_idx on public.truco_rooms(invite_code);
alter table public.truco_room_players add column redeemed_invite text;

create function public.truco_redeem_invite(p_invite text, p_client_id text, p_secret text, p_name text)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  r public.truco_rooms%rowtype;
  free_seat text;
  joined_room text;
begin
  select * into r from public.truco_rooms where invite_code = p_invite for update;
  if not found then
    select room_code into joined_room from public.truco_room_players
      where client_id = p_client_id and player_secret = p_secret and redeemed_invite = p_invite;
    return joined_room;
  end if;
  if r.status <> 'lobby' or not exists (
    select 1 from public.truco_room_players where room_code = r.code and is_host
  ) then return null; end if;
  select s into free_seat from unnest(case when r.config->>'mode' = '2v2'
    then array['player','cpu','partner','cpu2'] else array['player','cpu'] end)
    with ordinality as seats(s, pos)
    where not exists (select 1 from public.truco_room_players where room_code = r.code and seat = s)
    order by pos limit 1;
  if free_seat is null then return null; end if;
  insert into public.truco_room_players(room_code, client_id, player_secret, name, seat, redeemed_invite)
    values (r.code, p_client_id, p_secret, p_name, free_seat, p_invite) on conflict do nothing;
  if not found then return null; end if;
  update public.truco_rooms set invite_code = default, version = version + 1 where code = r.code;
  return r.code;
end;
$$;

revoke all on function public.truco_redeem_invite(text,text,text,text) from public, anon, authenticated;
grant execute on function public.truco_redeem_invite(text,text,text,text) to service_role;

create function public.truco_retire_host_invite() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  update public.truco_rooms set invite_code = default where code = old.room_code and status = 'lobby';
  return old;
end;
$$;
create trigger retire_host_invite after delete on public.truco_room_players
  for each row when (old.is_host) execute function public.truco_retire_host_invite();

create function public.truco_leave_room(p_code text, p_client text, p_secret text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  was_host boolean;
  next_player text;
begin
  -- Las admisiones también bloquean la sala antes de asignar un puesto.
  perform 1 from public.truco_rooms where code = p_code for update;
  if not found then return true; end if;

  delete from public.truco_room_players
    where room_code = p_code and client_id = p_client and player_secret = p_secret
    returning is_host into was_host;
  if not found then return false; end if;

  select client_id into next_player from public.truco_room_players
    where room_code = p_code order by joined_at, client_id limit 1;
  if not found then
    delete from public.truco_rooms where code = p_code;
  else
    if was_host then
      update public.truco_room_players set is_host = true
        where room_code = p_code and client_id = next_player;
    end if;
    update public.truco_rooms set version = version + 1 where code = p_code;
  end if;
  return true;
end;
$$;

revoke all on function public.truco_leave_room(text,text,text) from public, anon, authenticated;
grant execute on function public.truco_leave_room(text,text,text) to service_role;

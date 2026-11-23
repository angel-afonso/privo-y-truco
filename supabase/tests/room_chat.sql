begin;
select '1..3';

insert into public.truco_rooms(code) values ('CHAT-A'), ('CHAT-B');
insert into public.truco_room_players(room_code, client_id, player_secret, name)
values ('CHAT-A','ana','a-secret','Ana'), ('CHAT-B','luis','b-secret','Luis');

do $$
begin
  begin
    perform public.truco_chat('CHAT-B','ana','a-secret',null,null);
    raise exception 'El historial de otra sala quedó accesible';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.truco_chat('CHAT-A','ana','b-secret','fake','Hola');
    raise exception 'Se aceptó un mensaje con una credencial ajena';
  exception when insufficient_privilege then null;
  end;
end $$;
select 'ok 1 - lectura y escritura requieren pertenecer a la sala';

do $$
declare
  snapshot jsonb;
begin
  for i in 1..51 loop
    snapshot := public.truco_chat('CHAT-A','ana','a-secret',i::text,'Jugada ' || i);
  end loop;
  snapshot := public.truco_chat('CHAT-A','ana','a-secret','51','Jugada 51');
  if (snapshot->>'revision')::int <> 51 or jsonb_array_length(snapshot->'messages') <> 50
     or snapshot#>>'{messages,0,id}' <> '2' or snapshot#>>'{messages,49,name}' <> 'Ana' then
    raise exception 'Historial incorrecto después de un reintento';
  end if;
  if public.truco_chat('CHAT-B','luis','b-secret',null,null)->'messages' <> '[]'::jsonb then
    raise exception 'Se mezclaron mensajes de dos salas';
  end if;
end $$;
select 'ok 2 - historial acotado, ordenado, aislado y sin duplicados al reintentar';
update public.truco_room_players set is_host = true where room_code = 'CHAT-A';
insert into public.truco_room_players(room_code, client_id, player_secret, name)
values ('CHAT-A','sol','s-secret','Sol');
do $$
begin
  if public.truco_leave_room('CHAT-A','ana','incorrecto') then
    raise exception 'Se aceptó una salida ajena';
  end if;
  perform public.truco_leave_room('CHAT-A','ana','a-secret');
  if not exists (select 1 from public.truco_room_players where room_code = 'CHAT-A' and client_id = 'sol' and is_host)
      or jsonb_array_length(public.truco_chat('CHAT-A','sol','s-secret',null,null)->'messages') <> 50 then
    raise exception 'Se perdió el anfitrión o el chat con la mesa abierta';
  end if;
  perform public.truco_leave_room('CHAT-A','sol','s-secret');
  if exists (select 1 from public.truco_room_chat where room_code = 'CHAT-A')
      or exists (select 1 from public.truco_rooms where code = 'CHAT-A') then
    raise exception 'La última salida dejó la sala o el chat almacenados';
  end if;
end $$;
select 'ok 3 - el chat se conserva con jugadores y se elimina con la última salida';
rollback;

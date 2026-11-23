create table public.truco_room_chat (
  room_code text primary key references public.truco_rooms(code) on delete cascade,
  revision bigint not null default 0,
  messages jsonb not null default '[]'::jsonb
);
alter table public.truco_room_chat enable row level security;
revoke all on public.truco_room_chat from public, anon, authenticated;
grant select, insert, update on public.truco_room_chat to service_role;

create function public.truco_chat(p_code text, p_client text, p_secret text, p_id text, p_text text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  author text;
  chat public.truco_room_chat%rowtype;
  entry jsonb;
begin
  select name into author from public.truco_room_players
    where room_code = p_code and client_id = p_client and player_secret = p_secret;
  if not found then raise insufficient_privilege; end if;

  if p_text is null then
    select * into chat from public.truco_room_chat where room_code = p_code;
  else
    if p_id is null or length(p_id) not between 1 and 64 or length(trim(p_text)) not between 1 and 400 then
      raise exception 'Mensaje inválido' using errcode = '22023';
    end if;
    insert into public.truco_room_chat(room_code) values (p_code) on conflict do nothing;
    select * into strict chat from public.truco_room_chat where room_code = p_code for update;
    if not chat.messages @> jsonb_build_array(jsonb_build_object('id', p_id, 'clientId', p_client)) then
      entry := jsonb_build_object('id', p_id, 'clientId', p_client, 'name', author, 'text', trim(p_text));
      if jsonb_array_length(chat.messages) >= 50 then chat.messages := chat.messages - 0; end if;
      update public.truco_room_chat set messages = chat.messages || jsonb_build_array(entry),
        revision = chat.revision + 1 where room_code = p_code returning * into chat;
    end if;
  end if;
  return jsonb_build_object('revision', coalesce(chat.revision, 0), 'messages', coalesce(chat.messages, '[]'::jsonb));
end;
$$;
revoke all on function public.truco_chat(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.truco_chat(text,text,text,text,text) to service_role;

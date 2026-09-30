-- Our Nook: isolated couple spaces, one-use partner codes, and private memories.
-- Privileged implementations live in an unexposed schema; public RPCs are invokers.
create schema if not exists nook_private;
revoke all on schema nook_private from public, anon, authenticated;
grant usage on schema nook_private to authenticated, service_role;

create table public.nook_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'You' check (length(btrim(display_name)) between 1 and 60),
  avatar text not null default '🌷' check (avatar in ('🌷','🌙','🐻','🐱','🦊','🐼','🌻','☕','🌈','🪻')),
  city text not null default '' check (length(city) <= 80),
  country text not null default '' check (length(country) <= 80),
  timezone text not null default 'UTC',
  time_format text not null default '12' check (time_format in ('12','24')),
  theme text not null default 'rose' check (theme in ('rose','night')),
  status text not null default '' check (length(status) <= 100)
);
create table public.nook_couples (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 80),
  created_by uuid not null references public.nook_profiles(id),
  anniversary date,
  next_visit date,
  created_at timestamptz not null default now()
);
create table public.nook_members (
  user_id uuid primary key references public.nook_profiles(id) on delete cascade,
  couple_id uuid not null references public.nook_couples(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (couple_id, user_id)
);
create index nook_members_couple on public.nook_members(couple_id);
create index nook_couples_creator on public.nook_couples(created_by);
create table public.nook_posts (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.nook_couples(id) on delete cascade,
  author_id uuid not null references public.nook_profiles(id),
  kind text not null check (kind in ('note','photo','song','hug')),
  body text not null default '' check (length(body) <= 4000),
  link_url text check (link_url is null or (link_url ~ '^https://' and length(link_url) <= 2048)),
  storage_path text,
  created_at timestamptz not null default now(),
  foreign key (couple_id, author_id) references public.nook_members(couple_id, user_id),
  check ((kind = 'photo') = (storage_path is not null)),
  check ((kind = 'song') = (link_url is not null)),
  check (kind <> 'note' or length(btrim(body)) > 0),
  check (storage_path is null or (
    split_part(storage_path, '/', 1) = couple_id::text and
    split_part(storage_path, '/', 2) = author_id::text and
    storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/[A-Za-z0-9_-]+\.(jpg|png|webp)$'
  ))
);
create index nook_posts_timeline on public.nook_posts(couple_id, created_at desc);
create index nook_posts_author on public.nook_posts(author_id);
create table public.nook_games (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.nook_couples(id),
  player_x uuid not null,
  player_o uuid not null,
  board text[] not null default array['','','','','','','','',''],
  turn_user uuid,
  winner uuid,
  status text not null default 'playing' check (status in ('playing','won','draw')),
  created_at timestamptz not null default now(),
  foreign key (couple_id, player_x) references public.nook_members(couple_id, user_id),
  foreign key (couple_id, player_o) references public.nook_members(couple_id, user_id),
  check (player_x <> player_o),
  check (array_length(board,1) = 9 and board <@ array['','X','O']),
  check (turn_user is null or turn_user in (player_x, player_o)),
  check (winner is null or winner in (player_x, player_o))
);
create index nook_games_timeline on public.nook_games(couple_id, created_at desc);
create unique index nook_one_active_game on public.nook_games(couple_id) where status = 'playing';
create index nook_games_player_x on public.nook_games(player_x);
create index nook_games_player_o on public.nook_games(player_o);
create table nook_private.invites (
  couple_id uuid primary key references public.nook_couples(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz
);
create table nook_private.join_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
create table nook_private.telegram_tokens (
  user_id uuid primary key references public.nook_profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null
);
create table nook_private.telegram_links (
  user_id uuid primary key references public.nook_profiles(id) on delete cascade,
  telegram_user_id bigint not null unique,
  chat_id bigint not null
);
create table nook_private.telegram_updates (
  update_id bigint primary key,
  received_at timestamptz not null default now()
);

alter table public.nook_profiles enable row level security;
alter table public.nook_couples enable row level security;
alter table public.nook_members enable row level security;
alter table public.nook_posts enable row level security;
alter table public.nook_games enable row level security;
alter table nook_private.invites enable row level security;
alter table nook_private.join_attempts enable row level security;
alter table nook_private.telegram_tokens enable row level security;
alter table nook_private.telegram_links enable row level security;
alter table nook_private.telegram_updates enable row level security;
revoke all on public.nook_profiles, public.nook_couples, public.nook_members, public.nook_posts, public.nook_games from public, anon, authenticated;
revoke all on all tables in schema nook_private from public, anon, authenticated;

create function nook_private.require_user() returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null or not exists (select 1 from auth.users where id = u and email_confirmed_at is not null) then
    raise exception 'Sign in with a verified email first.' using errcode = '42501';
  end if;
  return u;
end $$;
create function nook_private.my_couple() returns uuid
language sql stable security definer set search_path = '' as $$
  select couple_id from public.nook_members where user_id = auth.uid() and auth.uid() is not null;
$$;
create function nook_private.shares_couple(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.nook_members a join public.nook_members b on a.couple_id = b.couple_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;
create function nook_private.validate_timezone() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then raise exception 'Choose a valid time zone.'; end if;
  return new;
end $$;
create trigger nook_profile_timezone before insert or update of timezone on public.nook_profiles for each row execute function nook_private.validate_timezone();

grant select on public.nook_profiles, public.nook_couples, public.nook_members, public.nook_posts, public.nook_games to authenticated;
grant insert (id) on public.nook_profiles to authenticated;
grant update (display_name, avatar, city, country, timezone, time_format, theme, status) on public.nook_profiles to authenticated;
grant update (title, anniversary, next_visit) on public.nook_couples to authenticated;
grant insert (couple_id, author_id, kind, body, link_url, storage_path) on public.nook_posts to authenticated;
grant delete on public.nook_posts to authenticated;
grant all on public.nook_profiles, public.nook_couples, public.nook_members, public.nook_posts, public.nook_games to service_role;
create policy nook_profile_read on public.nook_profiles for select to authenticated using (id = (select auth.uid()) or nook_private.shares_couple(id));
create policy nook_profile_insert on public.nook_profiles for insert to authenticated with check (id = (select auth.uid()));
create policy nook_profile_update on public.nook_profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy nook_couple_read on public.nook_couples for select to authenticated using (id = (select nook_private.my_couple()));
create policy nook_couple_update on public.nook_couples for update to authenticated using (id = (select nook_private.my_couple())) with check (id = (select nook_private.my_couple()));
create policy nook_members_read on public.nook_members for select to authenticated using (user_id = (select auth.uid()) or couple_id = (select nook_private.my_couple()));
create policy nook_posts_read on public.nook_posts for select to authenticated using (couple_id = (select nook_private.my_couple()));
create policy nook_posts_insert on public.nook_posts for insert to authenticated with check (author_id = (select auth.uid()) and couple_id = (select nook_private.my_couple()));
create policy nook_posts_delete on public.nook_posts for delete to authenticated using (author_id = (select auth.uid()) and couple_id = (select nook_private.my_couple()));
create policy nook_games_read on public.nook_games for select to authenticated using (couple_id = (select nook_private.my_couple()));

create function nook_private.create_couple(p_title text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := nook_private.require_user(); c uuid;
begin
  perform 1 from public.nook_profiles where id = u for update;
  if not found then raise exception 'Save your profile first.'; end if;
  if exists (select 1 from public.nook_members where user_id = u) then raise exception 'You already belong to a nook.'; end if;
  insert into public.nook_couples(title,created_by) values (btrim(p_title),u) returning id into c;
  insert into public.nook_members(user_id,couple_id) values (u,c);
  return c;
end $$;
create function nook_private.issue_invite() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := nook_private.require_user(); c uuid := nook_private.my_couple(); code text;
begin
  perform 1 from public.nook_couples where id = c and created_by = u for update;
  if not found then raise exception 'Only the person who created this nook can issue its invitation.'; end if;
  if (select count(*) from public.nook_members where couple_id = c) <> 1 then raise exception 'This nook already has two people.'; end if;
  code := upper(substr(replace(gen_random_uuid()::text,'-',''),1,20));
  insert into nook_private.invites(couple_id,token_hash,expires_at) values (c,encode(sha256(convert_to(code,'UTF8')),'hex'),now()+interval '24 hours')
  on conflict (couple_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at, used_at = null;
  return jsonb_build_object('code',code,'expires_at',now()+interval '24 hours');
end $$;
create function nook_private.join_couple(p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := nook_private.require_user(); v_invite nook_private.invites; n integer; normalized text;
begin
  perform 1 from public.nook_profiles where id = u for update;
  if not found then return jsonb_build_object('error','Save your profile first.'); end if;
  if exists (select 1 from public.nook_members where user_id = u) then return jsonb_build_object('error','You already belong to a nook.'); end if;
  insert into nook_private.join_attempts(user_id) values (u)
  on conflict (user_id) do update set
    attempts = case when nook_private.join_attempts.window_start < now()-interval '15 minutes' then 1 else nook_private.join_attempts.attempts+1 end,
    window_start = case when nook_private.join_attempts.window_start < now()-interval '15 minutes' then now() else nook_private.join_attempts.window_start end
  returning attempts into n;
  if n > 10 then return jsonb_build_object('error','Too many attempts. Try again in 15 minutes.'); end if;
  normalized := upper(regexp_replace(coalesce(p_code,''),'[-[:space:]]','','g'));
  if normalized !~ '^[0-9A-F]{20}$' then return jsonb_build_object('error','This code is invalid, expired, or already used.'); end if;
  -- Match first, lock the couple next: all membership changes serialize on it.
  select * into v_invite from nook_private.invites where token_hash = encode(sha256(convert_to(normalized,'UTF8')),'hex');
  if not found then return jsonb_build_object('error','This code is invalid, expired, or already used.'); end if;
  perform 1 from public.nook_couples where id = v_invite.couple_id for update;
  select * into v_invite from nook_private.invites where couple_id = v_invite.couple_id for update;
  if v_invite.token_hash <> encode(sha256(convert_to(normalized,'UTF8')),'hex') or v_invite.used_at is not null or v_invite.expires_at <= now()
    or (select count(*) from public.nook_members where couple_id = v_invite.couple_id) >= 2 then
    return jsonb_build_object('error','This code is invalid, expired, or already used.');
  end if;
  insert into public.nook_members(user_id,couple_id) values (u,v_invite.couple_id);
  update nook_private.invites set used_at = now() where couple_id = v_invite.couple_id;
  return jsonb_build_object('couple_id',v_invite.couple_id);
end $$;

create function nook_private.start_game() returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := nook_private.require_user(); c uuid := nook_private.my_couple(); other uuid; game_id uuid;
begin
  perform 1 from public.nook_couples where id = c for update;
  if not found then raise exception 'Join a nook first.'; end if;
  select user_id into other from public.nook_members where couple_id = c and user_id <> u;
  if other is null then raise exception 'Invite your partner before starting a game.'; end if;
  select id into game_id from public.nook_games where couple_id = c and status = 'playing';
  if game_id is not null then return game_id; end if;
  insert into public.nook_games(couple_id,player_x,player_o,turn_user) values (c,u,other,u) returning id into game_id;
  return game_id;
end $$;
create function nook_private.play_move(p_game_id uuid, p_cell integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := nook_private.require_user(); g public.nook_games; mark text; line integer[]; won boolean := false;
begin
  select * into g from public.nook_games where id = p_game_id and couple_id = nook_private.my_couple() for update;
  if not found then raise exception 'Game not found.'; end if;
  if g.status <> 'playing' or g.turn_user <> u then raise exception 'Wait for your turn.'; end if;
  if p_cell is null or p_cell < 0 or p_cell > 8 or g.board[p_cell+1] <> '' then raise exception 'Choose an empty square.'; end if;
  mark := case when g.player_x = u then 'X' else 'O' end;
  g.board[p_cell+1] := mark;
  foreach line slice 1 in array array[[1,2,3],[4,5,6],[7,8,9],[1,4,7],[2,5,8],[3,6,9],[1,5,9],[3,5,7]] loop
    if g.board[line[1]] = mark and g.board[line[2]] = mark and g.board[line[3]] = mark then won := true; end if;
  end loop;
  if won then g.status := 'won'; g.winner := u; g.turn_user := null;
  elsif not ('' = any(g.board)) then g.status := 'draw'; g.turn_user := null;
  else g.turn_user := case when u = g.player_x then g.player_o else g.player_x end; end if;
  update public.nook_games set board = g.board, status = g.status, winner = g.winner, turn_user = g.turn_user where id = g.id;
  return jsonb_build_object('status',g.status,'board',g.board);
end $$;

create function nook_private.telegram_token() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := nook_private.require_user(); token text := replace(gen_random_uuid()::text,'-','');
begin
  if nook_private.my_couple() is null then raise exception 'Join a nook first.'; end if;
  insert into nook_private.telegram_tokens(user_id,token_hash,expires_at) values (u,encode(sha256(convert_to(token,'UTF8')),'hex'),now()+interval '10 minutes')
  on conflict (user_id) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at;
  return jsonb_build_object('token',token);
end $$;
create function nook_private.disconnect_telegram() returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid := nook_private.require_user();
begin
  delete from nook_private.telegram_links where user_id = u;
  delete from nook_private.telegram_tokens where user_id = u;
end $$;

-- Frontend-callable RPCs. They have no privilege escalation of their own.
create function public.nook_create_couple(p_title text) returns uuid language sql security invoker set search_path = '' as $$ select nook_private.create_couple(p_title); $$;
create function public.nook_issue_invite() returns jsonb language sql security invoker set search_path = '' as $$ select nook_private.issue_invite(); $$;
create function public.nook_join_couple(p_code text) returns jsonb language sql security invoker set search_path = '' as $$ select nook_private.join_couple(p_code); $$;
create function public.nook_start_game() returns uuid language sql security invoker set search_path = '' as $$ select nook_private.start_game(); $$;
create function public.nook_play_move(p_game_id uuid,p_cell integer) returns jsonb language sql security invoker set search_path = '' as $$ select nook_private.play_move(p_game_id,p_cell); $$;
create function public.nook_telegram_token() returns jsonb language sql security invoker set search_path = '' as $$ select nook_private.telegram_token(); $$;
create function public.nook_disconnect_telegram() returns void language sql security invoker set search_path = '' as $$ select nook_private.disconnect_telegram(); $$;

-- Bot RPCs accept only service_role. Telegram IDs come from an authenticated webhook.
create function nook_private.require_bot() returns void language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Bot access required.' using errcode = '42501'; end if;
end $$;
create function nook_private.telegram_link(p_token text,p_telegram_user_id bigint,p_chat_id bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  perform nook_private.require_bot();
  if p_chat_id <= 0 or p_telegram_user_id <> p_chat_id then return false; end if;
  delete from nook_private.telegram_tokens where token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex') and expires_at > now() returning user_id into u;
  if u is null or not exists (select 1 from public.nook_members where user_id = u) then return false; end if;
  -- A Telegram identity cannot silently take over another app account's link.
  if exists (select 1 from nook_private.telegram_links where telegram_user_id = p_telegram_user_id and user_id <> u) then raise exception 'Disconnect your other Telegram link first.'; end if;
  insert into nook_private.telegram_links(user_id,telegram_user_id,chat_id) values (u,p_telegram_user_id,p_chat_id)
  on conflict (user_id) do update set telegram_user_id = excluded.telegram_user_id, chat_id = excluded.chat_id;
  return true;
end $$;
create function nook_private.telegram_context(p_telegram_user_id bigint,p_chat_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  perform nook_private.require_bot();
  select jsonb_build_object('user_id',l.user_id,'couple_id',m.couple_id) into result
    from nook_private.telegram_links l join public.nook_members m on m.user_id = l.user_id
    where l.telegram_user_id = p_telegram_user_id and l.chat_id = p_chat_id;
  return result;
end $$;
create function nook_private.telegram_unlink(p_telegram_user_id bigint,p_chat_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform nook_private.require_bot();
  delete from nook_private.telegram_links where telegram_user_id = p_telegram_user_id and chat_id = p_chat_id;
end $$;
create function nook_private.telegram_save(p_update_id bigint,p_telegram_user_id bigint,p_chat_id bigint,p_kind text,p_body text,p_link_url text,p_storage_path text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare context jsonb; inserted_id bigint;
begin
  perform nook_private.require_bot();
  context := nook_private.telegram_context(p_telegram_user_id,p_chat_id);
  if context is null then raise exception 'Connect Telegram from Our Nook first.'; end if;
  insert into nook_private.telegram_updates(update_id) values (p_update_id) on conflict do nothing returning update_id into inserted_id;
  if inserted_id is null then return false; end if;
  insert into public.nook_posts(couple_id,author_id,kind,body,link_url,storage_path)
    values ((context->>'couple_id')::uuid,(context->>'user_id')::uuid,p_kind,p_body,p_link_url,p_storage_path);
  return true;
end $$;
create function public.nook_telegram_link(p_token text,p_telegram_user_id bigint,p_chat_id bigint) returns boolean language sql security invoker set search_path = '' as $$ select nook_private.telegram_link(p_token,p_telegram_user_id,p_chat_id); $$;
create function public.nook_telegram_context(p_telegram_user_id bigint,p_chat_id bigint) returns jsonb language sql security invoker set search_path = '' as $$ select nook_private.telegram_context(p_telegram_user_id,p_chat_id); $$;
create function public.nook_telegram_unlink(p_telegram_user_id bigint,p_chat_id bigint) returns void language sql security invoker set search_path = '' as $$ select nook_private.telegram_unlink(p_telegram_user_id,p_chat_id); $$;
create function public.nook_telegram_save(p_update_id bigint,p_telegram_user_id bigint,p_chat_id bigint,p_kind text,p_body text,p_link_url text,p_storage_path text) returns boolean language sql security invoker set search_path = '' as $$ select nook_private.telegram_save(p_update_id,p_telegram_user_id,p_chat_id,p_kind,p_body,p_link_url,p_storage_path); $$;

-- Revoke Postgres's default PUBLIC execution grant from this app's functions.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'nook_private' or (n.nspname = 'public' and p.proname like 'nook_%') loop
    execute format('revoke all on function %s from public, anon, authenticated',f.signature);
  end loop;
end $$;
grant execute on function nook_private.require_user(), nook_private.my_couple(), nook_private.shares_couple(uuid), nook_private.create_couple(text), nook_private.issue_invite(), nook_private.join_couple(text), nook_private.start_game(), nook_private.play_move(uuid,integer), nook_private.telegram_token(), nook_private.disconnect_telegram() to authenticated;
grant execute on function public.nook_create_couple(text), public.nook_issue_invite(), public.nook_join_couple(text), public.nook_start_game(), public.nook_play_move(uuid,integer), public.nook_telegram_token(), public.nook_disconnect_telegram() to authenticated;
grant execute on function nook_private.require_bot(), nook_private.telegram_link(text,bigint,bigint), nook_private.telegram_context(bigint,bigint), nook_private.telegram_unlink(bigint,bigint), nook_private.telegram_save(bigint,bigint,bigint,text,text,text,text) to service_role;
grant execute on function public.nook_telegram_link(text,bigint,bigint), public.nook_telegram_context(bigint,bigint), public.nook_telegram_unlink(bigint,bigint), public.nook_telegram_save(bigint,bigint,bigint,text,text,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('nook-memories','nook-memories',false,10485760,array['image/jpeg','image/png','image/webp']);
create policy nook_storage_read on storage.objects for select to authenticated using (
  bucket_id = 'nook-memories' and split_part(name,'/',1) = (select nook_private.my_couple())::text
);
create policy nook_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'nook-memories' and split_part(name,'/',1) = (select nook_private.my_couple())::text
  and split_part(name,'/',2) = (select auth.uid())::text
  and name ~ '^[0-9a-f-]+/[0-9a-f-]+/[A-Za-z0-9_-]+\.(jpg|png|webp)$'
);
create policy nook_storage_delete on storage.objects for delete to authenticated using (
  bucket_id = 'nook-memories' and split_part(name,'/',1) = (select nook_private.my_couple())::text
  and split_part(name,'/',2) = (select auth.uid())::text
);

-- Enable changes for authorized subscribers, without modifying the realtime schema.
do $$ declare table_name text; begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach table_name in array array['nook_posts','nook_members','nook_games'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
        execute format('alter publication supabase_realtime add table public.%I',table_name);
      end if;
    end loop;
  end if;
end $$;

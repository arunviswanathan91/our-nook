-- Additive upgrade: retain existing accounts, memberships, posts and games.
alter table public.nook_profiles
  add column pronouns text not null default '' check (length(pronouns) <= 40),
  add column haptics boolean not null default true,
  add column quiet_mode boolean not null default false;
grant update (pronouns,haptics,quiet_mode) on public.nook_profiles to authenticated;
alter table public.nook_couples add column ritual_timezone text not null default 'UTC';
update public.nook_couples c set ritual_timezone = p.timezone from public.nook_profiles p where p.id=c.created_by;
create function nook_private.validate_ritual_timezone() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then new.ritual_timezone:=coalesce((select timezone from public.nook_profiles where id=new.created_by),'UTC'); end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.ritual_timezone) then raise exception 'Choose a valid shared time zone.'; end if;
  return new;
end $$;
create trigger nook_ritual_timezone before insert or update of ritual_timezone on public.nook_couples for each row execute function nook_private.validate_ritual_timezone();
grant update (ritual_timezone) on public.nook_couples to authenticated;

alter table public.nook_posts drop constraint nook_posts_kind_check,
  drop constraint nook_posts_check, drop constraint nook_posts_check3;
alter table public.nook_posts
  add column metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=16000),
  add constraint nook_posts_kind_check check(kind in ('note','photo','song','hug','voice','ambient','doodle')),
  add constraint nook_posts_media_check check((kind in ('photo','voice','ambient','doodle'))=(storage_path is not null)),
  add constraint nook_posts_path_check check(storage_path is null or (
    split_part(storage_path,'/',1)=couple_id::text and split_part(storage_path,'/',2)=author_id::text and
    ((kind in ('photo','doodle') and storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/[A-Za-z0-9_-]+\.(jpg|png|webp)$') or
     (kind in ('voice','ambient') and storage_path ~ '^[0-9a-f-]+/[0-9a-f-]+/[A-Za-z0-9_-]+\.(webm|mp4|m4a|ogg|mp3|wav)$'))));
alter table public.nook_posts add constraint nook_post_metadata_types check (
  (not metadata ? 'title' or (jsonb_typeof(metadata->'title')='string' and length(metadata->>'title')<=120)) and
  (not metadata ? 'artist' or (jsonb_typeof(metadata->'artist')='string' and length(metadata->>'artist')<=120)) and
  (not metadata ? 'collection' or (jsonb_typeof(metadata->'collection')='string' and length(metadata->>'collection')<=60)) and
  (not metadata ? 'duration' or (jsonb_typeof(metadata->'duration')='number' and (metadata->>'duration')::numeric between 0 and 86400))
);
grant insert (id,metadata) on public.nook_posts to authenticated;
update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav','audio/x-m4a'] where id='nook-memories';
drop policy nook_storage_insert on storage.objects;
create policy nook_storage_insert on storage.objects for insert to authenticated with check (
  bucket_id='nook-memories' and split_part(name,'/',1)=(select nook_private.my_couple())::text and
  split_part(name,'/',2)=(select auth.uid())::text and name ~ '^[0-9a-f-]+/[0-9a-f-]+/[A-Za-z0-9_-]+\.(jpg|png|webp|webm|mp4|m4a|ogg|mp3|wav)$');

create table public.nook_presence (
  user_id uuid primary key references public.nook_profiles(id) on delete cascade,
  couple_id uuid not null references public.nook_couples(id) on delete cascade,
  seen_at timestamptz not null default now(), holding_until timestamptz,
  foreign key(couple_id,user_id) references public.nook_members(couple_id,user_id)
);
create index nook_presence_couple on public.nook_presence(couple_id);
create table public.nook_signals (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.nook_couples(id) on delete cascade,
  author_id uuid not null, kind text not null check(kind in ('touch','tap','warmth','wave','kiss','clink','glimmer','hug')),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(couple_id,author_id) references public.nook_members(couple_id,user_id)
);
create index nook_signals_recent on public.nook_signals(couple_id,created_at desc);
create index nook_signals_author on public.nook_signals(author_id,created_at desc);
create table public.nook_ritual_state (
  couple_id uuid primary key references public.nook_couples(id) on delete cascade,
  plant_name text not null default 'Our little fern' check(length(btrim(plant_name)) between 1 and 60),
  water_count integer not null default 0, touch_count integer not null default 0,
  breathe_started_at timestamptz,
  listen_post_id uuid references public.nook_posts(id) on delete set null,
  listen_playing boolean not null default false, listen_position numeric not null default 0,
  listen_updated_at timestamptz, listen_by uuid references public.nook_profiles(id),
  updated_at timestamptz not null default now()
);
create index nook_ritual_listen_post on public.nook_ritual_state(listen_post_id);
create index nook_ritual_listen_by on public.nook_ritual_state(listen_by);
create table nook_private.waterings (
  couple_id uuid not null, user_id uuid not null, day_key date not null,
  created_at timestamptz not null default now(), primary key(couple_id,user_id,day_key),
  foreign key(couple_id,user_id) references public.nook_members(couple_id,user_id) on delete cascade
);
create index nook_waterings_user on nook_private.waterings(user_id);

-- Public envelope metadata contains no sealed content. Bodies remain unexposed.
create table public.nook_letters (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.nook_couples(id) on delete cascade,
  author_id uuid not null, title text not null check(length(btrim(title)) between 1 and 120),
  kind text not null check(kind in ('letter','surprise','capsule')),
  unlock_at timestamptz not null, created_at timestamptz not null default now(), opened_at timestamptz,
  has_audio boolean not null default false,
  foreign key(couple_id,author_id) references public.nook_members(couple_id,user_id)
);
create index nook_letters_couple on public.nook_letters(couple_id,created_at desc);
create index nook_letters_author on public.nook_letters(author_id);
create table nook_private.letter_contents (
  letter_id uuid primary key references public.nook_letters(id) on delete cascade,
  body text not null check(length(body)<=4000), storage_path text
);
create index nook_letter_audio on nook_private.letter_contents(storage_path) where storage_path is not null;

create table public.nook_prompts (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.nook_couples(id) on delete cascade,
  author_id uuid not null, kind text not null check(kind in ('daily','question','either','guess')),
  prompt text not null check(length(btrim(prompt)) between 1 and 500),
  options text[], audio_post_id uuid references public.nook_posts(id) on delete set null,
  day_key date, answered_by uuid[] not null default '{}', created_at timestamptz not null default now(),
  foreign key(couple_id,author_id) references public.nook_members(couple_id,user_id)
);
create index nook_prompts_couple on public.nook_prompts(couple_id,created_at desc);
create index nook_prompts_author on public.nook_prompts(author_id);
create index nook_prompts_audio on public.nook_prompts(audio_post_id);
create unique index nook_one_daily_question on public.nook_prompts(couple_id,day_key) where kind='daily';
create table nook_private.answers (
  prompt_id uuid not null references public.nook_prompts(id) on delete cascade,
  user_id uuid not null references public.nook_profiles(id) on delete cascade,
  answer text not null check(length(btrim(answer)) between 1 and 4000),
  created_at timestamptz not null default now(), primary key(prompt_id,user_id)
);
create index nook_answers_user on nook_private.answers(user_id);
create table public.nook_strokes (
  id uuid primary key default gen_random_uuid(), couple_id uuid not null references public.nook_couples(id) on delete cascade,
  author_id uuid not null, points jsonb not null, color text not null check(color in ('rose','sage','lilac','ink')),
  width integer not null check(width between 2 and 12), erased boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(couple_id,author_id) references public.nook_members(couple_id,user_id)
);
create index nook_strokes_couple on public.nook_strokes(couple_id,created_at) where not erased;
create index nook_strokes_author on public.nook_strokes(author_id);
create table public.nook_hearts (
  post_id uuid not null references public.nook_posts(id) on delete cascade,
  couple_id uuid not null references public.nook_couples(id) on delete cascade,
  user_id uuid not null, primary key(post_id,user_id),
  foreign key(couple_id,user_id) references public.nook_members(couple_id,user_id)
);
create index nook_hearts_couple on public.nook_hearts(couple_id);
create index nook_hearts_user on public.nook_hearts(user_id);

do $$ declare t text; begin
  foreach t in array array['nook_presence','nook_signals','nook_ritual_state','nook_letters','nook_prompts','nook_strokes','nook_hearts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create policy nook_couple_read on public.%I for select to authenticated using (couple_id=(select nook_private.my_couple()))',t);
  end loop;
  foreach t in array array['waterings','letter_contents','answers'] loop
    execute format('alter table nook_private.%I enable row level security',t);
    execute format('revoke all on nook_private.%I from public,anon,authenticated',t);
  end loop;
end $$;

create function nook_private.require_couple() returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid;
begin
  perform nook_private.require_user(); c:=nook_private.my_couple();
  if c is null then raise exception 'Join a nook first.' using errcode='42501'; end if;
  insert into public.nook_ritual_state(couple_id) values(c) on conflict do nothing;
  return c;
end $$;
create function nook_private.ping(p_hold boolean default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); u uuid:=auth.uid();
begin
  insert into public.nook_presence(user_id,couple_id,seen_at,holding_until)
    values(u,c,clock_timestamp(),case when p_hold then clock_timestamp()+interval '8 seconds' end)
    on conflict(user_id) do update set seen_at=excluded.seen_at,
      holding_until=case when p_hold is null then nook_presence.holding_until else excluded.holding_until end;
  return jsonb_build_object('server_now',clock_timestamp());
end $$;
create function nook_private.signal(p_kind text) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); u uuid:=auth.uid(); sid uuid;
begin
  if p_kind is null or p_kind not in ('touch','tap','warmth','wave','kiss','clink','glimmer','hug') then raise exception 'Choose a little signal.'; end if;
  perform nook_private.ping(null);
  perform 1 from public.nook_presence where user_id=u for update;
  if exists(select 1 from public.nook_signals where author_id=u and created_at>clock_timestamp()-interval '600 milliseconds') or
    (select count(*) from public.nook_signals where author_id=u and created_at>clock_timestamp()-interval '1 minute')>=40
    then raise exception 'Let that little signal arrive first.'; end if;
  insert into public.nook_signals(couple_id,author_id,kind) values(c,u,p_kind) returning id into sid;
  update public.nook_ritual_state set touch_count=touch_count+1,updated_at=now() where couple_id=c;
  -- Keep a bounded recent history. Counters live separately.
  delete from public.nook_signals where couple_id=c and created_at<now()-interval '7 days';
  return sid;
end $$;
create function nook_private.water() returns boolean
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); d date; inserted integer;
begin
  select (now() at time zone ritual_timezone)::date into d from public.nook_couples where id=c;
  insert into nook_private.waterings(couple_id,user_id,day_key) values(c,auth.uid(),d) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=1 then update public.nook_ritual_state set water_count=water_count+1,updated_at=now() where couple_id=c; end if;
  return inserted=1;
end $$;
create function nook_private.ritual_action(p_action text,p_value text default null) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple();
begin
  if p_action='breathe' then update public.nook_ritual_state set breathe_started_at=clock_timestamp(),updated_at=now() where couple_id=c;
  elsif p_action='stop_breathe' then update public.nook_ritual_state set breathe_started_at=null,updated_at=now() where couple_id=c;
  elsif p_action='plant_name' then update public.nook_ritual_state set plant_name=btrim(p_value),updated_at=now() where couple_id=c;
  else raise exception 'Unknown ritual.'; end if;
end $$;
create function nook_private.listen(p_post uuid,p_playing boolean,p_position numeric default 0) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple();
begin
  if p_playing is null or p_position is null or p_position<0 or p_position>86400 or p_position='NaN'::numeric then raise exception 'Invalid listening position.'; end if;
  if not exists(select 1 from public.nook_posts where id=p_post and couple_id=c and kind in ('song','voice','ambient')) then raise exception 'Choose something from your shared mixtape.'; end if;
  update public.nook_ritual_state set listen_post_id=p_post,listen_playing=p_playing,listen_position=p_position,
    listen_updated_at=clock_timestamp(),listen_by=auth.uid(),updated_at=now() where couple_id=c;
end $$;
create function nook_private.live_state() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); d date;
begin
  select (now() at time zone ritual_timezone)::date into d from public.nook_couples where id=c;
  return jsonb_build_object('server_now',clock_timestamp(),'day_key',d,
    'state',(select to_jsonb(s) from public.nook_ritual_state s where couple_id=c),
    'presence',coalesce((select jsonb_agg(p) from public.nook_presence p where couple_id=c),'[]'::jsonb),
    'signals',coalesce((select jsonb_agg(s) from (select * from public.nook_signals where couple_id=c order by created_at desc limit 30) s),'[]'::jsonb),
    'watered_by',coalesce((select jsonb_agg(user_id) from nook_private.waterings where couple_id=c and day_key=d),'[]'::jsonb));
end $$;

create function nook_private.create_letter(p_title text,p_body text,p_kind text,p_unlock timestamptz,p_audio text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); u uuid:=auth.uid(); lid uuid;
begin
  if p_body is null or length(p_body)>4000 or (length(btrim(p_body))=0 and p_audio is null) then raise exception 'Leave a letter or a recording inside.'; end if;
  if p_unlock is null then raise exception 'Choose when your envelope opens.'; end if;
  if p_audio is not null and not (split_part(p_audio,'/',1)=c::text and split_part(p_audio,'/',2)=u::text and p_audio ~ '^[0-9a-f-]+/[0-9a-f-]+/[A-Za-z0-9_-]+\.(webm|mp4|m4a|ogg|mp3|wav)$') then raise exception 'Invalid envelope recording.'; end if;
  insert into public.nook_letters(couple_id,author_id,title,kind,unlock_at,has_audio) values(c,u,btrim(p_title),p_kind,p_unlock,p_audio is not null) returning id into lid;
  insert into nook_private.letter_contents(letter_id,body,storage_path) values(lid,p_body,p_audio);
  return lid;
end $$;
create function nook_private.read_letter(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); l public.nook_letters; content nook_private.letter_contents;
begin
  select * into l from public.nook_letters where id=p_id and couple_id=c;
  if not found then raise exception 'Envelope not found.'; end if;
  if l.author_id<>auth.uid() and l.unlock_at>clock_timestamp() then return jsonb_build_object('locked',true,'unlock_at',l.unlock_at); end if;
  select * into content from nook_private.letter_contents where letter_id=l.id;
  if l.author_id<>auth.uid() and l.opened_at is null then update public.nook_letters set opened_at=clock_timestamp() where id=l.id; end if;
  return jsonb_build_object('locked',false,'body',content.body,'storage_path',content.storage_path);
end $$;
create function nook_private.can_read_envelope(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from nook_private.letter_contents b join public.nook_letters l on l.id=b.letter_id
    where b.storage_path=p_path and l.couple_id=nook_private.my_couple() and (l.author_id=auth.uid() or l.unlock_at<=now()));
$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('nook-envelopes','nook-envelopes',false,10485760,array['audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/wav','audio/x-m4a']);
create policy nook_envelope_read on storage.objects for select to authenticated using(bucket_id='nook-envelopes' and nook_private.can_read_envelope(name));
create policy nook_envelope_insert on storage.objects for insert to authenticated with check(bucket_id='nook-envelopes' and split_part(name,'/',1)=(select nook_private.my_couple())::text and split_part(name,'/',2)=(select auth.uid())::text and name ~ '^[0-9a-f-]+/[0-9a-f-]+/[A-Za-z0-9_-]+\.(webm|mp4|m4a|ogg|mp3|wav)$');
create policy nook_envelope_delete on storage.objects for delete to authenticated using(bucket_id='nook-envelopes' and split_part(name,'/',1)=(select nook_private.my_couple())::text and split_part(name,'/',2)=(select auth.uid())::text);

create function nook_private.ensure_daily() returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); d date; pid uuid; questions text[]:=array[
  'What little moment with me would you like to replay?', 'What would make your day feel a little softer?',
  'Where should we wander on a completely unplanned day?', 'Which song feels like our story right now?',
  'What ordinary thing are you looking forward to doing together?', 'What is one thing you wish I could see from your window?',
  'What made you smile today that I might have missed?', 'What would you put in a care package for us?',
  'What is a memory of us you keep returning to?', 'Which tiny habit of mine feels like home?',
  'What would our perfect slow Sunday look like?', 'What have you learned about yourself since we met?',
  'What is a question you have been wanting to ask me?', 'What food should we learn to make together?',
  'What helps you feel close when we are apart?', 'What is a small dream we could begin this month?',
  'What would you write on a postcard to our future selves?', 'What should we make more room for in our days?',
  'What are you proud of yourself for this week?', 'Which place would you love to show me?',
  'What would you like to hear from me on a difficult day?', 'What is the most us thing you can imagine?',
  'What is a tradition you would like us to invent?', 'What do you want to leave behind when we next meet?',
  'What did you notice today that reminded you of me?', 'What is your favourite sound in a shared memory?',
  'What would we do with one extra hour together?', 'What is something you want us to celebrate?',
  'Which adventure could fit into an ordinary evening?', 'What are you quietly grateful for today?',
  'What would you like our shared home to feel like?', 'What is one small way I can support you this week?'];
begin
  select (now() at time zone ritual_timezone)::date into d from public.nook_couples where id=c;
  insert into public.nook_prompts(couple_id,author_id,kind,prompt,day_key)
    values(c,auth.uid(),'daily',questions[1+abs(d-date '2026-01-01')%array_length(questions,1)],d)
    on conflict(couple_id,day_key) where kind='daily' do nothing;
  select id into pid from public.nook_prompts where couple_id=c and day_key=d and kind='daily'; return pid;
end $$;
create function nook_private.create_prompt(p_kind text,p_prompt text,p_options text[] default null,p_audio uuid default null,p_answer text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); pid uuid;
begin
  if p_kind is null or p_kind not in ('question','either','guess') then raise exception 'Choose a question or a little game.'; end if;
  if p_kind='either' and (p_options is null or array_length(p_options,1)<>2 or p_options[1] is null or p_options[2] is null or length(btrim(p_options[1])) not between 1 and 120 or length(btrim(p_options[2])) not between 1 and 120 or p_options[1]=p_options[2]) then raise exception 'Add two different choices.'; end if;
  if p_kind='guess' and (p_answer is null or length(btrim(p_answer)) not between 1 and 120 or not exists(select 1 from public.nook_posts where id=p_audio and couple_id=c and author_id=auth.uid() and kind in ('voice','ambient'))) then raise exception 'Record a sound and add its answer first.'; end if;
  insert into public.nook_prompts(couple_id,author_id,kind,prompt,options,audio_post_id)
    values(c,auth.uid(),p_kind,btrim(p_prompt),case when p_kind='either' then p_options end,case when p_kind='guess' then p_audio end) returning id into pid;
  if p_kind='guess' then
    insert into nook_private.answers(prompt_id,user_id,answer) values(pid,auth.uid(),btrim(p_answer));
    update public.nook_prompts set answered_by=array[auth.uid()] where id=pid;
  end if;
  return pid;
end $$;
create function nook_private.answer(p_id uuid,p_answer text) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); p public.nook_prompts; u uuid:=auth.uid();
begin
  select * into p from public.nook_prompts where id=p_id and couple_id=c for update;
  if not found then raise exception 'Question not found.'; end if;
  if cardinality(p.answered_by)>=2 then raise exception 'You have both opened this question already.'; end if;
  if p.kind='either' and not (p_answer=any(p.options)) then raise exception 'Choose one of the two options.'; end if;
  insert into nook_private.answers(prompt_id,user_id,answer) values(p_id,u,btrim(p_answer))
    on conflict(prompt_id,user_id) do update set answer=excluded.answer,created_at=now();
  update public.nook_prompts set answered_by=(select array_agg(user_id) from nook_private.answers where prompt_id=p_id) where id=p_id;
end $$;
create function nook_private.stroke(p_points jsonb,p_color text,p_width integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); v jsonb; sid uuid;
begin
  if p_points is null or jsonb_typeof(p_points)<>'array' or jsonb_array_length(p_points) not between 1 and 250 then raise exception 'This doodle stroke is too long.'; end if;
  for v in select value from jsonb_array_elements(p_points) loop
    if jsonb_typeof(v)<>'array' or jsonb_array_length(v)<>2 or jsonb_typeof(v->0)<>'number' or jsonb_typeof(v->1)<>'number' then raise exception 'Invalid doodle points.'; end if;
    if (v->>0)::numeric not between 0 and 1000 or (v->>1)::numeric not between 0 and 1000 then raise exception 'Keep your doodle on the page.'; end if;
  end loop;
  perform 1 from public.nook_ritual_state where couple_id=c for update;
  if (select count(*) from public.nook_strokes where couple_id=c and not erased)>=500 then raise exception 'Save this drawing, then clear the paper for a new one.'; end if;
  insert into public.nook_strokes(couple_id,author_id,points,color,width) values(c,auth.uid(),p_points,p_color,p_width) returning id into sid; return sid;
end $$;
create function nook_private.erase_strokes(p_all boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); sid uuid;
begin
  if p_all then update public.nook_strokes set erased=true where couple_id=c and not erased;
  else
    select id into sid from public.nook_strokes where couple_id=c and author_id=auth.uid() and not erased order by created_at desc limit 1;
    update public.nook_strokes set erased=true where id=sid;
  end if;
end $$;
create function nook_private.heart(p_post uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); removed integer;
begin
  perform 1 from public.nook_posts where id=p_post and couple_id=c for update;
  if not found then raise exception 'Memory not found.'; end if;
  delete from public.nook_hearts where post_id=p_post and user_id=auth.uid(); get diagnostics removed=row_count;
  if removed=0 then insert into public.nook_hearts(post_id,couple_id,user_id) values(p_post,c,auth.uid()); end if;
  return removed=0;
end $$;
create function nook_private.rituals() returns jsonb
language plpgsql security definer set search_path='' as $$
declare c uuid:=nook_private.require_couple(); daily uuid;
begin
  daily:=nook_private.ensure_daily();
  return jsonb_build_object('live',nook_private.live_state(),'daily_id',daily,
    'letters',coalesce((select jsonb_agg(l) from (select * from public.nook_letters where couple_id=c order by created_at desc limit 100) l),'[]'::jsonb),
    'prompts',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('answers',coalesce((select jsonb_agg(a) from (select user_id,answer,created_at from nook_private.answers where prompt_id=p.id and (user_id=auth.uid() or cardinality(p.answered_by)>=2)) a),'[]'::jsonb))) from (select * from public.nook_prompts where couple_id=c order by (id=daily) desc,created_at desc limit 100) p),'[]'::jsonb),
    'strokes',coalesce((select jsonb_agg(s order by created_at) from public.nook_strokes s where couple_id=c and not erased),'[]'::jsonb),
    'hearts',coalesce((select jsonb_agg(h) from public.nook_hearts h where couple_id=c),'[]'::jsonb));
end $$;

-- Thin public invoker wrappers; all membership checks happen inside the private implementations.
create function public.nook_ping(p_hold boolean default null) returns jsonb language sql security invoker set search_path='' as $$ select nook_private.ping(p_hold); $$;
create function public.nook_signal(p_kind text) returns uuid language sql security invoker set search_path='' as $$ select nook_private.signal(p_kind); $$;
create function public.nook_water() returns boolean language sql security invoker set search_path='' as $$ select nook_private.water(); $$;
create function public.nook_ritual_action(p_action text,p_value text default null) returns void language sql security invoker set search_path='' as $$ select nook_private.ritual_action(p_action,p_value); $$;
create function public.nook_listen(p_post uuid,p_playing boolean,p_position numeric default 0) returns void language sql security invoker set search_path='' as $$ select nook_private.listen(p_post,p_playing,p_position); $$;
create function public.nook_live_state() returns jsonb language sql security invoker set search_path='' as $$ select nook_private.live_state(); $$;
create function public.nook_create_letter(p_title text,p_body text,p_kind text,p_unlock timestamptz,p_audio text default null) returns uuid language sql security invoker set search_path='' as $$ select nook_private.create_letter(p_title,p_body,p_kind,p_unlock,p_audio); $$;
create function public.nook_read_letter(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select nook_private.read_letter(p_id); $$;
create function public.nook_create_prompt(p_kind text,p_prompt text,p_options text[] default null,p_audio uuid default null,p_answer text default null) returns uuid language sql security invoker set search_path='' as $$ select nook_private.create_prompt(p_kind,p_prompt,p_options,p_audio,p_answer); $$;
create function public.nook_answer(p_id uuid,p_answer text) returns void language sql security invoker set search_path='' as $$ select nook_private.answer(p_id,p_answer); $$;
create function public.nook_stroke(p_points jsonb,p_color text,p_width integer) returns uuid language sql security invoker set search_path='' as $$ select nook_private.stroke(p_points,p_color,p_width); $$;
create function public.nook_erase_strokes(p_all boolean default false) returns void language sql security invoker set search_path='' as $$ select nook_private.erase_strokes(p_all); $$;
create function public.nook_heart(p_post uuid) returns boolean language sql security invoker set search_path='' as $$ select nook_private.heart(p_post); $$;
create function public.nook_rituals() returns jsonb language sql security invoker set search_path='' as $$ select nook_private.rituals(); $$;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='nook_private' and p.proname in ('validate_ritual_timezone','require_couple','ping','signal','water','ritual_action','listen','live_state','create_letter','read_letter','can_read_envelope','ensure_daily','create_prompt','answer','stroke','erase_strokes','heart','rituals')) or
      (n.nspname='public' and p.proname in ('nook_ping','nook_signal','nook_water','nook_ritual_action','nook_listen','nook_live_state','nook_create_letter','nook_read_letter','nook_create_prompt','nook_answer','nook_stroke','nook_erase_strokes','nook_heart','nook_rituals')) loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    if f.proname<>'validate_ritual_timezone' then execute format('grant execute on function %s to authenticated',f.signature); end if;
  end loop;
end $$;
do $$ declare t text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array['nook_presence','nook_signals','nook_ritual_state','nook_letters','nook_prompts','nook_strokes','nook_hearts','nook_profiles','nook_couples'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then execute format('alter publication supabase_realtime add table public.%I',t); end if;
    end loop;
  end if;
end $$;

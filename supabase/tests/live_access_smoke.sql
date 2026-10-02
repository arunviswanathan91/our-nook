-- Run through an administrative SQL connection. Existing app data is untouched.
-- All synthetic users and content are rolled back; no email is sent.
begin;
do $$
declare
  first_user uuid := gen_random_uuid();
  second_user uuid := gen_random_uuid();
  outsider uuid := gen_random_uuid();
  couple uuid;
  invitation jsonb;
  joined jsonb;
  game uuid;
  daily uuid;
  envelope uuid;
  clip uuid;
  drawing uuid;
  snapshot jsonb;
  audio_path text;
  base_role text := current_user;
begin
  insert into auth.users(id, email, email_confirmed_at)
    values (first_user, first_user::text || '@example.invalid', now()),
           (second_user, second_user::text || '@example.invalid', now()),
           (outsider, outsider::text || '@example.invalid', now());
  insert into public.nook_profiles(id) values (first_user), (second_user), (outsider);
  perform set_config('request.jwt.claim.sub', first_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',first_user,'role','authenticated')::text, true);
  set local role authenticated;
  couple := public.nook_create_couple('Temporary verification nook');
  invitation := public.nook_issue_invite();
  insert into public.nook_posts(couple_id,author_id,kind,body) values (couple,first_user,'note','Temporary verification note');

  perform set_config('request.jwt.claim.sub', second_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',second_user,'role','authenticated')::text, true);
  joined := public.nook_join_couple(invitation->>'code');
  if joined ? 'error' then raise exception 'Partner join failed'; end if;
  if (select count(*) from public.nook_posts where couple_id=couple) <> 1 then raise exception 'Partner cannot read note'; end if;
  game := public.nook_start_game();
  perform public.nook_play_move(game,0);

  -- The same daily question is shared, but the first answer is not.
  snapshot := public.nook_rituals(); daily := (snapshot->>'daily_id')::uuid;
  perform public.nook_answer(daily,'A synthetic answer that must stay sealed');
  perform set_config('request.jwt.claim.sub', first_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',first_user,'role','authenticated')::text, true);
  snapshot := public.nook_rituals();
  if (snapshot->>'daily_id')::uuid<>daily then raise exception 'Daily question differs between partners'; end if;
  if exists(select 1 from jsonb_array_elements(snapshot->'prompts') p where (p->>'id')::uuid=daily and jsonb_array_length(p->'answers')<>0) then raise exception 'Unrevealed partner answer leaked'; end if;
  perform public.nook_answer(daily,'The synthetic second answer');
  snapshot := public.nook_rituals();
  if not exists(select 1 from jsonb_array_elements(snapshot->'prompts') p where (p->>'id')::uuid=daily and jsonb_array_length(p->'answers')=2) then raise exception 'Both answers did not reveal'; end if;
  if has_table_privilege('authenticated','nook_private.answers','select') or has_table_privilege('authenticated','nook_private.letter_contents','select') then raise exception 'Private content tables are exposed'; end if;

  audio_path := couple::text||'/'||first_user::text||'/verification.m4a';
  envelope := public.nook_create_letter('Synthetic sealed capsule','Synthetic private body','capsule',now()+interval '1 day',audio_path);
  if public.nook_read_letter(envelope)->>'body'<>'Synthetic private body' then raise exception 'Author cannot preview letter'; end if;
  if not nook_private.can_read_envelope(audio_path) then raise exception 'Author cannot access letter audio'; end if;
  if not public.nook_water() or public.nook_water() then raise exception 'Daily watering is not idempotent'; end if;
  perform public.nook_ping(true);
  if not exists(select 1 from public.nook_presence where user_id=first_user and holding_until>now() and holding_until<=clock_timestamp()+interval '8 seconds') then raise exception 'Touch expiry is invalid'; end if;
  perform public.nook_ping(false);
  perform public.nook_signal('kiss');
  clip:=gen_random_uuid();
  insert into public.nook_posts(id,couple_id,author_id,kind,storage_path,metadata) values(clip,couple,first_user,'voice',audio_path,'{"title":"Synthetic clip","duration":1}');
  perform public.nook_listen(clip,true,0);
  drawing:=public.nook_stroke('[[10,10],[20,20]]','rose',7);

  perform set_config('request.jwt.claim.sub', second_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',second_user,'role','authenticated')::text, true);
  snapshot:=public.nook_read_letter(envelope);
  if snapshot->>'locked'<>'true' or snapshot ? 'body' or snapshot ? 'storage_path' then raise exception 'Sealed envelope leaked its content'; end if;
  if nook_private.can_read_envelope(audio_path) then raise exception 'Partner can read sealed audio'; end if;
  if not public.nook_water() then raise exception 'Second partner cannot water'; end if;
  snapshot:=public.nook_live_state();
  if (snapshot->'state'->>'water_count')::int<>2 then raise exception 'Shared plant count is wrong'; end if;
  if (snapshot->'state'->>'listen_post_id')::uuid<>clip then raise exception 'Partner cannot see shared playback'; end if;
  if not exists(select 1 from public.nook_strokes where id=drawing) then raise exception 'Partner cannot see drawing'; end if;

  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',outsider,'role','authenticated')::text, true);
  if exists (select 1 from public.nook_posts where couple_id=couple) then raise exception 'Outsider can read note'; end if;
  if exists (select 1 from public.nook_games where id=game) then raise exception 'Outsider can read game'; end if;
  if exists (select 1 from public.nook_profiles where id in (first_user,second_user)) then raise exception 'Outsider can read profiles'; end if;
  if exists (select 1 from public.nook_letters where id=envelope) or exists(select 1 from public.nook_strokes where id=drawing) or exists(select 1 from public.nook_signals where couple_id=couple) then raise exception 'Outsider can read rituals'; end if;
  if nook_private.can_read_envelope(audio_path) then raise exception 'Outsider can read envelope audio'; end if;
  joined := public.nook_join_couple(invitation->>'code');
  if not (joined ? 'error') then raise exception 'Third member was accepted'; end if;
  if has_table_privilege('authenticated','public.nook_members','insert') then raise exception 'Direct membership writes are permitted'; end if;
  if has_function_privilege('anon','public.nook_join_couple(text)','execute') then raise exception 'Anonymous joins are permitted'; end if;
  execute format('set local role %I',base_role);
end $$;
rollback;
select 'Live pairing, shared rituals, sealed content and outsider checks passed; synthetic data rolled back' as result;

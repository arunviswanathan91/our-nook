-- Run through an administrative SQL connection on an empty deployment.
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

  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub',outsider,'role','authenticated')::text, true);
  if exists (select 1 from public.nook_posts where couple_id=couple) then raise exception 'Outsider can read note'; end if;
  if exists (select 1 from public.nook_games where id=game) then raise exception 'Outsider can read game'; end if;
  if exists (select 1 from public.nook_profiles where id in (first_user,second_user)) then raise exception 'Outsider can read profiles'; end if;
  joined := public.nook_join_couple(invitation->>'code');
  if not (joined ? 'error') then raise exception 'Third member was accepted'; end if;
  if has_table_privilege('authenticated','public.nook_members','insert') then raise exception 'Direct membership writes are permitted'; end if;
  if has_function_privilege('anon','public.nook_join_couple(text)','execute') then raise exception 'Anonymous joins are permitted'; end if;
  execute format('set local role %I',base_role);
end $$;
rollback;
select 'Live couple access checks passed; synthetic data rolled back' as result;

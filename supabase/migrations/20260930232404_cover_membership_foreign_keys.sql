-- Cover composite membership foreign keys for joins and referential checks.
create index nook_posts_member on public.nook_posts(couple_id, author_id);
create index nook_games_member_x on public.nook_games(couple_id, player_x);
create index nook_games_member_o on public.nook_games(couple_id, player_o);

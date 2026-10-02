-- Cover composite membership foreign keys used by partner authorization and cleanup.
create index nook_presence_member on public.nook_presence(couple_id,user_id);
create index nook_signals_member on public.nook_signals(couple_id,author_id);
create index nook_letters_member on public.nook_letters(couple_id,author_id);
create index nook_prompts_member on public.nook_prompts(couple_id,author_id);
create index nook_strokes_member on public.nook_strokes(couple_id,author_id);
create index nook_hearts_member on public.nook_hearts(couple_id,user_id);

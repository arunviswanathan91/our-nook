import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

// Real PostgreSQL engine in WASM. Only Supabase-owned auth/storage schemas and
// roles are fixtures; the app schema and RPCs are loaded from the real migration.
const db = new PGlite()
const ids = Array.from({ length: 9 }, (_, i) => `00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`)
let firstCouple, secondCouple, firstPost, currentCode, game
async function admin() { await db.exec('reset role') }
async function user(index) {
  await admin()
  await db.query("select set_config('request.jwt.claim.sub',$1,false), set_config('request.jwt.claims',$2,false)",[ids[index], JSON.stringify({ role:'authenticated', sub:ids[index] })])
  await db.exec('set role authenticated')
}
async function bot() {
  await admin()
  await db.query("select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claims',$1,false)",[JSON.stringify({ role:'service_role' })])
  await db.exec('set role service_role')
}
async function rpc(name, values = []) {
  const placeholders = values.map((_,i) => '$'+(i+1)).join(',')
  return (await db.query(`select public.nook_${name}(${placeholders}) as value`, values)).rows[0].value
}
async function rejected(work, pattern = /permission denied|row-level security/) { await assert.rejects(work, pattern) }

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated,service_role;
    grant select on storage.buckets to authenticated,service_role;
  `)
  for (const name of readdirSync(new URL('../supabase/migrations/',import.meta.url)).filter(n => n.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'))
  }
  for (const id of ids) await db.query('insert into auth.users(id,email_confirmed_at) values ($1,now())',[id])
  for (let i=0;i<ids.length;i++) { await user(i); await db.query('insert into public.nook_profiles(id) values ($1)',[ids[i]]) }
})
after(async () => { await db.close() })

describe('Couple authorization and invitation codes', { concurrency:false }, () => {
  it('enables RLS everywhere and keeps public RPCs as invokers', async () => {
    await admin()
    const { rows } = await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname='nook_private' or (n.nspname='public' and c.relname like 'nook_%')) and c.relkind='r' and not c.relrowsecurity")
    assert.deepEqual(rows,[])
    const functions = await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname like 'nook_%' and (prosecdef or has_function_privilege('anon',p.oid,'execute'))")
    assert.deepEqual(functions.rows,[])
  })
  it('shows only the user’s profile before pairing', async () => {
    await user(0)
    assert.equal((await db.query('select count(*)::int as n from public.nook_profiles')).rows[0].n,1)
    await rejected(() => db.query('insert into public.nook_profiles(id) values ($1)',[crypto.randomUUID()]),/row-level security/)
  })
  it('creates a space, keeps outsiders out, and permits only one space per account', async () => {
    await user(0); firstCouple = await rpc('create_couple',['First nook'])
    assert.ok(firstCouple)
    await rejected(() => rpc('create_couple',['Another nook']),/already belong/)
    await user(1)
    assert.equal((await db.query('select count(*)::int as n from public.nook_couples')).rows[0].n,0)
    await rejected(() => db.query('insert into public.nook_members(user_id,couple_id) values ($1,$2)',[ids[1],firstCouple]))
  })
  it('rotates codes, stores only hashes, and accepts a formatted partner code once', async () => {
    await user(0)
    const old = (await rpc('issue_invite')).code
    currentCode = (await rpc('issue_invite')).code
    assert.match(currentCode,/^[0-9A-F]{20}$/)
    await admin()
    const hash = (await db.query('select token_hash from nook_private.invites')).rows[0].token_hash
    assert.equal(hash.length,64); assert.notEqual(hash,currentCode)
    await user(1)
    assert.ok((await rpc('join_couple',[old])).error)
    assert.equal((await rpc('join_couple',[currentCode.match(/.{4}/g).join('-').toLowerCase()])).couple_id,firstCouple)
    assert.equal((await db.query('select count(*)::int as n from public.nook_profiles')).rows[0].n,2)
    await user(2)
    assert.ok((await rpc('join_couple',[currentCode])).error)
    await admin()
    assert.equal((await db.query('select count(*)::int as n from public.nook_members where couple_id=$1',[firstCouple])).rows[0].n,2)
  })
  it('rejects expired codes and counts failed attempts without rolling them back', async () => {
    await user(2); secondCouple = await rpc('create_couple',['Second nook'])
    const expired = (await rpc('issue_invite')).code
    await admin(); await db.query("update nook_private.invites set expires_at=now()-interval '1 second' where couple_id=$1",[secondCouple])
    await user(3); assert.ok((await rpc('join_couple',[expired])).error)
    await user(2); const active = (await rpc('issue_invite')).code
    await user(3)
    for(let i=0;i<9;i++) assert.ok((await rpc('join_couple',['wrong'])).error)
    assert.match((await rpc('join_couple',[active])).error,/Too many/)
    await admin(); await db.query("update nook_private.join_attempts set window_start=now()-interval '16 minutes' where user_id=$1",[ids[3]])
    await user(3); assert.equal((await rpc('join_couple',[active])).couple_id,secondCouple)
  })
  it('prevents cross-couple reads, forged authors, and membership reassignment', async () => {
    await user(0)
    firstPost = (await db.query("insert into public.nook_posts(couple_id,author_id,kind,body) values ($1,$2,'note','Private memory') returning id",[firstCouple,ids[0]])).rows[0].id
    await rejected(() => db.query("insert into public.nook_posts(couple_id,author_id,kind,body) values ($1,$2,'note','Forged')",[firstCouple,ids[1]]))
    await rejected(() => db.query('update public.nook_couples set created_by=$1 where id=$2',[ids[1],firstCouple]))
    await rejected(() => db.query('update public.nook_members set couple_id=$1 where user_id=$2',[secondCouple,ids[0]]))
    await user(1); assert.equal((await db.query('select id from public.nook_posts where id=$1',[firstPost])).rows.length,1)
    await user(2); assert.equal((await db.query('select id from public.nook_posts where id=$1',[firstPost])).rows.length,0)
    await rejected(() => db.query("insert into public.nook_posts(couple_id,author_id,kind,body) values ($1,$2,'note','Intrusion')",[firstCouple,ids[2]]))
    assert.equal((await db.query('delete from public.nook_posts where id=$1 returning id',[firstPost])).rows.length,0)
  })
  it('validates time zones and restricts profile edits to the owner', async () => {
    await user(0)
    await rejected(() => db.query("update public.nook_profiles set timezone='Not/A_Timezone' where id=$1",[ids[0]]),/valid time zone/)
    await db.query("update public.nook_profiles set timezone='America/New_York', city='New York' where id=$1",[ids[0]])
    await user(1)
    assert.equal((await db.query("update public.nook_profiles set city='Changed' where id=$1 returning id",[ids[0]])).rows.length,0)
  })
  it('protects photo objects and rejects uploads under another user’s path', async () => {
    const path = `${firstCouple}/${ids[0]}/photo.jpg`
    await user(0); await db.query("insert into storage.objects(bucket_id,name) values ('nook-memories',$1)",[path])
    await user(1)
    assert.equal((await db.query('select * from storage.objects')).rows.length,1)
    assert.equal((await db.query('delete from storage.objects returning id')).rows.length,0)
    await rejected(() => db.query("insert into storage.objects(bucket_id,name) values ('nook-memories',$1)",[`${firstCouple}/${ids[0]}/forged.jpg`]))
    await user(2)
    assert.equal((await db.query('select * from storage.objects')).rows.length,0)
    await rejected(() => db.query("insert into storage.objects(bucket_id,name) values ('nook-memories',$1)",[`${firstCouple}/${ids[2]}/outside.jpg`]))
  })
  it('serializes game turns and prevents outsiders or direct board edits', async () => {
    await user(0); game = await rpc('start_game')
    await user(1); assert.equal(await rpc('start_game'),game)
    await rejected(() => rpc('play_move',[game,0]),/Wait for your turn/)
    await rejected(() => db.query("update public.nook_games set winner=$1 where id=$2",[ids[1],game]))
    await user(2); await rejected(() => rpc('play_move',[game,0]),/Game not found/)
    for(const [who,cell] of [[0,0],[1,3],[0,1],[1,4],[0,2]]) { await user(who); await rpc('play_move',[game,cell]) }
    const saved = (await db.query('select * from public.nook_games where id=$1',[game])).rows[0]
    assert.equal(saved.status,'won'); assert.equal(saved.winner,ids[0]); assert.equal(saved.turn_user,null)
    await rejected(() => rpc('play_move',[game,8]),/Wait for your turn/)
  })
  it('requires service authorization for Telegram and consumes link tokens once', async () => {
    await user(0)
    const token = (await rpc('telegram_token')).token
    await rejected(() => rpc('telegram_link',[token,123,123]))
    await bot(); assert.equal(await rpc('telegram_link',[token,123,123]),true)
    assert.equal(await rpc('telegram_link',[token,123,123]),false)
    assert.equal((await rpc('telegram_context',[123,123])).user_id,ids[0])
    assert.equal(await rpc('telegram_context',[123,-100]),null)
    await user(1); const otherToken = (await rpc('telegram_token')).token
    await bot(); await rejected(() => rpc('telegram_link',[otherToken,123,123]),/Disconnect your other/)
    assert.equal((await rpc('telegram_context',[123,123])).user_id,ids[0])
  })
  it('deduplicates Telegram updates and preserves couple boundaries', async () => {
    await bot()
    assert.equal(await rpc('telegram_save',[100,123,123,'note','Hello from Telegram',null,null]),true)
    assert.equal(await rpc('telegram_save',[100,123,123,'note','Hello from Telegram',null,null]),false)
    await rejected(() => rpc('telegram_save',[101,123,123,'photo','Photo',null,`${secondCouple}/${ids[0]}/photo.jpg`]),/check constraint/)
    await user(0)
    assert.equal((await db.query("select count(*)::int as n from public.nook_posts where body='Hello from Telegram'")).rows[0].n,1)
    await rpc('disconnect_telegram')
    await bot(); assert.equal(await rpc('telegram_context',[123,123]),null)
  })
  it('denies unverified accounts and anonymous callers', async () => {
    await admin(); await db.query('update auth.users set email_confirmed_at=null where id=$1',[ids[8]])
    await user(8); await rejected(() => rpc('create_couple',['Unverified']),/verified email/)
    await admin(); await db.exec('set role anon')
    await rejected(() => rpc('create_couple',['Anonymous']))
    await rejected(() => db.query('select * from public.nook_posts'))
  })
})

describe('Shared rituals and sealed content', { concurrency:false }, () => {
  let daily, letter, audioPath, clip, choice, guess
  it('uses one question and shared calendar day for both partners', async () => {
    await user(0)
    await db.query("update public.nook_couples set ritual_timezone='Pacific/Kiritimati' where id=$1",[firstCouple])
    await rejected(()=>db.query("update public.nook_couples set ritual_timezone='Invalid/Zone' where id=$1",[firstCouple]),/valid shared time zone/)
    const a=await rpc('rituals');daily=a.daily_id
    assert.equal(a.live.day_key,new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Kiritimati',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))
    await user(1);assert.equal((await rpc('rituals')).daily_id,daily)
    await user(2);assert.notEqual((await rpc('rituals')).daily_id,daily)
  })
  it('never exposes an unanswered partner’s secret through tables or snapshots', async () => {
    await user(0);await rpc('answer',[daily,'A secret sunrise together'])
    assert.equal((await rpc('rituals')).prompts.find(p=>p.id===daily).answers[0].answer,'A secret sunrise together')
    await user(1)
    const question=(await rpc('rituals')).prompts.find(p=>p.id===daily)
    assert.deepEqual(question.answers,[]);assert.deepEqual(question.answered_by,[ids[0]])
    await rejected(()=>db.query('select * from nook_private.answers'))
    await rejected(()=>db.query('update public.nook_prompts set answered_by=$1 where id=$2',[[ids[0],ids[1]],daily]))
    await user(2);await rejected(()=>rpc('answer',[daily,'Intrusion']),/Question not found/)
    assert.equal((await rpc('rituals')).prompts.some(p=>p.id===daily),false)
    await user(1);await rpc('answer',[daily,'Coffee and the sea'])
    assert.deepEqual((await rpc('rituals')).prompts.find(p=>p.id===daily).answers.map(a=>a.answer).sort(),['A secret sunrise together','Coffee and the sea'])
    await user(0);assert.equal((await rpc('rituals')).prompts.find(p=>p.id===daily).answers.length,2)
    await rejected(()=>rpc('answer',[daily,'Change after reveal']),/both opened/)
  })
  it('keeps both the sealed letter body and its storage object locked until server time', async () => {
    await user(0);audioPath=`${firstCouple}/${ids[0]}/sealed.m4a`
    await db.query("insert into storage.objects(bucket_id,name) values ('nook-envelopes',$1)",[audioPath])
    letter=await rpc('create_letter',['For our reunion','Secret letter body','capsule',new Date(Date.now()+86400000).toISOString(),audioPath])
    assert.equal((await rpc('read_letter',[letter])).body,'Secret letter body')
    await user(1)
    assert.equal((await rpc('rituals')).letters[0].title,'For our reunion')
    const locked=await rpc('read_letter',[letter]);assert.equal(locked.locked,true);assert.equal('body' in locked,false);assert.equal('storage_path' in locked,false)
    assert.equal((await db.query("select * from storage.objects where bucket_id='nook-envelopes'")).rows.length,0)
    await rejected(()=>db.query('select * from nook_private.letter_contents'))
    await rejected(()=>db.query('update public.nook_letters set unlock_at=now() where id=$1',[letter]))
    await user(2);await rejected(()=>rpc('read_letter',[letter]),/Envelope not found/)
    await admin();await db.query("update public.nook_letters set unlock_at=now()-interval '1 second' where id=$1",[letter])
    await user(1);assert.equal((await rpc('read_letter',[letter])).body,'Secret letter body')
    assert.equal((await db.query("select * from storage.objects where bucket_id='nook-envelopes'")).rows.length,1)
    assert.ok((await rpc('rituals')).letters[0].opened_at)
    await user(2);assert.equal((await db.query("select * from storage.objects where bucket_id='nook-envelopes'")).rows.length,0)
  })
  it('validates recordings and their owner paths while preserving existing photos', async () => {
    await user(0)
    const path=`${firstCouple}/${ids[0]}/whisper.webm`;clip=crypto.randomUUID()
    await db.query("insert into storage.objects(bucket_id,name) values ('nook-memories',$1)",[path])
    await db.query("insert into public.nook_posts(id,couple_id,author_id,kind,storage_path,metadata) values ($1,$2,$3,'voice',$4,$5)",[clip,firstCouple,ids[0],path,{title:'Guess my sound',duration:3}])
    await rejected(()=>db.query("insert into public.nook_posts(couple_id,author_id,kind,storage_path) values ($1,$2,'voice',$3)",[firstCouple,ids[0],`${firstCouple}/${ids[1]}/forged.webm`]),/check constraint/)
    await rejected(()=>rpc('create_letter',['Bad audio','','letter',new Date().toISOString(),`${firstCouple}/${ids[1]}/sealed.m4a`]),/Invalid envelope recording/)
    await rejected(()=>db.query("insert into public.nook_posts(couple_id,author_id,kind,body,metadata) values ($1,$2,'note','Hi',$3)",[firstCouple,ids[0],{title:{bad:'shape'}}]),/check constraint/)
    await user(2);assert.equal((await db.query('select * from public.nook_posts where id=$1',[clip])).rows.length,0)
  })
  it('validates either-or choices and keeps the sound-game answer secret until guessed', async () => {
    await user(0)
    await rejected(()=>rpc('create_prompt',['either','Our date?',['Same','Same']]),/different choices/)
    choice=await rpc('create_prompt',['either','Our date?',['Beach','Mountains']])
    await rejected(()=>rpc('answer',[choice,'Neither']),/two options/)
    await rpc('answer',[choice,'Beach'])
    guess=await rpc('create_prompt',['guess','What is this?',null,clip,'Rain on the window'])
    await user(1)
    assert.deepEqual((await rpc('rituals')).prompts.find(p=>p.id===guess).answers,[])
    await rpc('answer',[guess,'Rain?'])
    assert.equal((await rpc('rituals')).prompts.find(p=>p.id===guess).answers.length,2)
    await user(2);await rejected(()=>rpc('create_prompt',['guess','Foreign clip',null,clip,'Rain']),/Record a sound/)
  })
  it('waters once per person per shared day and allows each partner to contribute', async () => {
    await user(0);assert.equal(await rpc('water'),true);assert.equal(await rpc('water'),false)
    await user(1);assert.equal(await rpc('water'),true);assert.equal(await rpc('water'),false)
    const live=await rpc('live_state');assert.equal(live.state.water_count,2);assert.equal(live.watered_by.length,2)
    await rejected(()=>db.query('update public.nook_ritual_state set water_count=100'))
    await user(2);assert.equal((await rpc('live_state')).state.water_count,0)
  })
  it('records only the caller’s presence and gives held touches a short server expiry', async () => {
    await user(0);await rpc('ping',[true]);let live=await rpc('live_state')
    const held=live.presence.find(p=>p.user_id===ids[0]);const left=Date.parse(held.holding_until)-Date.parse(live.server_now)
    assert.ok(left>0&&left<=8000)
    await rpc('ping');assert.equal((await rpc('live_state')).presence.find(p=>p.user_id===ids[0]).holding_until,held.holding_until)
    await rpc('ping',[false]);assert.equal((await rpc('live_state')).presence.find(p=>p.user_id===ids[0]).holding_until,null)
    await rejected(()=>db.query('update public.nook_presence set user_id=$1',[ids[1]]))
    await user(2);assert.equal((await rpc('live_state')).presence.some(p=>p.user_id===ids[0]),false)
  })
  it('sends a partner signal once, rejects flooding, and keeps other nooks isolated', async () => {
    await user(0);const id=await rpc('signal',['kiss'])
    await rejected(()=>rpc('signal',['hug']),/arrive first/)
    await rejected(()=>rpc('signal',['invalid']),/Choose a little signal/)
    await user(1);const live=await rpc('live_state');assert.equal(live.signals[0].id,id);assert.equal(live.signals[0].author_id,ids[0]);assert.equal(live.state.touch_count,1)
    await user(2);assert.equal((await rpc('live_state')).signals.some(s=>s.id===id),false)
  })
  it('validates shared drawing coordinates and undoes only the caller’s last stroke', async () => {
    await user(0)
    await rejected(()=>rpc('stroke',[JSON.stringify([[1001,2]]),'rose',7]),/on the page/)
    await rejected(()=>rpc('stroke',[JSON.stringify([['x',2]]),'rose',7]),/Invalid doodle/)
    await rejected(()=>rpc('stroke',[JSON.stringify([[2,2]]),'red',7]),/check constraint/)
    const mine=await rpc('stroke',[JSON.stringify([[2,2],[100,200]]),'rose',7])
    await user(1);const theirs=await rpc('stroke',[JSON.stringify([[3,3]]),'sage',7]);await rpc('erase_strokes',[false])
    let strokes=(await rpc('rituals')).strokes;assert.ok(strokes.some(s=>s.id===mine));assert.equal(strokes.some(s=>s.id===theirs),false)
    await user(2);assert.equal((await rpc('rituals')).strokes.some(s=>s.id===mine),false);await rpc('erase_strokes',[true])
    await user(0);assert.equal((await rpc('rituals')).strokes.length,1);await rpc('erase_strokes',[true]);assert.equal((await rpc('rituals')).strokes.length,0)
  })
  it('shares playback and hearts only for a post in the caller’s own nook', async () => {
    await user(0);await rpc('listen',[clip,true,12]);assert.equal(await rpc('heart',[firstPost]),true)
    await user(1);let live=await rpc('live_state');assert.equal(live.state.listen_post_id,clip);assert.equal(Number(live.state.listen_position),12)
    await rpc('listen',[clip,false,15]);assert.equal((await rpc('live_state')).state.listen_playing,false)
    assert.equal((await rpc('rituals')).hearts[0].user_id,ids[0])
    await rejected(()=>rpc('listen',[clip,true,-1]),/Invalid listening position/)
    await user(2);await rejected(()=>rpc('listen',[clip,true,0]),/shared mixtape/);await rejected(()=>rpc('heart',[firstPost]),/Memory not found/)
    await user(0);assert.equal(await rpc('heart',[firstPost]),false)
  })
  it('keeps quiet mode, haptics and pronouns editable only by their owner', async () => {
    await user(0);await db.query("update public.nook_profiles set haptics=false,quiet_mode=true,pronouns='they/them' where id=$1",[ids[0]])
    await user(1);assert.equal((await db.query('update public.nook_profiles set haptics=true where id=$1 returning id',[ids[0]])).rows.length,0)
    const p=(await db.query('select * from public.nook_profiles where id=$1',[ids[0]])).rows[0];assert.equal(p.haptics,false);assert.equal(p.quiet_mode,true);assert.equal(p.pronouns,'they/them')
  })
  it('denies ritual access before joining and for anonymous or unverified callers', async () => {
    await user(4);await rejected(()=>rpc('rituals'),/Join a nook first/)
    await user(8);await rejected(()=>rpc('rituals'),/verified email/)
    await admin();await db.exec('set role anon');await rejected(()=>rpc('rituals'));await rejected(()=>db.query('select * from public.nook_letters'))
  })
  it('runs the deployment smoke script and rolls back every synthetic account',async()=>{
    await admin();const before=(await db.query('select count(*)::int as n from auth.users')).rows[0].n
    await db.exec(readFileSync(new URL('../supabase/tests/live_access_smoke.sql',import.meta.url),'utf8'))
    assert.equal((await db.query('select count(*)::int as n from auth.users')).rows[0].n,before)
  })
})

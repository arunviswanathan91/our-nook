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
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz);
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

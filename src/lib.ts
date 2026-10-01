import { createClient } from '@supabase/supabase-js'

export const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
// Capture callback intent before the SDK consumes and clears its URL fragment.
const callback = new URLSearchParams(window.location.hash.slice(1))
export const initialPasswordRecovery = callback.get('type') === 'recovery' || window.location.hash === '#set-password'
export const initialAuthError = callback.has('error') || callback.has('error_description') ? 'That email link is invalid or has expired. Request a new one, or sign in with your password.' : ''
export const supabase = configured ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null
export const botUsername = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME || '').replace(/^@/, '')
export function db() { if (!supabase) throw new Error('Our Nook is still being set up. Please try again later.'); return supabase }
export async function signOut() {
  const { error } = await db().auth.signOut({ scope: 'local' })
  if (error) throw error
}
export type Profile = { id: string; display_name: string; avatar: string; city: string; country: string; timezone: string; time_format: '12' | '24'; theme: 'rose' | 'night'; status: string }
export type Couple = { id: string; title: string; created_by: string; anniversary: string | null; next_visit: string | null }
export type Post = { id: string; couple_id: string; author_id: string; kind: 'note' | 'photo' | 'song' | 'hug'; body: string; link_url: string | null; storage_path: string | null; created_at: string; image_url?: string }
export type Game = { id: string; couple_id: string; player_x: string; player_o: string; board: string[]; turn_user: string | null; winner: string | null; status: 'playing' | 'won' | 'draw'; created_at: string }
export type Nook = { profile: Profile; couple: Couple | null; people: Profile[]; posts: Post[]; game: Game | null }
export function deviceTimezone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
export function validTimezone(value: string) { try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true } catch { return false } }
export function clock(profile: Profile, date = new Date()) { return new Intl.DateTimeFormat(undefined, { timeZone: profile.timezone, hour: 'numeric', minute: '2-digit', hour12: profile.time_format === '12' }).format(date) }
export function localDay(profile: Profile, date = new Date()) { return new Intl.DateTimeFormat(undefined, { timeZone: profile.timezone, weekday: 'short', month: 'short', day: 'numeric' }).format(date) }
export function errorText(error: unknown) { return error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : 'That did not work. Please try again.' }
export { safeMusicUrl } from '../supabase/functions/_shared/content'
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db().rpc(`nook_${name}`, args)
  if (error) throw error
  if (data && typeof data === 'object' && 'error' in data) throw new Error(data.error)
  return data as T
}
export async function loadNook(userId: string, limit = 60): Promise<Nook> {
  const client = db()
  const { error: insertError } = await client.from('nook_profiles').upsert({ id: userId }, { onConflict: 'id', ignoreDuplicates: true })
  if (insertError) throw insertError
  const [{ data: profile, error: pe }, { data: member, error: me }] = await Promise.all([
    client.from('nook_profiles').select('*').eq('id', userId).single(),
    client.from('nook_members').select('couple_id').eq('user_id', userId).maybeSingle(),
  ])
  if (pe || me) throw pe || me
  if (!member) return { profile, couple: null, people: [profile], posts: [], game: null }
  const [{ data: couple, error: ce }, { data: members, error: mse }, { data: posts, error: pse }, { data: game, error: ge }] = await Promise.all([
    client.from('nook_couples').select('*').eq('id', member.couple_id).single(),
    client.from('nook_members').select('user_id').eq('couple_id', member.couple_id),
    client.from('nook_posts').select('*').eq('couple_id', member.couple_id).order('created_at', { ascending: false }).limit(limit),
    client.from('nook_games').select('*').eq('couple_id', member.couple_id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ])
  if (ce || mse || pse || ge) throw ce || mse || pse || ge
  const { data: people, error: e } = await client.from('nook_profiles').select('*').in('id', (members || []).map(m => m.user_id))
  if (e) throw e
  const withImages = await Promise.all((posts || []).map(async (post: Post) => {
    if (!post.storage_path) return post
    const { data } = await client.storage.from('nook-memories').createSignedUrl(post.storage_path, 300)
    return { ...post, image_url: data?.signedUrl }
  }))
  return { profile, couple, people: people || [], posts: withImages, game }
}
export async function createPost(nook: Nook, kind: Post['kind'], body = '', link_url: string | null = null, file?: File) {
  if (!nook.couple) throw new Error('Create or join a nook first.')
  let storage_path: string | null = null
  if (file) {
    const extensions: Record<string,string> = { 'image/jpeg':'jpg', 'image/png':'png', 'image/webp':'webp' }
    if (!extensions[file.type]) throw new Error('Choose a JPG, PNG, or WebP photo. Convert HEIC photos to JPG first.')
    if (file.size > 10 * 1024 * 1024) throw new Error('Choose a photo smaller than 10 MB.')
    storage_path = `${nook.couple.id}/${nook.profile.id}/${crypto.randomUUID()}.${extensions[file.type]}`
    const { error } = await db().storage.from('nook-memories').upload(storage_path, file, { contentType: file.type, upsert: false })
    if (error) throw error
  }
  const { error } = await db().from('nook_posts').insert({ couple_id: nook.couple.id, author_id: nook.profile.id, kind, body, link_url, storage_path })
  if (error) {
    if (storage_path) await db().storage.from('nook-memories').remove([storage_path])
    throw error
  }
}

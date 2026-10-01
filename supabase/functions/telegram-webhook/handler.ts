import { imageType, safeMusicUrl } from '../_shared/content.ts'

type Context = { user_id: string; couple_id: string }
type Dependencies = {
  secret: string
  botToken: string
  rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>
  upload: (path: string, bytes: Uint8Array, mime: string) => Promise<void>
  remove: (path: string) => Promise<void>
  fetch: typeof fetch
}
type TelegramFile = { file_id: string; file_size?: number; mime_type?: string }
type Update = { update_id?: number; message?: {
  chat: { id: number; type: string }; from?: { id: number; is_bot?: boolean }
  text?: string; caption?: string; photo?: TelegramFile[]; document?: TelegramFile
} }
class UserInputError extends Error {}
const MAX_PHOTO_BYTES = 10 * 1024 * 1024

async function boundedBytes(body: ReadableStream<Uint8Array> | null, limit: number): Promise<Uint8Array> {
  if (!body) return new Uint8Array()
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > limit) { await reader.cancel(); throw new UserInputError('That is too large. Photos can be up to 10 MB.') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const result = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length }
  return result
}

async function equalSecret(given: string, expected: string) {
  const digest = (text: string) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const [a,b] = await Promise.all([digest(given), digest(expected)])
  const aa = new Uint8Array(a), bb = new Uint8Array(b)
  let difference = 0
  for (let i=0; i<aa.length; i++) difference |= aa[i] ^ bb[i]
  return difference === 0
}

export function createWebhookHandler(deps: Dependencies) {
  async function telegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    const response = await deps.fetch(`https://api.telegram.org/bot${deps.botToken}/${method}`, {
      method: 'POST', headers: { 'content-type':'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
    })
    if (!response.ok) throw new Error('Telegram request failed')
    const result = await response.json()
    if (!result.ok) throw new Error('Telegram request failed')
    return result.result as T
  }
  // A reply failure must not retry a successful link or saved memory.
  async function reply(chat: number, text: string) {
    try { await telegram('sendMessage', { chat_id: chat, text, link_preview_options: { is_disabled: true } }) }
    catch { console.warn('Telegram acknowledgement could not be delivered') }
  }
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } })
    const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token') || ''
    if (!deps.secret || !deps.botToken) return new Response('Not configured', { status: 503 })
    if (!secret || secret.length > 256 || !await equalSecret(secret, deps.secret)) return new Response('Unauthorized', { status: 401 })
    let update: Update
    try { update = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 128 * 1024))) }
    catch { return new Response('Invalid update', { status: 400 }) }
    const message = update?.message
    if (!Number.isSafeInteger(update?.update_id) || !message?.from || message.from.is_bot || message.chat?.type !== 'private' || !Number.isSafeInteger(message.from.id) || message.from.id <= 0 || message.from.id !== message.chat.id) return new Response('OK')
    const identity = { p_telegram_user_id: message.from.id, p_chat_id: message.chat.id }
    const text = (message.text || message.caption || '').trim()
    try {
      if (/^\/start(?:@\w+)?\s/.test(text)) {
        const token = text.split(/\s+/)[1]
        if (!/^[a-f0-9]{32}$/.test(token)) { await reply(message.chat.id, 'Open Our Nook → Our space to create a fresh Telegram connection link.'); return new Response('OK') }
        const linked = await deps.rpc<boolean>('nook_telegram_link', { ...identity, p_token: token })
        await reply(message.chat.id, linked ? 'You are connected ♡ Send a photo, note, or music link and I will keep it in your nook. Use /disconnect to unlink.' : 'That connection link has expired or was already used. Create a fresh one in Our Nook → Our space.')
        return new Response('OK')
      }
      if (/^\/disconnect(?:@\w+)?$/.test(text)) {
        await deps.rpc('nook_telegram_unlink', identity)
        await reply(message.chat.id, 'Telegram is disconnected. Your saved memories stay in your nook.')
        return new Response('OK')
      }
      if (text.startsWith('/')) {
        await reply(message.chat.id, 'Connect from Our Nook → Our space first. Then send a note, a JPG/PNG/WebP photo (up to 10 MB), or a Spotify, Apple Music, YouTube, SoundCloud, or Bandcamp link. Use /disconnect to unlink.')
        return new Response('OK')
      }
      const context = await deps.rpc<Context | null>('nook_telegram_context', identity)
      if (!context) { await reply(message.chat.id, 'Connect your account from Our Nook → Our space first.'); return new Response('OK') }
      if (Array.from(text).length > 4000) throw new UserInputError('Please keep your note under 4,000 characters.')
      const photo = message.photo?.at(-1) || message.document
      let storagePath: string | null = null
      let link: string | null = null
      let kind = 'note'
      if (photo) {
        if (photo.file_size && photo.file_size > MAX_PHOTO_BYTES) throw new UserInputError('Choose a photo smaller than 10 MB.')
        if (message.document && !['image/jpeg','image/png','image/webp'].includes(photo.mime_type || '')) throw new UserInputError('Please send a JPG, PNG, or WebP photo. Other files are not supported yet.')
        const file = await telegram<{ file_path?: string; file_size?: number }>('getFile', { file_id: photo.file_id })
        if (!file.file_path || !/^[a-zA-Z0-9_./-]+$/.test(file.file_path) || file.file_path.split('/').includes('..')) throw new Error('Invalid Telegram file path')
        if (file.file_size && file.file_size > MAX_PHOTO_BYTES) throw new UserInputError('Choose a photo smaller than 10 MB.')
        const response = await deps.fetch(`https://api.telegram.org/file/bot${deps.botToken}/${file.file_path}`, { redirect: 'error', signal: AbortSignal.timeout(20000) })
        if (!response.ok) throw new Error('Photo download failed')
        const bytes = await boundedBytes(response.body, MAX_PHOTO_BYTES)
        const type = imageType(bytes)
        if (!type) throw new UserInputError('Please send a JPG, PNG, or WebP photo.')
        storagePath = `${context.couple_id}/${context.user_id}/${crypto.randomUUID()}.${type.extension}`
        await deps.upload(storagePath, bytes, type.mime)
        kind = 'photo'
      } else {
        if (!text) throw new UserInputError('Send a photo, note, or music link. Stickers, voice messages, and videos are not supported yet.')
        link = (text.match(/https:\/\/[^\s<>]+/g) || []).map(value => safeMusicUrl(value.replace(/[),.!?]+$/, ''))).find(Boolean) || null
        if (link) kind = 'song'
      }
      const saved = await deps.rpc<boolean>('nook_telegram_save', { ...identity, p_update_id: update.update_id, p_kind: kind, p_body: text, p_link_url: link, p_storage_path: storagePath })
      // Each delivery uploads a distinct file; only the winning transaction owns it.
      if (!saved && storagePath) await deps.remove(storagePath)
      if (saved) await reply(message.chat.id, 'Saved in your nook ♡')
      return new Response('OK')
    } catch (error) {
      if (error instanceof UserInputError) { await reply(message.chat.id, error.message); return new Response('OK') }
      // Never log webhook contents, bot tokens, private photo URLs, or database details.
      console.error('Telegram update could not be processed')
      return new Response('Please retry', { status: 503 })
    }
  }
}

import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { createWebhookHandler } from './handler.ts'

const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
})
Deno.serve(createWebhookHandler({
  secret: Deno.env.get('TELEGRAM_WEBHOOK_SECRET') || '',
  botToken: Deno.env.get('TELEGRAM_BOT_TOKEN') || '',
  fetch,
  async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const { data, error } = await client.rpc(name, args)
    if (error) throw new Error('Database operation failed')
    return data as T
  },
  async upload(path, bytes, mime) {
    const { error } = await client.storage.from('nook-memories').upload(path, bytes, { contentType: mime, upsert: false })
    if (error) throw new Error('Photo upload failed')
  },
  async remove(path) {
    const { error } = await client.storage.from('nook-memories').remove([path])
    if (error) throw new Error('Photo cleanup failed')
  },
}))

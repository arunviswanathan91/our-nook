import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWebhookHandler } from '../supabase/functions/telegram-webhook/handler.ts'
import { safeMusicUrl } from '../supabase/functions/_shared/content.ts'

function harness({ saved = true, context = { user_id: 'user-1', couple_id: 'couple-1' } } = {}) {
  const calls = []; const uploads = []; const removed = []; const replies = []
  const handler = createWebhookHandler({
    secret: 'test-secret', botToken: 'test-token',
    async rpc(name,args) { calls.push({ name,args }); if (name.endsWith('_context')) return context; if (name.endsWith('_save')) return saved; return true },
    async upload(...args) { uploads.push(args) }, async remove(path) { removed.push(path) },
    async fetch(url,options) {
      if (url.includes('/file/')) return new Response(new Uint8Array([255,216,255,224,0,16]))
      const body = JSON.parse(options.body)
      if (url.endsWith('/sendMessage')) replies.push(body)
      return Response.json({ ok: true, result: url.endsWith('/getFile') ? { file_path: 'photos/file_123.jpg', file_size: 6 } : {} })
    },
  })
  function request(message = { text:'Thinking of you' }, secret = 'test-secret') {
    return handler(new Request('https://example.test/webhook', { method:'POST', headers:{ 'X-Telegram-Bot-Api-Secret-Token': secret }, body:JSON.stringify({ update_id:123, message:{ chat:{ id:42,type:'private' }, from:{ id:42 }, ...message } }) }))
  }
  return { handler,request,calls,uploads,removed,replies }
}

test('webhook rejects a forged secret before accessing data', async () => {
  const h = harness(); assert.equal((await h.request({},'wrong')).status,401); assert.equal(h.calls.length,0)
})
test('webhook ignores groups and impersonated private-chat identities', async () => {
  const h = harness(); await h.request({ chat:{ id:-42,type:'group' } }); await h.request({ from:{ id:99 } }); assert.equal(h.calls.length,0)
})
test('an unlinked Telegram user cannot save content', async () => {
  const h = harness({ context:null }); await h.request(); assert.equal(h.calls.length,1); assert.match(h.replies[0].text,/Connect your account/)
})
test('valid linking passes only the sender identity and supplied temporary token', async () => {
  const h = harness(); await h.request({ text:'/start '+ 'a'.repeat(32) }); assert.deepEqual(h.calls[0],{ name:'nook_telegram_link',args:{ p_telegram_user_id:42,p_chat_id:42,p_token:'a'.repeat(32) } })
})
test('a music link becomes a saved song with the original note', async () => {
  const h = harness(); await h.request({ text:'For your commute https://open.spotify.com/track/example' }); const save = h.calls.at(-1).args; assert.equal(save.p_kind,'song'); assert.equal(save.p_update_id,123); assert.equal(save.p_storage_path,null)
})
test('unsafe or lookalike music links are never treated as music', () => {
  for (const url of ['javascript:alert(1)','http://open.spotify.com/x','https://open.spotify.com.evil.test/x','https://user:pass@open.spotify.com/x']) assert.equal(safeMusicUrl(url),null)
})
test('duplicate photo delivery removes only its extra upload and sends no success reply', async () => {
  const h = harness({ saved:false }); await h.request({ photo:[{ file_id:'123',file_size:6 }],caption:'Our day' }); assert.equal(h.uploads.length,1); assert.match(h.uploads[0][0],/^couple-1\/user-1\/[0-9a-f-]+\.jpg$/); assert.deepEqual(h.removed,[h.uploads[0][0]]); assert.equal(h.replies.length,0)
})
test('oversized attachments are rejected before download or upload', async () => {
  const h = harness(); await h.request({ photo:[{ file_id:'123',file_size:11000000 }] }); assert.equal(h.uploads.length,0); assert.match(h.replies[0].text,/10 MB/); assert.equal(h.calls.length,1)
})

const { TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_WEBHOOK_URL } = process.env
if (!TELEGRAM_BOT_TOKEN || !/^[A-Za-z0-9_-]{32,256}$/.test(TELEGRAM_WEBHOOK_SECRET || '')) throw new Error('Provide a bot token and a webhook secret of 32–256 URL-safe characters in .env.telegram.')
const url = new URL(TELEGRAM_WEBHOOK_URL || '')
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/functions/v1/telegram-webhook' || !url.hostname.endsWith('.supabase.co')) throw new Error('Use the HTTPS URL of your Supabase telegram-webhook function.')
try {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method:'POST', headers:{ 'content-type':'application/json' }, signal:AbortSignal.timeout(15000),
    body:JSON.stringify({ url:url.href,secret_token:TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message'] }),
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw new Error('Registration failed')
  console.log('Telegram webhook registered. Connect your account from Our Nook → Our space.')
} catch {
  // Network error objects can include the token-bearing Telegram URL.
  console.error('Webhook registration failed. Check the token, function URL, and network connection.')
  process.exitCode = 1
}

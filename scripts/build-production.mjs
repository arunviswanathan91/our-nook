import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// Only public client configuration belongs in this file or the browser bundle.
const config = JSON.parse(await readFile(new URL('../deployment/production.json',import.meta.url),'utf8'))
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl) || !config.supabasePublishableKey?.startsWith('sb_publishable_')) throw new Error('Use a Supabase URL and publishable key in deployment/production.json.')
const env = { ...process.env,VITE_SUPABASE_URL:config.supabaseUrl,VITE_SUPABASE_PUBLISHABLE_KEY:config.supabasePublishableKey,VITE_TELEGRAM_BOT_USERNAME:config.telegramBotUsername || '' }
const cwd = fileURLToPath(new URL('..',import.meta.url))
for (const [entry,...args] of [['typescript/bin/tsc','-b'],['vite/bin/vite.js','build']]) {
  const executable = fileURLToPath(new URL('../node_modules/'+entry,import.meta.url))
  const result = spawnSync(process.execPath,[executable,...args],{ stdio:'inherit',cwd,env })
  if (result.error) throw result.error
  if (result.status !== 0) { process.exitCode=result.status ?? 1; break }
}

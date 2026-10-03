# Our Nook

A cozy, private app for any couple: shared touch, letters, photos, music, recorded whispers, daily questions, and little games across time zones. Use the web app on Android and iPhone, or build the native iPhone version for touch vibrations.

**Website:** https://arunviswanathan91.github.io/our-nook/

**Touch vibrations:** eight distinct rhythms, per-gesture pattern/off choices,
local previews, pulse length, optional button feedback and native iPhone strength.
Open **Our space → Touch & vibration**. Supported Android browsers can vibrate
while open. iPhone Safari / Home Screen web apps cannot; the native Capacitor
build uses Core Haptics and requires Apple signing/installation. Background
notifications are not included. See [iPhone build and installation](docs/iphone.md).

**Status:** the database is deployed to the existing **our nook** Supabase project in Singapore, and its publishable frontend configuration is saved in `deployment/production.json`. Live SQL access checks passed. Email/password sign-in is the default; email confirmation remains enabled and anonymous sign-in is disabled. GitHub Actions builds and checks the app before publishing `main` to GitHub Pages. **Password sign-in and session refresh do not send emails. Custom SMTP is still required for reliable new-account confirmation, first-password setup, and password recovery for arbitrary email addresses.** The optional Telegram bot also needs its own credentials.

## Access by partner code

1. Each person creates an account, confirms their email once, and signs in with their own email and password.
2. One person creates a nook and generates a partner invitation code.
3. The other signs in, chooses **I have a code**, and enters it.

A nook has at most **two members**. Codes expire after **24 hours**, work **once**, and are stored as hashes. A fresh code invalidates the previous one. Failed joins are limited to ten attempts per account per fifteen minutes. Creating a nook is open to verified email accounts; the code controls access to a couple's space, rather than access to the public sign-in screen.

Names, avatars, cities, countries, IANA time zones, clock format, status, and theme are editable. No couple, country, or time zone is hardcoded in production data. Each account belongs to one nook in this version.

## Returning to an existing account

- Already signed in: open **Our space → Password & sign-in → Set or change password**. The same option is available before creating/joining a nook.
- Used an email link previously and now signed out: choose **Set or reset password** on the login screen, enter the **same email**, and use the setup email to choose a password. Do not create another account for the same nook.
- Later visits: the app restores the saved session and refreshes expired access tokens. After an explicit sign-out, use the email/password form without requesting another email. Sign-out ends the current device's session, including its tabs, while other devices keep their sessions.
- Password recovery requires an authenticated reset-link session. The password form survives a refresh, and setting a password keeps the same account ID, nook, and partner membership. Passwords are handled by Supabase Auth; they are not written to profile tables or browser storage by the app.
- The optional **Use an email link** fallback is restricted to existing accounts. Recovery emails and new-account confirmations still depend on the project's email sender and its limits.

Use at least 12 characters for new passwords. Browser/private-mode storage clearing, revoked sessions, or other security events can require sign-in again. The project currently has no forced session lifetime/inactivity timeout; token expiry stays at 3600 seconds with normal refresh-token protections. Google OAuth is not configured in this release.

## Included

The Dearest redesign preserves the original rose, cream, lilac and mulberry palette.

- **Together:** editable local clocks and app presence, held thumb touch, taps/kisses/waves/hugs, mug clinks and glimmers, a shared plant, breathing rhythm, and shared dates.
- **Scrapbook:** private photographs, notes, drawings, recorded whispers/ambience, hearts, search and filters, on-this-day memories, sealed letters and reunion capsules.
- **Mixtape:** song/playlist dedications, cassette collections, a daily song swap, supported provider embeds, shared listening cues, and shared play/pause/seek for app recordings after both people join.
- **Parlour:** daily/custom questions whose answers reveal only after both reply, either-or choices, guess-a-sound, tic-tac-toe, shared drawing with keyboard alternatives, and scratch/tap surprises.
- **Our space:** individual names, pronouns, avatars, cities/countries/time zones, clock format, rose/night theme, status, quiet mode and haptics; shared dates and a configurable day boundary.
- Email/password sign-in, password setup/recovery, persistent sessions, and optional email-link fallback using Supabase Auth. Existing accounts and pairing remain valid.
- Private couple spaces with row-level security and private media buckets. Sealed letter bodies and unrevealed answers stay in an unexposed database schema; timed audio is blocked by Storage policies too.
- Realtime updates plus foreground reconciliation after missed events or sleeping tabs.
- Installable PWA with an offline notice. Shared content needs internet; the service worker does not cache private API responses or media.
- Optional Telegram inbox with temporary account-link tokens, authenticated webhooks, and deduplicated saves.

Haptics use optional browser vibration with visual feedback on every device. iPhone web browsers do not promise physical vibration. Microphone recording needs permission and browser support; audio upload remains available. In-app recording stops after one minute or when the page is hidden. Photos and recordings are limited to 10 MB. External music has a shared start cue, not sample-accurate synchronized provider playback or provider playlist editing. Presence describes recent activity in this app; skies are decorative.

## Run locally

Use Node 24 (Node 22.12+ also supports the frontend).

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Set these frontend variables in `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
# Optional; no @ prefix
VITE_TELEGRAM_BOT_USERNAME=YOUR_BOT_USERNAME
```

Use a **publishable key** in the frontend. Never put a Supabase secret/service-role key, database password, or Telegram bot token in a `VITE_` variable or commit it to GitHub. The frontend values are included in the public browser bundle; authorization is enforced by database policies.

## Supabase setup

The existing **our nook** project (`lqdkyarlihfprvoqmfdo`) uses the migrations in this repository. Their repository timestamps match Supabase’s recorded deployment history. Do not reapply the initial migration manually to this project. The steps below are for another fresh deployment.

Use a new, dedicated Supabase project. This migration creates the application's tables, functions, indexes, policies, private media buckets, and realtime publication entries. It assumes Supabase's standard `auth` and `storage` schemas.

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --dry-run
npx supabase db push
```

The CLI applies all files in `supabase/migrations/` in timestamp order. Alternatively, apply all SQL files once, in that order, in a new project's SQL editor, then reconcile migration history before later CLI pushes.

In the Supabase dashboard:

1. Enable email authentication and email confirmation; keep anonymous sign-in disabled.
2. Set **Auth → URL Configuration → Site URL** to the exact deployed app URL. Allow that URL, including its trailing slash/path, as a redirect URL. For development, allow `http://localhost:5173/` and `http://127.0.0.1:5173/`.
3. Configure your own SMTP sender for real users. The built-in development sender is restricted and is not sufficient for confirmation/reset emails to arbitrary addresses. The app uses Supabase's default email confirmation, reset-password, and magic-link templates; no template customization is needed. Password sign-in itself sends no email.
4. Keep `nook_private` out of Data API exposed schemas. Keep the `nook-memories` and `nook-envelopes` buckets private.
5. Run Supabase's security/performance advisors and perform the live checks below.

For a local Supabase stack, Docker is required. Run `npx supabase start`, then `npx supabase db reset`; use the local URL/key and Inbucket email viewer reported by the CLI. The seed file is intentionally empty.

## Hosting

This repository uses GitHub Pages with **Settings → Pages → Source → GitHub Actions**. The validation workflow publishes only the verified `dist/` artifact from `main`; pull requests and other branches cannot deploy. Its deployment job uses the `github-pages` environment and the standard short-lived GitHub Actions token. No personal access token or hosting secret is needed. Each deployment's exact website URL appears in the workflow and repository Pages settings.

Build the frontend:

```sh
npm run build
```

For this repository’s configured deployment, run **`npm run build:production`**. It reads the public URL and publishable key from `deployment/production.json`; no server secret is stored there. For a separate deployment, edit that file or continue using your own `VITE_` build variables with `npm run build`.

Deploy `dist/` with any HTTPS static host. Set the `VITE_` variables at **build time**, then rebuild whenever they change. Navigation uses in-app state, so no server-side route handling is required. Vite's relative asset base also supports a subdirectory such as GitHub Pages. Do not publish `.env` files or the source directory as the site.

After deploying, update Supabase's Site URL and allowed redirects to match the deployed URL. On iPhone use **Share → Add to Home Screen**; on Android use **Install app / Add to Home Screen**.

## Optional Telegram inbox

Create your own bot with Telegram's **@BotFather**. Keep its token server-side. Choose a random webhook secret of at least 32 characters, containing only letters, digits, `_`, or `-`.

Store these in an untracked `.env.telegram` file:

```dotenv
TELEGRAM_BOT_TOKEN=YOUR_BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET=YOUR_RANDOM_SECRET
```

Then deploy:

```sh
npx supabase secrets set --env-file .env.telegram
npx supabase functions deploy telegram-webhook
```

The function uses Supabase's built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server-side. JWT verification is disabled for this one function because Telegram supplies its own authentication header; the handler rejects requests without the matching webhook secret before accessing data.

Register the webhook without placing tokens in shell history or URLs in a browser:

```sh
# TELEGRAM_WEBHOOK_URL must be your deployed function URL:
# https://YOUR_PROJECT_REF.supabase.co/functions/v1/telegram-webhook
TELEGRAM_WEBHOOK_URL=https://YOUR_PROJECT_REF.supabase.co/functions/v1/telegram-webhook \
  node --env-file=.env.telegram scripts/register-telegram.mjs
```

Set `VITE_TELEGRAM_BOT_USERNAME` and rebuild the website. Each partner opens **Our space → Create connection link → Open Telegram**. The connection token is single-use and expires in ten minutes. Partner invitation codes and Telegram connection tokens are separate.

The bot accepts private messages only. Notes, photos, and supported music links are saved as the sender's posts in their current nook. `/disconnect` removes that person's Telegram link. Groups, edited messages, voice notes, videos, and stickers are not supported. The webhook only replies to the sender; it does not send unsolicited partner notifications.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:ui
# Optional, with Deno installed:
deno check supabase/functions/telegram-webhook/index.ts
```

- Database tests run the actual migration in PGlite with Supabase auth/storage fixtures. They exercise row-level access, invitation expiry/rotation/reuse, membership limits, rate limits, storage isolation, game turns, Telegram authorization, two-answer privacy, timed letter/audio access, once-daily watering, touch expiry, signal throttling, drawing validation, and shared playback boundaries.
- Webhook tests exercise sender verification, unlinked accounts, music allowlisting, duplicate photo cleanup, and size limits.
- Browser tests use the real Supabase client with a mocked transport. They cover password sign-in, invalid credentials, saved sessions across reloads/tabs, expired-token refresh, device sign-out, confirmation, password setup/recovery, failed updates, email rate-limit messages, partner joining, and phone/desktop layouts. Two isolated browser accounts also exercise Realtime protocol delivery for touch, signals, two-answer reveals, shared drawing, and actual HTML audio playback controls, using a mocked transport. These tests do **not** prove real email delivery, deployed password changes, live Storage/Realtime connectivity, or Telegram connectivity.

Before opening the live app to others, test with two real accounts and a third outsider: confirmation, first-password setup, password sign-in, recovery, code join, photo upload/read/delete, alternating moves on two devices, session persistence after closing/reopening, and Telegram link/save/disconnect. Verify the outsider cannot read either partner's rows or photos. Check the installed app on physical iPhone and Android devices. The existing-account owner must choose their own password; no real account password is created or changed by deployment.

## Live database verification

The migration was applied to `lqdkyarlihfprvoqmfdo`, including private photo Storage and realtime publications. `supabase/tests/live_access_smoke.sql` verifies partner joining, shared reads, game moves, outsider isolation, two-person capacity, and anonymous denial inside a transaction. It rolls back every synthetic row and sends no emails. The smoke test creates only synthetic accounts and rolls back the entire transaction; it preserves existing users and content. It also checks sealed question answers, timed envelope/audio permissions, watering, expiring touches, shared playback, and drawing isolation.

After the Dearest upgrade, Supabase’s advisors report no database security warnings or missing foreign-key indexes. Auth still flags disabled [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), which requires an eligible Pro-or-higher plan; the redesign does not change billing or Auth configuration. [RLS-without-policy informational notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) are intentional for internal tables in the unexposed `nook_private` schema: clients have no direct table access, and only authorized functions access them. [Unused-index notices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) are expected for new or rarely used features. The [unindexed-foreign-key findings](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) are covered by the indexing migrations.

## Design notes and current limits

Privileged database functions live in `nook_private` with explicit authorization checks and fixed empty search paths; exposed RPC wrappers run as invokers. Frontend roles cannot directly write memberships or game state. Join and game mutations lock the relevant rows to serialize competing requests. Photos use short-lived signed URLs. This is access-controlled shared storage, not end-to-end encryption.

This version does not include partner replacement, account deletion/export UI, comments, push notifications, video, or offline content sync. Physical haptics and microphone formats vary by browser. Letters and conversation snapshots currently show the latest 100 entries; the current daily question is always included. Drawings support up to 500 active strokes; save the drawing before clearing the shared paper. Shared anniversary/next-visit dates are saved in settings; there is no scheduled reminder service. Administrative deletion must remove dependent content/memberships and Storage objects before Auth users. If a file upload succeeds and its subsequent network request fails, an unused object can remain; clean up unreferenced objects as an operational task. Telegram deduplication records are retained to prevent replay.

## References

- [Supabase password-based authentication](https://supabase.com/docs/guides/auth/passwords)
- [Supabase sessions](https://supabase.com/docs/guides/auth/sessions)
- [Supabase passwordless email sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase production SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Telegram webhook API](https://core.telegram.org/bots/api#setwebhook)

See [the design decisions and feature map](docs/design.md) for prototype synthesis and UI/UX Pro Max provenance.

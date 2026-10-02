# Our Nook — Dearest redesign

Keep the existing colour tokens: cream #faf6f0, paper #fffdf9, rose #f4dfd9,
mulberry #804650, ink #463338, lilac #eee6f0, and soft sage #f0eee3.
Keep Lora for letters/headings and DM Sans for controls. The existing night
theme remains an individual preference. No neon or brown theme replacement.

The four supplied Stitch exports are visual references, not application code.
Use the Tether stationery, record/cassette, wax-seal and thumb-touch details;
the Pocket Sanctuary balcony, shared plant and bedtime audio; and Horizon's
quiet breathing and two-person question reveal. Repeated features have one home.

| Area | Features |
| --- | --- |
| Together | Two local clocks and statuses, shared touch, six small signals, shared sky/balcony, plant watering, breathing together, anniversary/reunion countdowns |
| Scrapbook | Existing photos and notes, doodles, recorded whispers and ambience, hearts, filters, on-this-day memories, timed letters/reunion capsules |
| Mixtape | Song/playlist links and dedications, cassette collections, daily two-sided swap, provider embeds, a shared start cue, synchronized playback for our own recordings |
| Parlour | Daily and custom questions with a genuine two-answer reveal, either/or choices, guess-a-sound, existing tic-tac-toe, shared doodles, scratch-to-reveal surprises |
| Our space | Existing account/password/pairing/Telegram, editable names/pronouns/cities/time zones/dates, shared ritual zone, haptics and quiet mode |

Haptics are progressive enhancement: short, cancellable patterns after a user
interaction; visual pressed/sent/received states work everywhere. Never infer
heartbeat, sleep, physical phone warmth, charger control or sensor readings.
Presence means recently active in this app. The sky is decorative, not weather
or astronomical telemetry. External music keeps its provider's playback rules;
the app's recordings can synchronize after each listener explicitly joins.

Use real shared data and server timestamps. Sealed message bodies and unrevealed
answers must never be sent to the other client before authorization. Couple
membership, mutation authorship, rate limits and daily watering live in Postgres.
Existing accounts, memories, pairing codes and password sessions remain valid.

UI/UX Pro Max was reviewed at upstream commit
09170eec67eefd46a7ae85de61b40c194020f997. Apply its gesture alternatives,
visible focus, readable text, safe-area spacing, reduced motion and feedback
guidance. Its generic marketing-page recommendation is not this app's layout.

Validation includes real PostgreSQL RLS/RPC tests, isolated two-partner browser
fixtures, keyboard/phone/reduced-motion flows, existing password regressions,
and a deployed UI check. Never use production personal content as test fixtures.

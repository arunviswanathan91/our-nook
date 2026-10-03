# Our Nook on iPhone

The existing React app is also packaged with Capacitor 8.5.2. It uses the same
Supabase project, password accounts, pairing codes and private couple data.
Android users can continue using the website. No new account or new nook is
needed when moving from the iPhone website to the native app.

## What works in each version

| Version | Sends partner gestures | Receives vibration while open | Custom patterns |
| --- | --- | --- | --- |
| Supported Android browser / installed web app | Yes | Yes, after a user interaction | Pulse lengths and pauses; motor strength depends on the phone |
| iPhone Safari / Add to Home Screen | Yes | No | Visual feedback; adding an icon does not grant haptics access |
| Signed native iPhone app on supported hardware | Yes | Core Haptics | Pulse lengths, pauses, intensity and per-pattern texture |
| Desktop / device without vibration hardware | Yes | No | Visual feedback |

Both people need the app open and an internet connection for live touch.
This release does **not** include background push notifications. It cannot
remotely play custom rhythms on a locked phone, override Quiet mode, or
override the phone's vibration settings. No silent push / background audio
workaround is used.

## Personal vibration options

Open **Our space → Touch & vibration**, or **Together → Vibration options**.

The defaults are a heartbeat for shared touch, a single tiny tap, two warm
waves, a rising wave, a double kiss, two crisp mug clinks, a twinkle and a
long hug. Choose any of the eight patterns, or **Off · visual only**, for
each gesture. Choose shorter/regular/longer pulses. Native iPhones also
offer gentle/balanced/more noticeable strength.

Previews only play on the current device and never send a partner signal.
**Vibrate when I tap buttons or send a touch** can be disabled independently
of incoming gestures. The existing **Gentle haptics** master switch and
**Quiet mode** are saved in Your corner and override every pattern, including
previews. A muted gesture still appears visually.

Pattern preferences are saved automatically in local storage, separately for
each account on each device. They are not synced between devices. Storage
clearing resets them; a storage failure is reported instead of promising they
were saved. A sender sends the gesture kind only; the receiving person chooses
how it feels. No physical-delivery receipt is claimed.

## Build and install

The **Verify iPhone build** GitHub Action compiles the native application with
Xcode on a macOS runner. That is an **unsigned compile check**, not a downloadable
iPhone installer. Native code and web/native integration tests can pass without
a physical iPhone; feel, accessibility settings and background cancellation
must also be checked on a real device before distributing widely.

On a Mac with the supported Xcode version (26.0+ for this Capacitor version),
Node 22.12+ and this repository:

```sh
npm ci
npm run ios:sync
npm run ios:open
```

1. In Xcode, select the **App** target → **Signing & Capabilities**. Select
   your Apple development team and enable automatic signing. The bundle ID
   is `io.github.arunviswanathan91.ournook`; use a unique ID belonging to your
   team if necessary, updating both Capacitor configuration and Xcode.
2. For a locally connected iPhone, select that device and run the app. Apple
   may require Developer Mode and trust confirmation on the device. A free
   Personal Team is for limited device testing and needs periodic re-signing.
3. To send an installable beta to a partner in another country, use an Apple
   Developer Program account and App Store Connect: select a generic iOS
   device, **Product → Archive**, then **Distribute App → App Store Connect**.
   Complete Apple's signing, export-compliance and beta information steps.
4. Add your partner as a TestFlight tester after the build is processed (and
   any required beta review completes). They install **TestFlight**, accept
   the invite and install the native **Our Nook** build. A Home Screen web
   icon is a separate installation and will not gain native haptics.
5. Sign in with the existing account and password. Open **Touch & vibration**;
   it should say that touch vibrations are ready. Preview a hug, then have
   the partner send a hug with both apps visible. Repeat in the other direction.

No Apple account has been enrolled, no paid membership purchased, and no
signing certificate, private key, provisioning profile or TestFlight credential
is stored in this repository. Those are required from the owner for distribution.
Check App Store privacy disclosures and provide the required privacy/support
URLs before a public release; accounts, shared photos and voice notes are user
data stored in the existing private Supabase service.

Email confirmation, magic-link fallback and password-reset emails open the
configured public HTTPS website (`webAppUrl` in `deployment/production.json`,
or `VITE_PUBLIC_WEB_URL` for a custom build). After confirming or setting a
password there, return to the native app and use password sign-in. We do not
allow-list a broad custom URL scheme or move auth tokens through arbitrary links.
In-app password updates and ordinary session refresh continue to use the same
Supabase auth flow as the website.

## Implementation notes

- `src/haptic-patterns.ts` holds bounded, distinct patterns and validated
  per-device preferences. `src/haptics.ts` routes to the browser or native bridge.
- `NookHapticsPlugin.swift` uses `CHHapticEngine` with audio disabled. Inputs
  are bounded to 31 segments, one second per segment and five seconds total;
  each shipped pattern is shorter than one second at regular length.
- Engine playback is cancelled when the app/scene deactivates, when the web
  document hides, on sign-out/unmount, on preference changes or when stopped.
  Engine reset/interruption does not schedule replay of an old partner touch.
- The custom controller is registered in **both** the storyboard and
  `SceneDelegate`. Capacitor 8.5 creates the scene's root controller in code.
- The app bundles the verified `dist/` assets. It does not use `server.url`
  to execute a remotely hosted website, and does not register the website's
  service worker inside the native shell.
- `npm run ios:sync` rebuilds and copies assets. Changing website code alone
  does not update an installed native build; archive and distribute a new build.

References: [Capacitor iOS](https://capacitorjs.com/docs/ios),
[custom native code](https://capacitorjs.com/docs/ios/custom-code),
[Apple Core Haptics](https://developer.apple.com/documentation/corehaptics),
[TestFlight](https://developer.apple.com/testflight/),
[Apple membership options](https://developer.apple.com/support/compare-memberships/),
[Supabase auth redirects](https://supabase.com/docs/guides/auth/redirect-urls).

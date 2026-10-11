# Nature Quest 🌿

An offline-first PWA that uses an open-weight AI model, running on your own device, to write short real-world
missions, then deliberately gets out of your way so you can go outside.

Built for the DEV / Hacktoberfest 2026 "Touch Grass" challenge.

**The loop:** one tap gets a quest, the screen tells you to put the phone away and rests itself, you go outside,
you come back and say how it went, and your journal and streak grow. The screen is the shortest part of the experience.

## Open AI, no paid APIs

Quests come from a library of 114 hand-checked missions. An open-weight model on the phone picks the one that fits you.

| Job | Model | Notes |
|---|---|---|
| **Smart matching (default, recommended)** | `Xenova/all-MiniLM-L6-v2` (Apache-2.0, about 25 MB) via Transformers.js / ONNX Runtime Web, in a Web Worker | Embeds what you type ("tired after work, want something calm"), the time of day, season, company and energy, plus a gentle lean toward the kind of quests you have finished before, and re-orders the already-safe candidate quests by meaning. Milliseconds per match, fully offline after a one-time download. It can only re-order; it can never add or write anything. |
| Creative writing (experimental, off by default) | `HuggingFaceTB/SmolLM2-135M-Instruct` or `Qwen2.5-0.5B-Instruct` on the phone, or any OpenAI-compatible local server such as Ollama with `gpt-oss:20b` | Writes a whole quest from scratch. On mid-range phones (CPU only) small models were too slow and rambled, so this is optional. Quests are written ahead of time on the home screen. |
| Neither | the library | Always available. Used when the AI is off, too slow or fails. |

Why not free-write everything on the phone? We tried. A 0.5B model on a mid-range phone's CPU produced about 0.3 tokens
per second and drifted into stories, so we used the right model for each job instead of forcing one.

Every quest passes the app's own safety rules (`js/quest/safety.js`). Watchdogs stop any stuck model, and there is an
on-device self-test (You > On-device AI) that prints where time goes.

## Architecture

```
index.html -> js/app.js (router, views)
  auth.js / claim.js / store.js (IndexedDB, outbox) / sync.js (drain to Firestore)
  quest/  model (state machine) | safety | fallback (library + ranking) | engine | loop | verify | achievements
  ai/     matcher (embeddings) | engine + pantry (experimental writing) | providers/embed.js, browser.js, endpoint.js | worker.js
sw.js: offline shell, update prompt
```

Local-first: everything is saved on the device first. Signing in is optional. Firebase provides auth and an
optional backup (a write-only outbox drained to Firestore); nothing needs the network to work.

Verification is deliberately honest: time outside versus quest length, an optional photo (kept on the phone and
checked only for being a real, non-blank image), and the person's own words. Completions are labelled
"Self-reported", "Time on quest checked" or "Photo attached". The AI never claims to have seen anything.

## Run and test

```
python3 -m http.server 8099         # serve the folder, open http://localhost:8099
node tests/{quest,ai,loop,verify,pantry,match}.test.mjs   # run each
python3 tests/{smoke,match_ui,ai_hang,ai_ui,loop_ui,photo_ui}.py   # run each
```
(Browser tests need Python Playwright with Chromium.)

## Deploy (Firebase Hosting)

```
firebase login
firebase deploy --only hosting      # project nature-quest-c14be, public dir is this folder
```
For optional cloud backup, create a Firestore database and use these rules:
```
rules_version = '2';
service cloud.firestore { match /databases/{db}/documents {
  match /users/{uid}/{document=**} { allow read, write: if request.auth != null && request.auth.uid == uid; }
} }
```
Auth providers (Email/Password, Google, Apple) are enabled in the Firebase console; add your live domain under
Authentication > Settings > Authorized domains.

## Known limits
Backup is one-way (no restore on a new device yet). Matching picks from a fixed library, so quests are curated rather than invented. Free-writing is experimental. Apple sign-in needs Apple-side setup.

MIT licensed. Qwen2.5-0.5B-Instruct is Apache-2.0; gpt-oss-20b is Apache-2.0.

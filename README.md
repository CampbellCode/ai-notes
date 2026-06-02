# AI Notes

An offline-first, AI-enhanced personal notes app. Capture notes by typing or
speaking on your phone — they save locally and are always available, even with
no wifi or data. When you're online, tap **Enhance** on a note to have an AI add
tags and helpful enhancements (summary, action items, suggestions).

This is a personal learning project — the goal is to build it yourself and
understand every piece, not to ship a product.

---

## Architecture at a glance

```
┌─────────────────────────────────────────────┐
│ PHONE (React-free PWA, works fully offline)   │
│   • Type or speak a note                      │
│   • Saves to IndexedDB immediately            │
│   • Read/create notes with no network         │
│   • Each note: status "pending" → "enhanced"  │
│   • "Enhance" button enabled only when online │
└───────────────────┬───────────────────────────┘
                    │  (only on tap, only when online)
                    ▼
┌─────────────────────────────────────────────┐
│ BACKEND (Node/Express, stateless)             │
│   • POST /api/enhance  → text in, JSON out    │
│   • Does NOT store notes                      │
│   • Calls the AI provider (the swap point)    │
└───────────────────┬───────────────────────────┘
                    ▼
┌─────────────────────────────────────────────┐
│ AI PROVIDER (pick one — aiProvider.js)        │
│   • cloud: Anthropic API (claude-haiku-4-5)   │
│   • local: Ollama on your PC (llama3.1 etc.)  │
└─────────────────────────────────────────────┘
```

### Key design decisions (the "why")

- **Offline-first.** The phone owns your notes (IndexedDB). The backend is an
  optional enrichment service, not a dependency. Capture and reading never
  require a connection. This is why there's no database in the backend.

- **Manual enhance, no background process.** Notes sit as `pending` until you
  tap "Enhance" while online. No app-always-running, no battery drain, no
  fiddly background sync. (Auto-sync via Service Worker Background Sync is a
  possible later upgrade — see TODO.)

- **Single structured AI call, not an agent.** Tagging + enhancement is a
  closed task with a known output shape, so it's one call with all guardrails
  baked into the prompt (allowed tag list, "don't invent tags", fixed JSON
  schema). No agent loop needed. See `backend/aiProvider.js`.

- **The swap point.** `aiProvider.js` exposes one function, `enhanceNote(text)`.
  Cloud vs local is chosen by the `AI_PROVIDER` env var and nothing else in the
  app changes. You can start on cloud and move to local later by editing one
  env var.

- **No build step on the frontend.** It's a single `index.html` with inline JS,
  a manifest, and a service worker. Opens in any browser, installs to your phone
  home screen. Easy to read and tinker with. (Could migrate to React later.)

### Known constraint: offline voice

The "Speak" button uses the browser's **Web Speech API**, which on most phones
sends audio to the browser vendor's servers to transcribe — so **voice capture
needs a connection**. Typing always works offline. True offline voice would mean
running local transcription (e.g. Whisper) — noted in TODO, not built yet.

---

## Project structure

```
ai-notes/
├── backend/
│   ├── server.js          Express server: /api/enhance + serves frontend
│   ├── aiProvider.js      THE SWAP POINT: cloud + local behind enhanceNote()
│   ├── .env.example       Copy to .env and add your key / settings
│   └── package.json
├── frontend/
│   ├── index.html         The whole PWA: capture, IndexedDB, enhance UI
│   ├── sw.js              Service worker (caches app shell for offline)
│   ├── manifest.json      PWA install metadata
│   └── icon-192/512.png   Placeholder icons (replace with your own)
├── .gitignore
└── README.md
```

---

## Setup

### 1. Backend

```bash
cd backend
npm install
cp .env.example .env        # then edit .env
```

Edit `.env`:
- For **cloud**: set `AI_PROVIDER=cloud` and put your Anthropic API key in
  `ANTHROPIC_API_KEY`. Note this is the **pay-as-you-go API**, billed
  separately from any Claude.ai chat subscription. Tagging with Haiku is
  fractions of a cent per note. Get a key from the Anthropic Console.
- For **local**: install [Ollama](https://ollama.com), run
  `ollama pull llama3.1`, then set `AI_PROVIDER=local`.

Start it:

```bash
npm start
```

### 2. Frontend

The backend already serves the frontend, so just open:

```
http://localhost:3001/index.html
```

To use it **on your phone**:
- On the same wifi: find your PC's LAN IP (e.g. `192.168.1.20`) and open
  `http://192.168.1.20:3001/index.html` on your phone. Then "Add to Home Screen".
- Away from home: put your PC on [Tailscale](https://tailscale.com) and use its
  Tailscale IP instead. (Right up your alley given the home-automation setup.)

If you ever serve the frontend separately from the backend, set `BACKEND_URL`
near the top of the `<script>` in `index.html`.

---

## How it works, step by step

1. You type or speak a note and tap **Save note**.
2. It's written to IndexedDB with `status: "pending"` — saved before anything
   else can fail.
3. You can close the app, go offline, reopen — the note is still there.
4. When online, the note shows an enabled **Enhance** button. Tap it.
5. The note text goes to `POST /api/enhance`. The backend runs the single AI
   call and returns `{ tags, summary, actionItems, suggestions }`.
6. The note is updated in IndexedDB, `status` flips to `enhanced`, and the
   tags + enhancements render.

---

## TODO / roadmap

Built so far: offline capture (type + speak), IndexedDB storage, offline
reading, pending/enhanced status, manual enhance, swappable cloud/local AI.

Next, roughly in order:

- [ ] **Run it end to end** with a real Anthropic key and confirm tag quality.
- [ ] **Tune the prompt** in `aiProvider.js` — adjust the tag list to match how
      you actually think, tweak what enhancements you want.
- [ ] **Edit / delete notes** — currently you can only create and enhance.
- [ ] **Search and filter by tag** — once you have more than a handful of notes.
- [ ] **"Enhance all pending"** button for batch processing when you reconnect.
- [ ] **Try the local provider** — install Ollama, flip `AI_PROVIDER=local`,
      compare tag quality and speed against cloud.
- [ ] **Images (stubbed for now)** — add image upload; store the file on disk
      and keep only a path reference in the note. Decide where image→text
      "reading" happens (cloud vision model is easiest).
- [ ] **Real article suggestions** — this needs web search wired into the
      backend (the LLM alone will hallucinate links). Promote the `suggestions`
      field to a small two-step: search, then summarise results.
- [ ] **Auto-sync (optional polish)** — Service Worker Background Sync to fire
      enhancement automatically when connectivity returns. Fiddly; do last.
- [ ] **Offline voice (optional)** — local Whisper transcription if connection-
      dependent voice turns out to bug you.
- [ ] **Replace placeholder icons** with something nicer.

---

## A note on the API key

Never commit `.env`. It's gitignored. If you ever push a key by accident,
rotate it immediately in the Anthropic Console.

# AI Notes

An offline-first, AI-enhanced personal notes app. Capture notes by typing or
speaking on your phone — they save locally and are always available, even with
no wifi or data. When you're online, tap **Enhance** on a note to have an AI add
tags and helpful enhancements (summary, action items, suggestions).

This is a personal learning project — the goal is to build it yourself and
understand every piece, not to ship a product.

**Live app:** https://campbellcode.github.io/ai-notes

---

## Architecture at a glance

```
┌─────────────────────────────────────────────┐
│ PHONE (PWA, works fully offline)              │
│   • Type or speak a note                      │
│   • Saves to IndexedDB immediately            │
│   • Read/create notes with no network         │
│   • Each note: status "pending" → "enhanced"  │
│   • "Enhance" button enabled only when online │
└───────────────────┬───────────────────────────┘
                    │  (only on tap, only when online)
                    ▼
┌─────────────────────────────────────────────┐
│ Anthropic API (claude-haiku-4-5-20251001)     │
│   • Called directly from the browser          │
│   • Your API key lives in localStorage        │
│   • No backend, no server, no middleman       │
└─────────────────────────────────────────────┘
```

### Key design decisions (the "why")

- **Offline-first.** The phone owns your notes (IndexedDB). The AI call is
  optional enrichment — capture and reading never require a connection.

- **No backend.** The Anthropic API is called directly from the browser using
  their `anthropic-dangerous-direct-browser-access` opt-in header. Your API key
  is stored only in your phone's localStorage and goes nowhere except directly
  to Anthropic.

- **Manual enhance, no background process.** Notes sit as `pending` until you
  tap "Enhance" while online. No always-running process, no battery drain.

- **Single structured AI call, not an agent.** Tagging + enhancement is a
  closed task with a known output shape — one call with the allowed tag list and
  JSON schema baked into the prompt. No agent loop needed.

- **No build step.** It's a single `index.html` with inline JS, a manifest,
  and a service worker. Easy to read and tinker with.

### Known constraint: offline voice

The "Speak" button uses the browser's **Web Speech API**, which on most phones
sends audio to the browser vendor's servers to transcribe — so **voice capture
needs a connection**. Typing always works offline.

---

## Project structure

```
ai-notes/
├── frontend/
│   ├── index.html         The whole PWA: capture, IndexedDB, enhance UI
│   ├── sw.js              Service worker (caches app shell for offline)
│   ├── manifest.json      PWA install metadata
│   └── icon-192/512.png   Placeholder icons (replace with your own)
├── .github/
│   └── workflows/
│       └── deploy.yml     Auto-deploys frontend/ to GitHub Pages on push to main
├── .gitignore
└── README.md
```

---

## Setup

No installation needed. The app is hosted on GitHub Pages.

1. Open https://campbellcode.github.io/ai-notes on your phone
2. Tap **Add to Home Screen** to install it as a PWA
3. Tap ⚙ and enter your Anthropic API key — stored locally on your device only

Your API key comes from the [Anthropic Console](https://console.anthropic.com).
This is the pay-as-you-go API, billed separately from any Claude.ai subscription.
Tagging with Haiku is fractions of a cent per note.

### Running locally

No server needed — just open `frontend/index.html` directly in a browser.

### Deploying changes

Push to `main`. GitHub Actions automatically deploys `frontend/` to GitHub Pages.

---

## How it works, step by step

1. You type or speak a note and tap **Save note**.
2. It's written to IndexedDB with `status: "pending"` — saved before anything
   else can fail.
3. You can close the app, go offline, reopen — the note is still there.
4. When online and your API key is set, the **Enhance** button activates. Tap it.
5. The note text is sent directly from your browser to the Anthropic API,
   which returns `{ tags, summary, actionItems, suggestions }`.
6. The note is updated in IndexedDB, `status` flips to `"enhanced"`, and the
   tags + enhancements render.

---

## TODO / roadmap

Built so far: offline capture (type + speak), IndexedDB storage, offline
reading, pending/enhanced status, manual enhance, direct browser-to-Anthropic AI.

Next, roughly in order:

- [ ] **Tune the prompt** — adjust `ALLOWED_TAGS` and `buildPrompt()` in
      `index.html` to match how you actually think.
- [ ] **Edit / delete notes** — currently you can only create and enhance.
- [ ] **Search and filter by tag** — once you have more than a handful of notes.
- [ ] **"Enhance all pending"** button for batch processing when you reconnect.
- [ ] **Replace placeholder icons** with something nicer.
- [ ] **Auto-sync (optional polish)** — Service Worker Background Sync to fire
      enhancement automatically when connectivity returns.
- [ ] **Offline voice (optional)** — local Whisper transcription if
      connection-dependent voice turns out to bug you.

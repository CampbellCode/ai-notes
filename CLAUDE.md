# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Fully browser-based PWA — no backend, no build step, no node_modules. The entire app is `frontend/index.html` (inline CSS + JS) plus a service worker and manifest.

```
Phone browser (PWA)
  └─ Notes → IndexedDB (local, permanent, no network needed)
  └─ Save note → autoTriage() → api.anthropic.com (if online + API key)
       ├─ action:"append" → item added to existing note's steps[], new note discarded, toast shown
       └─ action:"new"    → full enrichment saved directly (status:"enhanced")
  └─ Enhance button → manual re-enrich for pending notes (offline fallback)
```

The Anthropic API is called directly from the browser using the `anthropic-dangerous-direct-browser-access: true` header — this is intentional and Anthropic's official opt-in for this pattern. The user's API key is stored in `localStorage` under `anthropic_api_key` and never touches any server other than Anthropic.

## Deployment

Push to `main` → GitHub Actions (`.github/workflows/deploy.yml`) auto-deploys `frontend/` to GitHub Pages.

Live URL: `https://campbellcode.github.io/ai-notes`

There is no local dev server. To test changes, open `frontend/index.html` directly in a browser, or push to main and check the live URL.

## Key files

- `frontend/index.html` — the whole app. Sections are clearly delimited with `// ===` comments: API Key, IndexedDB, Online status, Creating notes, Speak, AI Enhancement, Rendering, Boot.
- `frontend/sw.js` — caches the app shell (`./`, `index.html`, `manifest.json`) for offline use. **Bump the `CACHE` version string when making changes that need cache invalidation.**
- `frontend/manifest.json` — PWA metadata (name, icons, theme colour).

## Note data shape

```js
{
  id: crypto.randomUUID(),
  text: string,
  status: "pending" | "enhanced",
  tags: string[],        // subset of ALLOWED_TAGS
  summary: string,
  actionItems: string[],
  suggestions: string[],
  createdAt: number,     // Date.now()
}
```

## Tuning the AI

- `ALLOWED_TAGS` — controls visible tag vocabulary for both triage and enrichment.
- `buildTriagePrompt()` — the routing decision prompt. Adjust to tune append-vs-new sensitivity.
- `buildPrompt()` / `buildIncrementalPrompt()` — used by the manual Enhance button for pending notes.
- Model is `claude-haiku-4-5-20251001`. All prompts enforce a fixed JSON schema validated by `parseTriageResult()` / `parseResult()`.

## Design decisions to preserve

- **No build step.** Keep the frontend as a single plain HTML file. No bundlers, no frameworks.
- **Notes are never sent to any server we control.** IndexedDB is the source of truth; the only outbound call is directly to Anthropic.
- **Auto-triage on save.** When online with an API key, saving a note fires `autoTriage()` — one API call decides append vs. new. Offline or no-key saves fall back to `status:"pending"` and the manual Enhance button.
- **Silent merge.** Appended items are added to the target note's `steps[]` without a confirmation prompt; a toast confirms what happened.
- **`canEnhance` requires both `isOnline` and a saved API key.** Don't loosen this check.

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Fully browser-based PWA — no backend, no build step, no node_modules.

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

- `frontend/index.html` — HTML shell only. Links to `styles.css` and `app.js`.
- `frontend/styles.css` — all CSS.
- `frontend/app.js` — all JavaScript. Sections delimited with `// ===` comments: Dark mode, API Key, IndexedDB, Online status, Creating notes, Speak, Data migration, AI Enhancement, Item suggestion modal, Rendering, Boot.
- `frontend/sw.js` — service worker that caches the app shell for offline use.
- `frontend/manifest.json` — PWA metadata (name, icons, theme colour).

## Service worker shell — MUST keep in sync

> **Every time you add or rename a frontend file, you must update `SHELL` in `sw.js` and bump the `CACHE` version string.**

If a file is missing from `SHELL`, the app works on first load (network fetch) but breaks offline — the missing file won't be in the cache.

Current shell in `sw.js`:
```js
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
];
```

Rule of thumb: **add a file to `frontend/` → add it to `SHELL` → bump `CACHE`**.

## Note data shape

```js
{
  id: crypto.randomUUID(),
  text: string,
  status: "pending" | "enhanced",
  tags: string[],        // subset of ALLOWED_TAGS
  contextTags: string[], // internal semantic tags for cross-referencing
  title: string,
  summary: string,
  steps: Array<{         // list items (used to be string[] — auto-migrated on load)
    id: string,
    text: string,
    checked: boolean,
    suggestions: null | { tips: string[], links: {label,url}[], advice: string, generatedAt: number },
  }>,
  tips: string[],
  links: Array<{ label: string, url: string }>,
  createdAt: number,     // Date.now()
  costAUD: number,       // estimated API cost
}
```

## Tuning the AI

- `ALLOWED_TAGS` — controls visible tag vocabulary for both triage and enrichment.
- `buildTriagePrompt()` — the routing decision prompt. Adjust to tune append-vs-new sensitivity.
- `buildPrompt()` / `buildIncrementalPrompt()` — used by the manual Enhance button for pending notes.
- `buildItemSuggestionPrompt()` — per-item AI suggestions (tips, links, advice).
- Model is `claude-haiku-4-5-20251001`. All prompts enforce a fixed JSON schema validated by `parseTriageResult()` / `parseResult()` / `parseItemSuggestionsResult()`.

## Design decisions to preserve

- **No build step.** No bundlers, no frameworks — plain HTML, CSS, and JS files only.
- **Notes are never sent to any server we control.** IndexedDB is the source of truth; the only outbound call is directly to Anthropic.
- **Auto-triage on save.** When online with an API key, saving a note fires `autoTriage()` — one API call decides append vs. new. Offline or no-key saves fall back to `status:"pending"` and the manual Enhance button.
- **Silent merge.** Appended items are added to the target note's `steps[]` without a confirmation prompt; a toast confirms what happened.
- **`canEnhance` requires both `isOnline` and a saved API key.** Don't loosen this check.

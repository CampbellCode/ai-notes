# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Fully browser-based PWA — no backend, no build step, no node_modules. The entire app is `frontend/index.html` (inline CSS + JS) plus a service worker and manifest.

```
Phone browser (PWA)
  └─ Notes → IndexedDB (local, permanent, no network needed)
  └─ Enhance → fetch() → api.anthropic.com (only when online, only on demand)
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

`ALLOWED_TAGS` and `buildPrompt()` in `index.html` are the two things to edit when tuning tag quality or enhancement output. The model is `claude-haiku-4-5-20251001`. The prompt enforces a fixed JSON schema — `parseResult()` validates and filters the response.

## Design decisions to preserve

- **No build step.** Keep the frontend as a single plain HTML file. No bundlers, no frameworks.
- **Notes are never sent to any server we control.** IndexedDB is the source of truth; the only outbound call is directly to Anthropic.
- **Manual enhance only.** No background sync. The Enhance button is intentionally tap-to-trigger.
- **`canEnhance` requires both `isOnline` and a saved API key.** Don't loosen this check.

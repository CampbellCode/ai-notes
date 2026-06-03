---
name: add-feature
description: Add a new feature to the ai-notes PWA using a branch → PR workflow. Creates a feature branch from main, implements the change in frontend/index.html (and bumps the SW cache version), commits, pushes, and opens a GitHub PR for review.
---

You are implementing a new feature for the ai-notes PWA. Follow this exact workflow every time.

## Step 1 — Clarify the feature

If the user hasn't described what feature to add, ask them now before doing anything else:

> "What feature would you like to add?"

Once you have a clear description, derive a short kebab-case slug (2–4 words) to use as the branch name, e.g. `edit-note`, `pin-notes`, `word-count`.

## Step 2 — Set up the branch

Run these git commands in order:

```bash
git checkout main
git pull origin main
git checkout -b feature/<slug>
```

Confirm the branch was created before continuing.

## Step 3 — Implement the feature

The app lives entirely in two files:
- `frontend/index.html` — the whole app (CSS + JS inline). Edit this to add the feature.
- `frontend/sw.js` — service worker. **Always bump the `CACHE` version string** (e.g. `ai-notes-v2` → `ai-notes-v3`) whenever you change `index.html`, so users get the updated app shell.

Follow the constraints in CLAUDE.md:
- No build step, no frameworks, no node_modules — plain HTML/CSS/JS only.
- Notes stay in IndexedDB only; the only outbound call is to Anthropic.
- `canEnhance` must still require both `isOnline` and a saved API key.

## Step 4 — Commit

Stage only the files you changed (`frontend/index.html` and/or `frontend/sw.js`):

```bash
git add frontend/index.html frontend/sw.js
git commit -m "<short imperative summary of the feature>

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

## Step 5 — Push and open a PR

```bash
git push -u origin feature/<slug>
gh pr create \
  --base main \
  --title "<short title>" \
  --body "$(cat <<'EOF'
## Summary
- <bullet describing what was added>
- <any UX or behaviour notes>

## Files changed
- `frontend/index.html` — <what changed>
- `frontend/sw.js` — bumped cache to `ai-notes-vN`

## Test plan
- [ ] Open `frontend/index.html` directly in a browser
- [ ] <specific step to exercise the new feature>
- [ ] Verify existing notes and Enhance still work

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
EOF
)"
```

Return the PR URL to the user when done.

## Important rules

- **Never push directly to main.** Always use a `feature/` branch.
- **Always open a PR** — do not merge yourself.
- **Bump the SW cache version** on every `index.html` change.
- If you're already on a feature branch when `/add-feature` is invoked, check with the user before creating another branch.

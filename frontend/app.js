// ===========================================================================
// Dark mode
// ===========================================================================
const DARK_KEY = "dark_mode";

function applyDarkMode(isDark) {
  document.body.classList.toggle("dark", isDark);
  const btn = document.getElementById("darkBtn");
  if (btn) btn.textContent = isDark ? "☀️" : "🌙";
  document.querySelector('meta[name="theme-color"]').setAttribute("content", isDark ? "#1a1a18" : "#05535f");
}

function toggleDarkMode() {
  const isDark = !document.body.classList.contains("dark");
  localStorage.setItem(DARK_KEY, String(isDark));
  applyDarkMode(isDark);
}

// ===========================================================================
// API Key — stored in localStorage, never leaves the device except to Anthropic
// ===========================================================================
const API_KEY_STORAGE = "anthropic_api_key";

function getApiKey() { return localStorage.getItem(API_KEY_STORAGE) || ""; }

function saveApiKey() {
  const val = document.getElementById("apiKeyInput").value.trim();
  if (val) localStorage.setItem(API_KEY_STORAGE, val);
  closeSettings();
  render();
}

function clearApiKey() {
  localStorage.removeItem(API_KEY_STORAGE);
  document.getElementById("apiKeyInput").value = "";
  closeSettings();
  render();
}

async function openSettings() {
  const key = getApiKey();
  document.getElementById("apiKeyInput").value = key;
  const notes = await dbGetAll();
  const total = notes.reduce((sum, n) => sum + (n.costAUD || 0), 0);
  document.getElementById("totalSpent").textContent = total > 0 ? formatCost(total) : "A$0.00";
  document.getElementById("settingsOverlay").classList.add("open");
}

function closeSettings() {
  document.getElementById("settingsOverlay").classList.remove("open");
}

function overlayClick(e) {
  if (e.target === document.getElementById("settingsOverlay")) closeSettings();
}

// ===========================================================================
// IndexedDB — the phone's own storage. Notes live here, fully offline.
// ===========================================================================
const DB_NAME = "ai-notes-db";
const STORE = "notes";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(note) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ===========================================================================
// Online status
// ===========================================================================
let isOnline = navigator.onLine;
const statusEl = document.getElementById("status");

function setStatus(online) {
  isOnline = online;
  statusEl.textContent = online ? "online" : "offline";
  statusEl.className = online ? "online" : "";
  render();
}

window.addEventListener("online", () => setStatus(true));
window.addEventListener("offline", () => setStatus(false));

// ===========================================================================
// Creating notes
// ===========================================================================
const input = document.getElementById("input");
const composerError = document.getElementById("composerError");

document.getElementById("saveBtn").addEventListener("click", async () => {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  composerError.textContent = "";
  await autoTriage(text, document.getElementById("saveBtn"));
});

// ===========================================================================
// Speak
// ===========================================================================
const speakBtn = document.getElementById("speakBtn");
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

if (!SR) {
  speakBtn.disabled = true;
  speakBtn.title = "Speech recognition not supported in this browser";
} else {
  recognition = new SR();
  recognition.interimResults = false;
  recognition.lang = "en-AU";

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join(" ");
    input.value = (input.value ? input.value + " " : "") + transcript;
  };
  recognition.onerror = (e) => {
    composerError.textContent = "Speech error: " + e.error +
      (e.error === "network" ? " (voice needs a connection)" : "");
  };
  recognition.onend = () => {
    speakBtn.textContent = "Speak";
    speakBtn.classList.remove("recording");
  };

  speakBtn.addEventListener("click", () => {
    if (speakBtn.classList.contains("recording")) {
      recognition.stop();
      return;
    }
    composerError.textContent = "";
    try {
      recognition.start();
      speakBtn.textContent = "Stop";
      speakBtn.classList.add("recording");
    } catch { /* already started */ }
  });
}

// ===========================================================================
// Data migration — steps[] used to be string[]; now it's object[]
// ===========================================================================
function ensureItemObjects(note) {
  if (!Array.isArray(note.steps) || note.steps.length === 0) return note;
  if (typeof note.steps[0] !== "string") return note;
  return {
    ...note,
    steps: note.steps.map(s => ({
      id: crypto.randomUUID(),
      text: s,
      checked: false,
      suggestions: null,
    })),
  };
}

function makeStepObject(text) {
  return { id: crypto.randomUUID(), text, checked: false, suggestions: null };
}

// ===========================================================================
// AI Enhancement — calls Anthropic directly from the browser.
// The API key never leaves this device except to api.anthropic.com.
// ===========================================================================
const ALLOWED_TAGS = ["work", "projects", "fun", "todo", "ideas", "personal"];

// Haiku 4.5 pricing: $1.00 / M input tokens, $5.00 / M output tokens (USD)
const PRICE_INPUT_PER_M  = 1.00;
const PRICE_OUTPUT_PER_M = 5.00;
const USD_TO_AUD = 1.57;

function calcCostAUD(inputTokens, outputTokens) {
  const usd = (inputTokens * PRICE_INPUT_PER_M + outputTokens * PRICE_OUTPUT_PER_M) / 1_000_000;
  return usd * USD_TO_AUD;
}

function formatCost(aud) {
  if (aud <= 0) return "A$0.00";
  if (aud < 0.000001) return "<A$0.000001";
  if (aud < 0.01) return "A$" + aud.toFixed(6);
  return "A$" + aud.toFixed(4);
}

function formatTimestamp(ts) {
  if (ts == null) return "";
  return new Date(ts).toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function buildPrompt(noteText, contextNotes, contextTagVocab) {
  const contextSection = contextNotes && contextNotes.length > 0
    ? `\nRelated notes for context — use these to inform your enhancement where relevant:\n${
        contextNotes.map(n => `- "${n.title}": ${n.summary}`).join("\n")
      }\n`
    : "";

  const vocabSection = contextTagVocab && contextTagVocab.length > 0
    ? `\nExisting context tag vocabulary — prefer reusing these where they fit; only introduce new tags if nothing existing applies:\n${contextTagVocab.join(", ")}\n`
    : "";

  return `You are a research and tagging assistant for a personal notes app. Be genuinely helpful and detailed.
${contextSection}${vocabSection}
Classify the note into one or more of these tags ONLY:
${ALLOWED_TAGS.join(", ")}.
If none fit well, use an empty array. Do NOT invent new tags.

Also generate contextTags: 3–8 specific, lowercase, single-word or hyphenated semantic tags (e.g. "react", "authentication", "project-alpha") used for internal cross-referencing between notes. Prefer tags from the existing vocabulary above; only add new ones if genuinely nothing existing fits.

Then provide a rich, detailed enhancement:
- title: a short, descriptive title for the note (a few words, no trailing punctuation)
- summary: a clear 2-4 sentence overview capturing the gist and any useful context
- steps: array of concrete next steps, each written as a full, specific instruction the reader can actually follow (explain the "how", not just the "what"). Empty array if none.
- tips: array of helpful tips, best practices, or things to watch out for, each a full sentence. Empty array if none.
- links: array of relevant, genuinely useful resources, each an object {"label": "short description", "url": "https://..."}. Only include real, well-known URLs you are confident exist — never invent links. Empty array if none.

Respond with ONLY valid JSON in exactly this shape, no other text:
{"tags": [], "contextTags": [], "title": "", "summary": "", "steps": [], "tips": [], "links": []}

Note:
"""
${noteText}
"""`;
}

function buildIncrementalPrompt(noteText, existingNote, contextNotes, contextTagVocab) {
  const contextSection = contextNotes && contextNotes.length > 0
    ? `\nRelated notes for context:\n${contextNotes.map(n => `- "${n.title}": ${n.summary}`).join("\n")}\n`
    : "";

  const vocabSection = contextTagVocab && contextTagVocab.length > 0
    ? `\nExisting context tag vocabulary — prefer reusing these:\n${contextTagVocab.join(", ")}\n`
    : "";

  const priorSteps = (existingNote.steps || []).map(s =>
    typeof s === "string" ? s : s.text
  );

  const prior = JSON.stringify({
    tags: existingNote.tags || [],
    contextTags: existingNote.contextTags || [],
    title: existingNote.title || "",
    summary: existingNote.summary || "",
    steps: priorSteps,
    tips: existingNote.tips || [],
    links: existingNote.links || [],
  }, null, 2);

  return `You are a research and tagging assistant for a personal notes app.
${contextSection}${vocabSection}
This note has been edited. Previous enrichment:
${prior}

Re-enrich using the full updated note below. Reuse fields that are still accurate; update only what the new content warrants. Keep contextTags stable — prefer existing ones, add new only if clearly needed. Visible tags must only be from: ${ALLOWED_TAGS.join(", ")}.

Respond with ONLY valid JSON in exactly this shape, no other text:
{"tags": [], "contextTags": [], "title": "", "summary": "", "steps": [], "tips": [], "links": []}

Updated note:
"""
${noteText}
"""`;
}

function buildTriagePrompt(noteText, notesIndex) {
  const indexSection = notesIndex.length > 0
    ? `\nExisting notes:\n${JSON.stringify(notesIndex, null, 2)}\n`
    : "\nNo existing notes yet.\n";

  return `You are a smart routing assistant for a personal notes app.
${indexSection}
New note to route:
"""
${noteText}
"""

Decide whether to APPEND this to an existing note as a new list item, or create a NEW standalone note with full enrichment.

Choose "append" when the note is a short task, reminder, or item that clearly belongs to an existing list or collection.
Choose "new" for anything that is a new topic, idea, or thought, or when you are unsure.

For "append":
{"action":"append","targetId":"<id of the matching existing note>","item":"<cleaned item text>"}

For "new":
{"action":"new","tags":[],"contextTags":[],"title":"","summary":"","steps":[],"tips":[],"links":[]}

Rules for "new" enrichment:
- tags: subset of ONLY: ${ALLOWED_TAGS.join(", ")} (empty array if none fit)
- contextTags: 3–8 specific lowercase single-word or hyphenated semantic tags
- title: short descriptive title (a few words, no trailing punctuation)
- summary: 2–4 sentence overview
- steps: concrete actionable next steps — full instructions. Empty array if none.
- tips: helpful tips or best practices. Empty array if none.
- links: [{"label":"...","url":"https://..."}] — only real well-known URLs. Empty array if none.

Respond with ONLY valid JSON, no other text.`;
}

function buildItemSuggestionPrompt(note, item) {
  const otherItems = (note.steps || [])
    .filter(s => s.id !== item.id && !s.checked)
    .map(s => `- ${s.text}`)
    .join("\n");

  return `You are a helpful assistant providing specific, practical suggestions for a single item in a personal notes list.

List context:
- Title: ${note.title || "Untitled list"}
- Summary: ${note.summary || ""}
${otherItems ? `- Other items in this list:\n${otherItems}` : ""}

Item to focus on: "${item.text}"

Generate specific, actionable suggestions for this item only. If the item is too vague or short to give useful suggestions, return empty arrays — do NOT invent filler content.

Rules:
- tips: max 3 short, practical tips specific to this exact item. Empty array if context is too thin.
- links: max 2 real, well-known URLs (product pages, Wikipedia, official docs, reputable retailers). Only include links you are highly confident exist and are relevant. Empty array if unsure.
- advice: one specific sentence of advice, or empty string if nothing genuinely useful.

Respond with ONLY valid JSON, no other text:
{"tips": [], "links": [{"label": "...", "url": "https://..."}], "advice": ""}`;
}

function parseTriageResult(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  if (parsed.action === "append") {
    return {
      action: "append",
      targetId: typeof parsed.targetId === "string" ? parsed.targetId : null,
      item: typeof parsed.item === "string" ? parsed.item.trim() : "",
    };
  }

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter(t => ALLOWED_TAGS.includes(t))
    : [];
  const contextTags = Array.isArray(parsed.contextTags)
    ? parsed.contextTags.filter(t => typeof t === "string" && t.trim()).map(t => t.trim().toLowerCase())
    : [];
  const links = Array.isArray(parsed.links)
    ? parsed.links
        .filter(l => l && typeof l.url === "string" && /^https?:\/\//i.test(l.url))
        .map(l => ({ label: typeof l.label === "string" && l.label ? l.label : l.url, url: l.url }))
    : [];
  return {
    action: "new",
    tags,
    contextTags,
    title: typeof parsed.title === "string" ? parsed.title : "",
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    steps: Array.isArray(parsed.steps) ? parsed.steps.map(s => makeStepObject(String(s))) : [],
    tips: Array.isArray(parsed.tips) ? parsed.tips : [],
    links,
  };
}

function parseResult(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter(t => ALLOWED_TAGS.includes(t))
    : [];
  const contextTags = Array.isArray(parsed.contextTags)
    ? parsed.contextTags.filter(t => typeof t === "string" && t.trim()).map(t => t.trim().toLowerCase())
    : [];
  const links = Array.isArray(parsed.links)
    ? parsed.links
        .filter(l => l && typeof l.url === "string" && /^https?:\/\//i.test(l.url))
        .map(l => ({ label: typeof l.label === "string" && l.label ? l.label : l.url, url: l.url }))
    : [];
  return {
    tags,
    contextTags,
    title: typeof parsed.title === "string" ? parsed.title : "",
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    steps: Array.isArray(parsed.steps) ? parsed.steps.map(s => makeStepObject(String(s))) : [],
    tips: Array.isArray(parsed.tips) ? parsed.tips : [],
    links,
  };
}

function parseItemSuggestionsResult(raw) {
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const tips = Array.isArray(parsed.tips)
      ? parsed.tips.filter(t => typeof t === "string" && t.trim()).map(t => t.trim())
      : [];
    const links = Array.isArray(parsed.links)
      ? parsed.links
          .filter(l => l && typeof l.url === "string" && /^https?:\/\//i.test(l.url))
          .map(l => ({ label: typeof l.label === "string" && l.label ? l.label : l.url, url: l.url }))
      : [];
    const advice = typeof parsed.advice === "string" ? parsed.advice.trim() : "";
    return { tips, links, advice };
  } catch {
    return { tips: [], links: [], advice: "" };
  }
}

function findRelatedNotes(noteText, allNotes, currentNoteId) {
  const words = new Set(noteText.toLowerCase().split(/\W+/).filter(w => w.length > 3));
  return allNotes
    .filter(n => n.id !== currentNoteId && n.status === "enhanced" && n.contextTags?.length && n.summary && n.title)
    .filter(n => n.contextTags.some(tag => words.has(tag) || [...words].some(w => tag.includes(w) || w.includes(tag))))
    .slice(0, 5);
}

async function enhance(note) {
  const apiKey = getApiKey();
  if (!isOnline || !apiKey) return;

  const isReEnrich = !!(note.title || note.summary);
  const errEl = document.getElementById("err-" + note.id);
  const btn = document.getElementById("btn-" + note.id);
  if (errEl) errEl.textContent = "";
  if (btn) { btn.disabled = true; btn.textContent = isReEnrich ? "Re-enriching…" : "Enhancing…"; }

  try {
    const allNotes = await dbGetAll();
    const contextNotes = findRelatedNotes(note.text, allNotes, note.id);
    const contextTagVocab = [...new Set(
      allNotes
        .filter(n => n.id !== note.id && n.contextTags?.length)
        .flatMap(n => n.contextTags)
    )].sort();

    const prompt = isReEnrich
      ? buildIncrementalPrompt(note.text, note, contextNotes, contextTagVocab)
      : buildPrompt(note.text, contextNotes, contextTagVocab);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    const result = parseResult(data.content[0].text);
    const { input_tokens, output_tokens } = data.usage;
    const costAUD = calcCostAUD(input_tokens, output_tokens);

    // Preserve checked state and per-item suggestions when re-enriching
    const migratedNote = ensureItemObjects(note);
    const existingStepsById = Object.fromEntries(
      (migratedNote.steps || []).map(s => [s.text.toLowerCase().trim(), s])
    );
    const mergedSteps = result.steps.map(newStep => {
      const existing = existingStepsById[newStep.text.toLowerCase().trim()];
      return existing
        ? { ...newStep, id: existing.id, checked: existing.checked, suggestions: existing.suggestions }
        : newStep;
    });

    await dbPut({ ...note, ...result, steps: mergedSteps, status: "enhanced", costAUD });
    render();
  } catch (err) {
    if (errEl) errEl.textContent = "Enhance failed: " + err.message;
    if (btn) { btn.disabled = false; btn.textContent = isReEnrich ? "Re-enrich" : "Enhance"; }
  }
}

function showToast(message) {
  const el = document.getElementById("toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
}

async function autoTriage(rawText, saveBtn) {
  const apiKey = getApiKey();

  if (!isOnline || !apiKey) {
    await dbPut({
      id: crypto.randomUUID(),
      text: rawText,
      status: "pending",
      tags: [],
      title: "",
      summary: "",
      steps: [],
      tips: [],
      links: [],
      createdAt: Date.now(),
    });
    render();
    return;
  }

  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = "Routing…"; }

  try {
    const allNotes = await dbGetAll();
    const notesIndex = allNotes
      .filter(n => n.status === "enhanced" && n.title)
      .map(n => ({ id: n.id, title: n.title, tags: n.tags || [], contextTags: n.contextTags || [] }));

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        messages: [{ role: "user", content: buildTriagePrompt(rawText, notesIndex) }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    const result = parseTriageResult(data.content[0].text);
    const { input_tokens, output_tokens } = data.usage;
    const costAUD = calcCostAUD(input_tokens, output_tokens);

    if (result.action === "append" && result.targetId && result.item) {
      const freshNotes = await dbGetAll();
      const target = freshNotes.find(n => n.id === result.targetId);
      if (target) {
        const migratedTarget = ensureItemObjects(target);
        await dbPut({
          ...migratedTarget,
          steps: [...(migratedTarget.steps || []), makeStepObject(result.item)],
          costAUD: (migratedTarget.costAUD || 0) + costAUD,
        });
        showToast(`Added to "${target.title}"`);
        render();
        return;
      }
    }

    // action === "new" (or append target not found — fall back to new note)
    const { action, ...enrichment } = result;
    await dbPut({
      id: crypto.randomUUID(),
      text: rawText,
      status: "enhanced",
      createdAt: Date.now(),
      costAUD,
      ...enrichment,
    });
    render();
  } catch (err) {
    await dbPut({
      id: crypto.randomUUID(),
      text: rawText,
      status: "pending",
      tags: [],
      title: "",
      summary: "",
      steps: [],
      tips: [],
      links: [],
      createdAt: Date.now(),
    });
    composerError.textContent = "Auto-routing failed — saved as pending.";
    render();
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = "Save note"; }
  }
}

// ===========================================================================
// Item suggestion modal
// ===========================================================================
let _modalNoteId = null;
let _modalItemId = null;

async function openItemModal(noteId, itemId) {
  _modalNoteId = noteId;
  _modalItemId = itemId;
  const allNotes = await dbGetAll();
  const note = ensureItemObjects(allNotes.find(n => n.id === noteId));
  if (!note) return;
  document.getElementById("itemModalOverlay").classList.add("open");
  renderItemModalContent(note, itemId);
}

function closeItemModal() {
  document.getElementById("itemModalOverlay").classList.remove("open");
  _modalNoteId = null;
  _modalItemId = null;
}

function itemModalOverlayClick(e) {
  if (e.target === document.getElementById("itemModalOverlay")) closeItemModal();
}

function renderItemModalContent(note, itemId) {
  const item = (note.steps || []).find(s => s.id === itemId);
  if (!item) return;
  const bodyEl = document.getElementById("itemModalBody");
  if (!bodyEl) return;

  const sugg = item.suggestions;
  const hasSugg = sugg && (sugg.tips.length > 0 || sugg.links.length > 0 || sugg.advice);

  let suggestionsHtml;
  if (hasSugg) {
    const tipsHtml = sugg.tips.length
      ? `<ul class="sugg-tips">${sugg.tips.map(t => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
      : "";
    const linksHtml = sugg.links.length
      ? `<ul class="sugg-links">${sugg.links.map(l =>
          `<li><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a></li>`
        ).join("")}</ul>`
      : "";
    const adviceHtml = sugg.advice
      ? `<div class="sugg-advice">${escapeHtml(sugg.advice)}</div>`
      : "";
    const tsHtml = sugg.generatedAt
      ? `<div class="sugg-ts">Generated ${formatRelativeTime(sugg.generatedAt)}</div>`
      : "";
    suggestionsHtml = `
      <div class="sugg-divider">AI Suggestions</div>
      ${tipsHtml}${linksHtml}${adviceHtml}${tsHtml}
      <button class="btn-secondary btn-small" id="itemModalGenBtn"
              onclick="generateItemSuggestions('${escapeHtml(note.id)}', '${escapeHtml(item.id)}')">↺ Regenerate</button>`;
  } else if (sugg !== null && sugg !== undefined) {
    // Generated but empty (thin context)
    suggestionsHtml = `
      <div class="sugg-divider">AI Suggestions</div>
      <div class="sugg-empty">Not enough context to generate useful suggestions.<br>Try adding more detail to the item above, then regenerate.</div>
      <button class="btn-secondary btn-small" id="itemModalGenBtn"
              onclick="generateItemSuggestions('${escapeHtml(note.id)}', '${escapeHtml(item.id)}')">↺ Try again</button>`;
  } else {
    const canGen = isOnline && !!getApiKey();
    suggestionsHtml = `
      <div class="sugg-divider">AI Suggestions</div>
      <div class="sugg-empty">No suggestions yet.</div>
      <button class="${canGen ? "btn-primary" : "btn-secondary"} btn-small" id="itemModalGenBtn"
              ${canGen ? "" : "disabled"}
              onclick="generateItemSuggestions('${escapeHtml(note.id)}', '${escapeHtml(item.id)}')">✨ Generate</button>`;
  }

  bodyEl.innerHTML = `
    <textarea id="itemModalTextarea" class="item-modal-textarea">${escapeHtml(item.text)}</textarea>
    <div class="item-modal-actions">
      <button class="btn-primary btn-small"
              onclick="window._saveItemText('${escapeHtml(note.id)}', '${escapeHtml(item.id)}')">Save</button>
      <button class="btn-secondary btn-small" onclick="closeItemModal()">Close</button>
    </div>
    ${suggestionsHtml}`;
}

async function generateItemSuggestions(noteId, itemId) {
  const apiKey = getApiKey();
  if (!isOnline || !apiKey) {
    showToast("Need internet + API key to generate suggestions");
    return;
  }

  const genBtn = document.getElementById("itemModalGenBtn");
  if (genBtn) { genBtn.disabled = true; genBtn.textContent = "Generating…"; }

  try {
    const allNotes = await dbGetAll();
    const note = ensureItemObjects(allNotes.find(n => n.id === noteId));
    if (!note) return;
    const item = (note.steps || []).find(s => s.id === itemId);
    if (!item) return;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        messages: [{ role: "user", content: buildItemSuggestionPrompt(note, item) }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API error ${res.status}: ${body}`);
    }

    const data = await res.json();
    const suggestions = { ...parseItemSuggestionsResult(data.content[0].text), generatedAt: Date.now() };

    const updatedNote = {
      ...note,
      steps: note.steps.map(s => s.id === itemId ? { ...s, suggestions } : s),
    };
    await dbPut(updatedNote);

    renderItemModalContent(updatedNote, itemId);
    // Refresh lightbulb state in detail view without closing modal
    if (selectedNoteId === noteId) render();
  } catch (err) {
    showToast("Failed: " + err.message);
    if (genBtn) { genBtn.disabled = false; genBtn.textContent = "↺ Retry"; }
  }
}

window._saveItemText = async (noteId, itemId) => {
  const textarea = document.getElementById("itemModalTextarea");
  if (!textarea) return;
  const newText = textarea.value.trim();
  if (!newText) return;
  const allNotes = await dbGetAll();
  const note = ensureItemObjects(allNotes.find(n => n.id === noteId));
  if (!note) return;
  const updatedNote = {
    ...note,
    steps: note.steps.map(s => s.id === itemId
      ? { ...s, text: newText, suggestions: null }
      : s),
  };
  await dbPut(updatedNote);
  renderItemModalContent(updatedNote, itemId);
  if (selectedNoteId === noteId) render();
};

window._toggleItemChecked = async (noteId, itemId) => {
  const allNotes = await dbGetAll();
  const note = ensureItemObjects(allNotes.find(n => n.id === noteId));
  if (!note) return;
  const updatedNote = {
    ...note,
    steps: note.steps.map(s => s.id === itemId ? { ...s, checked: !s.checked } : s),
  };
  await dbPut(updatedNote);
  render();
};

// ===========================================================================
// Rendering
// ===========================================================================
const notesEl = document.getElementById("notes");
let selectedNoteId = null;
let editingNoteId = null;

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function openNote(id) {
  selectedNoteId = id;
  window.scrollTo(0, 0);
  render();
}

function closeNote() {
  selectedNoteId = null;
  editingNoteId = null;
  window.scrollTo(0, 0);
  render();
}

function renderChecklistItem(item, noteId) {
  const hasSugg = item.suggestions !== null && item.suggestions !== undefined;
  const checkedClass = item.checked ? " checked" : "";
  return `<div class="checklist-item">
    <button class="checklist-checkbox${checkedClass}"
            onclick="window._toggleItemChecked('${escapeHtml(noteId)}', '${escapeHtml(item.id)}')">${item.checked ? "✓" : ""}</button>
    <span class="checklist-text${checkedClass}">${escapeHtml(item.text)}</span>
    <button class="checklist-lightbulb${hasSugg ? " has-suggestions" : ""}"
            onclick="openItemModal('${escapeHtml(noteId)}', '${escapeHtml(item.id)}')"
            title="AI suggestions">💡</button>
  </div>`;
}

function renderCompact(n) {
  const displayTitle = n.title || (n.text.length > 60 ? n.text.slice(0, 60) + "…" : n.text);
  const steps = n.steps || [];
  const unchecked = steps.filter(s => !s.checked);
  const checked = steps.filter(s => s.checked);
  const previewItems = [...unchecked, ...checked].slice(0, 4);

  let itemsHtml = "";
  if (previewItems.length > 0) {
    itemsHtml = previewItems.map(s => {
      const text = typeof s === "string" ? s : s.text;
      const isChecked = typeof s === "object" && s.checked;
      return `<div class="note-card-item${isChecked ? " checked" : ""}">
        <span class="note-card-item-dot">${isChecked ? "✓" : "·"}</span>
        <span class="note-card-item-text">${escapeHtml(text.length > 50 ? text.slice(0, 50) + "…" : text)}</span>
      </div>`;
    }).join("");
    if (steps.length > 4) {
      itemsHtml += `<div class="note-card-item" style="font-style:italic;">+${steps.length - 4} more</div>`;
    }
  } else if (n.text && !n.title) {
    itemsHtml = `<div class="note-card-item"><span class="note-card-item-text">${escapeHtml(n.text.length > 80 ? n.text.slice(0, 80) + "…" : n.text)}</span></div>`;
  }

  const tags = (n.tags || []).slice(0, 2).map(t =>
    `<span class="tag-small">${escapeHtml(t)}</span>`
  ).join("");

  const statusClass = n.status === "enhanced" ? "enhanced" : "pending";
  const statusLabel = n.status === "enhanced" ? "✓" : "●";
  const canEnhance = isOnline && !!getApiKey() && n.status === "pending";
  const enhanceBtn = n.status === "pending"
    ? `<button class="btn-secondary btn-small" id="btn-${n.id}"
         ${canEnhance ? "" : "disabled"}
         onclick="event.stopPropagation(); window._enhanceById('${n.id}')">${(n.title || n.summary) ? "Re-enrich" : "Enhance"}</button>`
    : "";

  return `
    <div class="note-card" onclick="openNote('${n.id}')">
      <div class="note-card-title">${escapeHtml(displayTitle)}</div>
      <div class="note-card-items">${itemsHtml}</div>
      <div class="note-card-footer">
        <div class="note-card-tags">${tags}</div>
        <span class="badge note-card-status ${statusClass}">${statusLabel}</span>
        ${enhanceBtn}
      </div>
      <div class="error" id="err-${n.id}"></div>
    </div>`;
}

function renderDetail(n, canEnhance) {
  const tags = (n.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");
  const isEditing = editingNoteId === n.id;
  const wasEnriched = !!(n.title || n.summary);
  const enhanceBtnLabel = wasEnriched ? "Re-enrich" : "Enhance";

  let bodyHtml;
  if (isEditing) {
    bodyHtml = `
      <textarea id="edit-textarea-${n.id}" class="note-edit-textarea">${escapeHtml(n.text)}</textarea>
      <div class="edit-actions">
        <button class="btn-primary btn-small" onclick="window._saveEdit('${n.id}')">Save</button>
        <button class="btn-secondary btn-small" onclick="window._cancelEdit()">Cancel</button>
      </div>`;
  } else {
    bodyHtml = `<div class="note-text">${escapeHtml(n.text)}</div>`;
  }

  let enhancement = "";
  if (!isEditing && n.status === "enhanced") {
    const steps = n.steps || n.actionItems || [];
    const unchecked = steps.filter(s => !(typeof s === "object" ? s.checked : false));
    const checked = steps.filter(s => typeof s === "object" && s.checked);

    const uncheckedHtml = unchecked.map(s => {
      if (typeof s === "string") return renderChecklistItem({ id: crypto.randomUUID(), text: s, checked: false, suggestions: null }, n.id);
      return renderChecklistItem(s, n.id);
    }).join("");

    const checkedHtml = checked.length
      ? `<div class="completed-header">Completed (${checked.length})</div>
         ${checked.map(s => renderChecklistItem(s, n.id)).join("")}`
      : "";

    const checklistHtml = (uncheckedHtml || checkedHtml)
      ? `<h4>Steps</h4><div class="checklist-section">${uncheckedHtml}${checkedHtml}</div>`
      : "";

    const tips = (n.tips || n.suggestions || []).map(s => `<li>${escapeHtml(s)}</li>`).join("");
    const links = (n.links || []).map(l =>
      `<li><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)}</a></li>`
    ).join("");
    const ctags = (n.contextTags || []);
    const contextTagsHtml = ctags.length
      ? `<div class="context-tags-section">
           <div class="context-tags-label">Context tags</div>
           <div class="context-tags-list">${ctags.map(t => `<span class="context-tag">${escapeHtml(t)}</span>`).join("")}</div>
         </div>`
      : "";
    enhancement = `
      <div class="enhancement">
        ${n.summary ? `<div class="summary">${escapeHtml(n.summary)}</div>` : ""}
        ${checklistHtml}
        ${tips ? `<h4>Tips</h4><ul>${tips}</ul>` : ""}
        ${links ? `<h4>Links</h4><ul class="links">${links}</ul>` : ""}
        ${contextTagsHtml}
      </div>`;
  }

  return `
    <button class="back-btn" onclick="closeNote()">← Back</button>
    <div class="note">
      ${n.title ? `<div class="note-title">${escapeHtml(n.title)}</div>` : ""}
      ${bodyHtml}
      <div class="note-meta">
        ${tags}
        <span class="badge timestamp" title="Created">${escapeHtml(formatTimestamp(n.createdAt))}</span>
        <span class="badge ${n.status}">${n.status === "enhanced" ? "✓ enhanced" : "● pending"}</span>
        ${n.costAUD != null ? `<span class="badge" title="Estimated API cost">${formatCost(n.costAUD)}</span>` : ""}
        <span class="spacer"></span>
        ${!isEditing ? `<button class="btn-secondary btn-small" onclick="window._editNote('${n.id}')">Edit</button>` : ""}
        ${n.status === "pending" && !isEditing
          ? `<button class="btn-secondary btn-small" id="btn-${n.id}"
               ${canEnhance ? "" : "disabled"}
               onclick="window._enhanceById('${n.id}')">${enhanceBtnLabel}</button>`
          : ""}
        <button class="btn-danger btn-small" onclick="window._deleteById('${n.id}')">Delete</button>
      </div>
      <div class="error" id="err-${n.id}"></div>
      ${enhancement}
    </div>`;
}

async function render() {
  const hasKey = !!getApiKey();
  const inDetail = !!selectedNoteId;

  document.getElementById("noKeyBanner").style.display = (!inDetail && !hasKey) ? "block" : "none";
  document.querySelector(".composer").style.display = inDetail ? "none" : "";

  let notes = (await dbGetAll()).sort((a, b) => b.createdAt - a.createdAt);

  // Migrate legacy string-step notes and persist migrated versions
  const needsMigration = notes.filter(n => n.steps?.length > 0 && typeof n.steps[0] === "string");
  if (needsMigration.length > 0) {
    for (const n of needsMigration) {
      await dbPut(ensureItemObjects(n));
    }
    notes = notes.map(ensureItemObjects);
  }

  if (inDetail) {
    const note = notes.find(n => n.id === selectedNoteId);
    if (!note) {
      selectedNoteId = null;
    } else {
      notesEl.innerHTML = renderDetail(note, isOnline && hasKey && note.status === "pending");
      return;
    }
  }

  if (notes.length === 0) {
    notesEl.innerHTML = '<div class="empty">No notes yet. Capture your first one above.</div>';
    return;
  }

  notesEl.innerHTML = `<div class="notes-grid">${notes.map(renderCompact).join("")}</div>`;
}

window._editNote = (id) => {
  editingNoteId = id;
  render();
};

window._cancelEdit = () => {
  editingNoteId = null;
  render();
};

window._saveEdit = async (id) => {
  const textarea = document.getElementById("edit-textarea-" + id);
  if (!textarea) return;
  const newText = textarea.value.trim();
  if (!newText) return;
  const notes = await dbGetAll();
  const note = notes.find(n => n.id === id);
  if (!note) return;
  await dbPut({ ...note, text: newText, status: "pending" });
  editingNoteId = null;
  render();
};

window._enhanceById = async (id) => {
  const notes = await dbGetAll();
  const note = notes.find(n => n.id === id);
  if (note) enhance(note);
};

window._deleteById = async (id) => {
  if (!confirm("Delete this note?")) return;
  await dbDelete(id);
  if (selectedNoteId === id) selectedNoteId = null;
  render();
};

// ===========================================================================
// Boot
// ===========================================================================
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
const _savedDark = localStorage.getItem(DARK_KEY);
applyDarkMode(_savedDark !== null ? _savedDark === "true" : window.matchMedia("(prefers-color-scheme: dark)").matches);
setStatus(navigator.onLine);
render();

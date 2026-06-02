// aiProvider.js
// ---------------------------------------------------------------------------
// THE SWAP POINT. The rest of the app calls enhanceNote(text) and gets back
// { tags, summary, actionItems, suggestions }. Whether that comes from a cloud
// API or a local model is decided here and nowhere else.
//
// Switch providers by setting AI_PROVIDER in your environment:
//   AI_PROVIDER=cloud   -> uses Anthropic (needs ANTHROPIC_API_KEY)
//   AI_PROVIDER=local   -> uses Ollama on your machine (no key needed)
// ---------------------------------------------------------------------------

const PROVIDER = process.env.AI_PROVIDER || "cloud";

// The allowed tag set. Edit this list to change what the model can tag with.
const ALLOWED_TAGS = ["work", "projects", "fun", "todo", "ideas", "personal"];

// --- The prompt: this IS your guardrails + context, assembled in one string ---
function buildPrompt(noteText) {
  return `You are a tagging assistant for a personal notes app.

Classify the note into one or more of these tags ONLY:
${ALLOWED_TAGS.join(", ")}.
If none fit well, use an empty array. Do NOT invent new tags.

Then provide enhancements:
- summary: one short sentence capturing the gist
- actionItems: array of concrete next steps (empty array if none)
- suggestions: array of brief helpful ideas (empty array if none)

Respond with ONLY valid JSON in exactly this shape, no other text:
{"tags": [], "summary": "", "actionItems": [], "suggestions": []}

Note:
"""
${noteText}
"""`;
}

// --- Cloud: Anthropic Messages API ---
async function callCloud(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      // Haiku 4.5: fastest + cheapest current model, ideal for tagging.
      model: process.env.CLOUD_MODEL || "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloud API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

// --- Local: Ollama running on your PC ---
async function callLocal(prompt) {
  const host = process.env.OLLAMA_HOST || "http://localhost:11434";
  const res = await fetch(`${host}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.LOCAL_MODEL || "llama3.1",
      prompt,
      format: "json", // Ollama forces syntactically valid JSON output.
      stream: false,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Local model error ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.response;
}

// --- Safe JSON parse: strip stray code fences, validate shape ---
function parseResult(raw) {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);

  // Keep only tags that are actually allowed (model occasionally drifts).
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.filter((t) => ALLOWED_TAGS.includes(t))
    : [];

  return {
    tags,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
  };
}

// --- The one function the rest of the app uses ---
export async function enhanceNote(text) {
  const prompt = buildPrompt(text);
  const call = PROVIDER === "local" ? callLocal : callCloud;

  let raw;
  try {
    raw = await call(prompt);
  } catch (err) {
    // Network / provider failure: bubble up so the route can report it.
    throw new Error(`AI provider (${PROVIDER}) failed: ${err.message}`);
  }

  // Parse, and retry once if the model returned malformed JSON.
  try {
    return parseResult(raw);
  } catch {
    const retryRaw = await call(prompt);
    return parseResult(retryRaw); // if this also throws, the route handles it
  }
}

export { PROVIDER, ALLOWED_TAGS };

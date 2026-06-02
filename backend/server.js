// server.js
// ---------------------------------------------------------------------------
// A deliberately tiny backend. Its only real job is the /api/enhance endpoint.
//
// Note the architecture: the phone owns your notes (in its own IndexedDB).
// The backend does NOT store notes. It's a stateless enrichment service that
// takes note text, runs the AI call, and returns tags + enhancements.
// That's why there's no database here.
// ---------------------------------------------------------------------------

import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { enhanceNote, PROVIDER } from "./aiProvider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Serve the PWA frontend (so phone + backend can be one address).
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Health check — the frontend pings this to decide if the backend is reachable.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true, provider: PROVIDER });
});

// The core endpoint: text in, tags + enhancements out.
app.post("/api/enhance", async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Missing note text." });
  }
  try {
    const result = await enhanceNote(text);
    res.json(result);
  } catch (err) {
    console.error("Enhance failed:", err.message);
    res.status(502).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`AI notes backend running on http://localhost:${PORT}`);
  console.log(`AI provider: ${PROVIDER}`);
});

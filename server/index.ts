import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import multer from "multer";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { guideJsonSchema, type Guide } from "../shared/guide.ts";
import { toContentBlocks, UnsupportedFileError, type UploadedFile } from "./extract.ts";
import { SYSTEM_PROMPT, userInstructions, type Detail } from "./prompt.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // No .env file: rely on the real environment.
}

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const EFFORT = (process.env.CLAUDE_EFFORT ?? "high") as "low" | "medium" | "high" | "xhigh" | "max";
const PASSCODE = process.env.APP_PASSCODE ?? "";
const MOCK = process.env.MOCK_GENERATION === "1";
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024; // API request limit is 32 MB, leave headroom for base64 + prompt

const client = new Anthropic();
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 } });

function passcodeMatches(given: string) {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(PASSCODE).digest();
  return timingSafeEqual(a, b);
}

function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) || MOCK;
}

app.get("/api/status", (_req, res) => {
  res.json({ ready: hasCredentials(), passcodeRequired: Boolean(PASSCODE), model: MODEL, mock: MOCK });
});

type Event =
  | { type: "stage"; stage: "reading" | "writing" | "finishing" }
  | { type: "progress"; chars: number; sections: number; flashcards: number; quiz: number }
  | { type: "done"; guide: Guide }
  | { type: "error"; message: string };

app.post("/api/generate", upload.array("files", 10), async (req, res) => {
  if (PASSCODE && !passcodeMatches(req.get("x-app-passcode") ?? "")) {
    res.status(401).json({ error: "Wrong or missing passcode." });
    return;
  }
  if (!hasCredentials()) {
    res.status(503).json({ error: "The server has no ANTHROPIC_API_KEY configured." });
    return;
  }

  const files = (req.files as UploadedFile[] | undefined) ?? [];
  const context = String(req.body?.context ?? "").slice(0, 4000);
  const detail: Detail = ["concise", "standard", "thorough"].includes(req.body?.detail) ? req.body.detail : "standard";
  const pastedText = String(req.body?.text ?? "");

  if (files.length === 0 && !pastedText.trim()) {
    res.status(400).json({ error: "Add at least one file or paste some text." });
    return;
  }
  const totalBytes = files.reduce((n, f) => n + f.buffer.length, 0) + pastedText.length;
  if (totalBytes > MAX_UPLOAD_BYTES) {
    res.status(413).json({ error: "Those files are over 30 MB combined. Split them into smaller batches." });
    return;
  }

  let blocks: Anthropic.Beta.BetaContentBlockParam[];
  try {
    blocks = (await Promise.all(files.map(toContentBlocks))).flat();
  } catch (err) {
    const message = err instanceof UnsupportedFileError ? err.message : "One of the files couldn't be read.";
    res.status(400).json({ error: message });
    return;
  }
  if (pastedText.trim()) {
    blocks.push({
      type: "document",
      title: "Pasted notes",
      source: { type: "text", media_type: "text/plain", data: pastedText },
    });
  }
  const names = [...files.map((f) => f.originalname), ...(pastedText.trim() ? ["pasted notes"] : [])];

  // From here on we stream newline-delimited JSON events.
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no");
  const send = (e: Event) => res.write(JSON.stringify(e) + "\n");
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  send({ type: "stage", stage: "reading" });

  try {
    const guide = MOCK
      ? await mockGenerate(send, abort.signal)
      : await generate(blocks, userInstructions(context, detail, names), send, abort.signal);
    send({ type: "done", guide });
  } catch (err) {
    if (abort.signal.aborted) return;
    console.error(err);
    send({ type: "error", message: describeError(err) });
  } finally {
    res.end();
  }
});

async function generate(
  blocks: Anthropic.Beta.BetaContentBlockParam[],
  instructions: string,
  send: (e: Event) => void,
  signal: AbortSignal,
): Promise<Guide> {
  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: EFFORT, format: { type: "json_schema", schema: guideJsonSchema } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: [...blocks, { type: "text", text: instructions }] }],
    },
    { signal },
  );

  let text = "";
  let lastSent = 0;
  let started = false;
  stream.on("text", (delta) => {
    if (!started) {
      started = true;
      send({ type: "stage", stage: "writing" });
    }
    text += delta;
    if (text.length - lastSent > 400) {
      lastSent = text.length;
      send({
        type: "progress",
        chars: text.length,
        sections: count(text, '"simplified"'),
        flashcards: count(text, '"front"'),
        quiz: count(text, '"answer_index"'),
      });
    }
  });

  const message = await stream.finalMessage();
  send({ type: "stage", stage: "finishing" });

  if (message.stop_reason === "refusal") {
    throw new Error("Claude declined to process this material. Try different files.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error("The material was too long to finish in one pass. Try uploading fewer pages at a time.");
  }
  const json = message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return normalize(JSON.parse(json) as Guide);
}

function count(haystack: string, needle: string) {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

/** Defensive cleanup so the UI never has to guess. */
function normalize(g: Guide): Guide {
  const ids = new Set(g.sections.map((s) => s.id));
  const fallbackId = g.sections[0]?.id ?? "";
  const fixId = <T extends { section_id: string }>(x: T) => (ids.has(x.section_id) ? x : { ...x, section_id: fallbackId });
  return {
    ...g,
    key_terms: g.key_terms.map(fixId),
    numbers_to_know: g.numbers_to_know.map(fixId),
    lists_to_memorize: g.lists_to_memorize.map(fixId),
    exam_focus: g.exam_focus.map(fixId),
    flashcards: g.flashcards.filter((c) => c.front.trim() && c.back.trim()).map(fixId),
    quiz: g.quiz
      .filter((q) => q.choices.length >= 2 && q.answer_index >= 0 && q.answer_index < q.choices.length)
      .map(fixId),
  };
}

function describeError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) return "The server's Anthropic API key was rejected.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the API. Wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) return `The API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Anthropic API.";
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  if (err instanceof SyntaxError) return "The generated guide came back malformed. Please try again.";
  return err instanceof Error ? err.message : "Something went wrong.";
}

/** Replays the bundled sample so the UI can be exercised without an API key. */
async function mockGenerate(send: (e: Event) => void, signal: AbortSignal): Promise<Guide> {
  const raw = await readFile(path.join(root, "public/samples/public-fire-protection.json"), "utf8");
  const guide = JSON.parse(raw).guide as Guide;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await wait(1200);
  send({ type: "stage", stage: "writing" });
  for (let i = 1; i <= 10 && !signal.aborted; i++) {
    await wait(300);
    send({
      type: "progress",
      chars: Math.round((raw.length * i) / 10),
      sections: Math.round((guide.sections.length * i) / 10),
      flashcards: i > 6 ? Math.round((guide.flashcards.length * (i - 6)) / 4) : 0,
      quiz: i > 8 ? Math.round((guide.quiz.length * (i - 8)) / 2) : 0,
    });
  }
  send({ type: "stage", stage: "finishing" });
  return guide;
}

// Static client in production.
if (process.env.NODE_ENV === "production") {
  const dist = path.join(root, "dist");
  app.use(express.static(dist, { maxAge: "1h", index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "A file is over the 30 MB limit." : err.message;
    res.status(400).json({ error: msg });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Server error." });
});

app.listen(PORT, () => {
  console.log(`mystudy server on http://localhost:${PORT} (model ${MODEL}${MOCK ? ", MOCK mode" : ""})`);
  if (!hasCredentials()) console.warn("ANTHROPIC_API_KEY is not set — generation is disabled.");
});

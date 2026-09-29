import Anthropic from "@anthropic-ai/sdk";
import { del as deleteBlobs, get as getBlob } from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import express from "express";
import multer from "multer";
import { createHash, timingSafeEqual } from "node:crypto";
import sample from "../public/samples/public-fire-protection.json" with { type: "json" };
import { guideJsonSchema, normalizeGuide, type Guide } from "../shared/guide.js";
import { toContentBlocks, UnsupportedFileError, type UploadedFile } from "./extract.js";
import { SYSTEM_PROMPT, userInstructions, type Detail } from "../shared/prompt.js";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// The API's request limit is 32 MB; leave headroom for base64 and the prompt.
const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
// Vercel rejects function request bodies over 4.5 MB, so without Blob storage uploads must stay under that.
const VERCEL_BODY_LIMIT = 4 * 1024 * 1024;

const UPLOAD_CONTENT_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/octet-stream",
  "image/*",
  "text/*",
  "application/json",
  "application/rtf",
];

type Event =
  | { type: "stage"; stage: "reading" | "writing" | "finishing" }
  | { type: "progress"; chars: number; sections: number; flashcards: number; quiz: number }
  | { type: "done"; guide: Guide }
  | { type: "error"; message: string };

interface BlobRef {
  url: string;
  name: string;
  contentType: string;
}

/** Builds the API. Reads configuration from the environment when called. */
export function createApp() {
  const MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
  const EFFORT = (process.env.CLAUDE_EFFORT ?? "medium") as Effort;
  const PASSCODE = process.env.APP_PASSCODE ?? "";
  const MOCK = process.env.MOCK_GENERATION === "1";
  const ON_VERCEL = Boolean(process.env.VERCEL);
  const BLOB = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
  const BLOB_ACCESS = process.env.BLOB_ACCESS === "public" ? "public" : "private";
  const maxUploadBytes = ON_VERCEL && !BLOB ? VERCEL_BODY_LIMIT : MAX_UPLOAD_BYTES;

  const client = new Anthropic();
  const app = express();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxUploadBytes, files: 10 } });

  const passcodeMatches = (given: string) =>
    timingSafeEqual(createHash("sha256").update(given).digest(), createHash("sha256").update(PASSCODE).digest());
  const authorized = (given: string | undefined) => !PASSCODE || passcodeMatches(given ?? "");
  const hasCredentials = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) || MOCK;

  app.get("/api/status", (_req, res) => {
    res.json({
      ready: hasCredentials(),
      passcodeRequired: Boolean(PASSCODE),
      model: MODEL,
      mock: MOCK,
      uploadMode: BLOB ? "blob" : "direct",
      blobAccess: BLOB_ACCESS,
      maxUploadBytes: BLOB ? MAX_UPLOAD_BYTES : maxUploadBytes,
    });
  });

  // Issues short-lived tokens so the browser can upload large files straight to Vercel Blob.
  app.post("/api/upload", express.json(), async (req, res) => {
    if (!BLOB) {
      res.status(404).json({ error: "Blob uploads aren't configured on this server." });
      return;
    }
    try {
      const result = await handleUpload({
        body: req.body as HandleUploadBody,
        request: req,
        onBeforeGenerateToken: async (_pathname, clientPayload) => {
          if (!authorized(clientPayload ?? "")) throw new Error("Wrong or missing passcode.");
          return {
            allowedContentTypes: UPLOAD_CONTENT_TYPES,
            maximumSizeInBytes: MAX_UPLOAD_BYTES,
            addRandomSuffix: true,
            validUntil: Date.now() + 10 * 60 * 1000,
          };
        },
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Upload refused." });
    }
  });

  app.post("/api/generate", upload.array("files", 10), express.json({ limit: "4mb" }), async (req, res) => {
    if (!authorized(req.get("x-app-passcode"))) {
      res.status(401).json({ error: "Wrong or missing passcode." });
      return;
    }
    if (!hasCredentials()) {
      res.status(503).json({ error: "The server has no ANTHROPIC_API_KEY configured." });
      return;
    }

    const body = req.body ?? {};
    const context = String(body.context ?? "").slice(0, 4000);
    const detail: Detail = ["concise", "standard", "thorough"].includes(body.detail) ? body.detail : "standard";
    const pastedText = String(body.text ?? "");
    const blobRefs: BlobRef[] = Array.isArray(body.blobs) ? body.blobs.slice(0, 10) : [];

    let files = (req.files as UploadedFile[] | undefined) ?? [];
    try {
      if (blobRefs.length) files = files.concat(await Promise.all(blobRefs.map((b) => downloadBlob(b, BLOB_ACCESS))));
    } catch {
      res.status(400).json({ error: "Couldn't read the uploaded files. Please upload them again." });
      cleanup(blobRefs);
      return;
    }

    if (files.length === 0 && !pastedText.trim()) {
      res.status(400).json({ error: "Add at least one file or paste some text." });
      return;
    }
    const totalBytes = files.reduce((n, f) => n + f.buffer.length, 0) + pastedText.length;
    if (totalBytes > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: "Those files are over 30 MB combined. Split them into smaller batches." });
      cleanup(blobRefs);
      return;
    }

    let blocks: Anthropic.Beta.BetaContentBlockParam[];
    try {
      blocks = (await Promise.all(files.map(toContentBlocks))).flat();
    } catch (err) {
      const message = err instanceof UnsupportedFileError ? err.message : "One of the files couldn't be read.";
      res.status(400).json({ error: message });
      cleanup(blobRefs);
      return;
    }
    // The files are in memory now; don't keep copies in storage.
    cleanup(blobRefs);

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
    return normalizeGuide(JSON.parse(json) as Guide);
  }

  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === "LIMIT_FILE_SIZE"
          ? `A file is over the ${Math.round(maxUploadBytes / 1024 / 1024)} MB limit.`
          : err.message;
      res.status(400).json({ error: msg });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Server error." });
  });

  if (ON_VERCEL && !BLOB) {
    console.warn("BLOB_READ_WRITE_TOKEN is not set: uploads are limited to 4 MB. Connect a Vercel Blob store to lift it.");
  }

  return app;
}

async function downloadBlob(ref: BlobRef, access: "public" | "private"): Promise<UploadedFile> {
  const result = await getBlob(ref.url, { access });
  if (!result || !result.stream) throw new Error(`Blob not found: ${ref.url}`);
  const buffer = Buffer.from(await new Response(result.stream).arrayBuffer());
  return { originalname: String(ref.name), mimetype: String(ref.contentType || "application/octet-stream"), buffer };
}

function cleanup(refs: BlobRef[]) {
  if (!refs.length) return;
  deleteBlobs(refs.map((r) => r.url)).catch((err) => console.error("Blob cleanup failed", err));
}

function count(haystack: string, needle: string) {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
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
  const guide = sample.guide as Guide;
  const size = JSON.stringify(guide).length;
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  await wait(1200);
  send({ type: "stage", stage: "writing" });
  for (let i = 1; i <= 10 && !signal.aborted; i++) {
    await wait(300);
    send({
      type: "progress",
      chars: Math.round((size * i) / 10),
      sections: Math.round((guide.sections.length * i) / 10),
      flashcards: i > 6 ? Math.round((guide.flashcards.length * (i - 6)) / 4) : 0,
      quiz: i > 8 ? Math.round((guide.quiz.length * (i - 8)) / 2) : 0,
    });
  }
  send({ type: "stage", stage: "finishing" });
  return guide;
}

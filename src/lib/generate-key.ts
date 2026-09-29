import Anthropic from "@anthropic-ai/sdk";
import { describeError, writeGuide } from "../../shared/claude";
import type { Guide } from "../../shared/guide";
import { userInstructions, type Detail } from "../../shared/prompt";
import { pptxText } from "../../shared/pptx";
import type { GenerateProgress, GenerateRequest } from "./api";

// Static-site build: call Claude straight from the browser with the user's own
// API key, which is kept only in this browser. PDFs and images go to Claude as
// they are, so slides, tables and diagrams are read visually.

type Block = Anthropic.Beta.BetaContentBlockParam;

const IMAGE_TYPES: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "html", "htm", "rtf", "tex"]);

export const MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5", note: "Best quality · about $0.30–0.80 per guide" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "Faster, about half the price" },
] as const;

export function client(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
}

/** Cheap check that a key works (lists one model; costs nothing). */
export async function checkKey(apiKey: string): Promise<string | null> {
  try {
    await client(apiKey).models.list({ limit: 1 });
    return null;
  } catch (err) {
    return describeError(err, "your");
  }
}

async function base64(file: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return url.slice(url.indexOf(",") + 1);
}

async function toBlocks(file: File): Promise<Block[]> {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || file.type === "application/pdf") {
    return [{ type: "document", title: file.name, source: { type: "base64", media_type: "application/pdf", data: await base64(file) } }];
  }
  const image = IMAGE_TYPES[ext] ?? Object.values(IMAGE_TYPES).find((t) => t === file.type);
  if (image) {
    return [
      { type: "text", text: `Image: ${file.name}` },
      { type: "image", source: { type: "base64", media_type: image, data: await base64(file) } },
    ];
  }
  const text = (data: string): Block[] => [{ type: "document", title: file.name, source: { type: "text", media_type: "text/plain", data } }];
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    return text((await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value);
  }
  if (ext === "pptx") return text(await pptxText(await file.arrayBuffer()));
  if (TEXT_EXT.has(ext) || file.type.startsWith("text/")) return text(await file.text());
  throw new Error(`“${file.name}” isn’t a supported file type. Use PDF, Word (.docx), PowerPoint (.pptx), images, or plain text.`);
}

export function generateWithKey(
  req: GenerateRequest & { apiKey: string; model: string },
  onProgress: (p: GenerateProgress) => void,
): { promise: Promise<Guide>; cancel: () => void } {
  const abort = new AbortController();
  const state: GenerateProgress = { stage: "uploading", uploaded: 0, chars: 0, sections: 0, flashcards: 0, quiz: 0 };
  const emit = () => onProgress({ ...state });

  const promise = (async () => {
    const blocks: Block[] = [];
    for (const [i, f] of req.files.entries()) {
      blocks.push(...(await toBlocks(f)));
      state.uploaded = (i + 1) / req.files.length;
      emit();
    }
    if (req.text.trim()) {
      blocks.push({ type: "document", title: "Pasted notes", source: { type: "text", media_type: "text/plain", data: req.text } });
    }
    const names = [...req.files.map((f) => f.name), ...(req.text.trim() ? ["pasted notes"] : [])];
    state.stage = "reading";
    emit();
    try {
      return await writeGuide(client(req.apiKey), {
        model: req.model,
        effort: "medium",
        blocks,
        instructions: userInstructions(req.context, req.detail as Detail, names),
        signal: abort.signal,
        onEvent: (e) => {
          if (e.type === "stage") state.stage = e.stage;
          else Object.assign(state, { chars: e.chars, sections: e.sections, flashcards: e.flashcards, quiz: e.quiz });
          emit();
        },
      });
    } catch (err) {
      if (abort.signal.aborted) throw new Error("Cancelled.");
      throw new Error(describeError(err, "your"));
    }
  })();

  return { promise, cancel: () => abort.abort() };
}

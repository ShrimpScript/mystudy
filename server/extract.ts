import type Anthropic from "@anthropic-ai/sdk";
import JSZip from "jszip";
import mammoth from "mammoth";

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

type Block = Anthropic.Beta.BetaContentBlockParam;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const TEXT_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "html", "htm", "rtf", "tex"]);

export const ACCEPTED_EXTENSIONS = ["pdf", "docx", "pptx", "png", "jpg", "jpeg", "gif", "webp", ...TEXT_EXTENSIONS];

export class UnsupportedFileError extends Error {}

function extension(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

function textDocument(title: string, text: string): Block {
  return {
    type: "document",
    title,
    source: { type: "text", media_type: "text/plain", data: text },
  };
}

async function pptxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const slideNumber = (path: string) => Number(path.match(/(\d+)\.xml$/)?.[1] ?? 0);
  const collect = (prefix: RegExp) =>
    Object.keys(zip.files)
      .filter((p) => prefix.test(p))
      .sort((a, b) => slideNumber(a) - slideNumber(b));

  const runs = (xml: string) =>
    [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)]
      .map((p) => [...p[1].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(""))
      .filter((line) => line.trim())
      .map(decodeXml)
      .join("\n");

  const notes = new Map<number, string>();
  for (const path of collect(/^ppt\/notesSlides\/notesSlide\d+\.xml$/)) {
    notes.set(slideNumber(path), runs(await zip.file(path)!.async("string")));
  }

  const out: string[] = [];
  for (const path of collect(/^ppt\/slides\/slide\d+\.xml$/)) {
    const n = slideNumber(path);
    out.push(`--- Slide ${n} ---\n${runs(await zip.file(path)!.async("string"))}`);
    const note = notes.get(n);
    if (note) out.push(`[Speaker notes]\n${note}`);
  }
  return out.join("\n\n");
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Turn one uploaded file into content blocks Claude can read. */
export async function toContentBlocks(file: UploadedFile): Promise<Block[]> {
  const ext = extension(file.originalname);
  const name = file.originalname;

  if (ext === "pdf" || file.mimetype === "application/pdf") {
    return [
      {
        type: "document",
        title: name,
        source: { type: "base64", media_type: "application/pdf", data: file.buffer.toString("base64") },
      },
    ];
  }

  if (IMAGE_TYPES.has(file.mimetype) || ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) {
    const media = (IMAGE_TYPES.has(file.mimetype) ? file.mimetype : `image/${ext === "jpg" ? "jpeg" : ext}`) as
      | "image/png"
      | "image/jpeg"
      | "image/gif"
      | "image/webp";
    return [
      { type: "text", text: `Image: ${name}` },
      { type: "image", source: { type: "base64", media_type: media, data: file.buffer.toString("base64") } },
    ];
  }

  if (ext === "docx") {
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return [textDocument(name, value)];
  }

  if (ext === "pptx") {
    return [textDocument(name, await pptxText(file.buffer))];
  }

  if (TEXT_EXTENSIONS.has(ext) || file.mimetype.startsWith("text/")) {
    return [textDocument(name, file.buffer.toString("utf8"))];
  }

  throw new UnsupportedFileError(
    `“${name}” isn’t a supported file type. Use PDF, Word (.docx), PowerPoint (.pptx), images, or plain text.`,
  );
}

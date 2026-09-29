import type Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import { pptxText } from "../shared/pptx.js";

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

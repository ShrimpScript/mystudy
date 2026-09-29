import { pptxText } from "../../shared/pptx";

// Reads uploaded files in the browser for the claude.ai build, where the page
// has no server to send them to. Text goes into the prompt; scanned PDFs and
// photos become images when the viewer's app can send them.

export interface ExtractedMaterial {
  documents: { name: string; text: string }[];
  images: { name: string; blob: Blob }[];
}

const TEXT_EXT = new Set(["txt", "md", "markdown", "csv", "tsv", "json", "html", "htm", "rtf", "tex"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const MIN_CHARS_PER_PAGE = 60; // below this a PDF is probably scanned

export class ExtractError extends Error {}

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";

export async function extractFiles(
  files: File[],
  opts: { maxImages: number; onFile?: (done: number, total: number) => void },
): Promise<ExtractedMaterial> {
  const out: ExtractedMaterial = { documents: [], images: [] };
  for (const [i, file] of files.entries()) {
    const e = ext(file.name);
    if (e === "pdf" || file.type === "application/pdf") {
      await readPdf(file, out, opts.maxImages);
    } else if (e === "docx") {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      out.documents.push({ name: file.name, text: value });
    } else if (e === "pptx") {
      out.documents.push({ name: file.name, text: await pptxText(await file.arrayBuffer()) });
    } else if (IMAGE_EXT.has(e) || file.type.startsWith("image/")) {
      out.images.push({ name: file.name, blob: file });
    } else if (TEXT_EXT.has(e) || file.type.startsWith("text/")) {
      out.documents.push({ name: file.name, text: await file.text() });
    } else {
      throw new ExtractError(
        `“${file.name}” isn’t a supported file type. Use PDF, Word (.docx), PowerPoint (.pptx), images, or plain text.`,
      );
    }
    opts.onFile?.(i + 1, files.length);
  }
  return out;
}

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Run pdf.js on the main thread: the page's sandbox can't load a worker from a CDN,
  // and registering the worker module globally makes pdf.js skip spawning one.
  const g = globalThis as { pdfjsWorker?: unknown };
  if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  return pdfjs;
}

async function readPdf(file: File, out: ExtractedMaterial, maxImages: number) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false })
    .promise;
  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      text += item.str + (item.hasEOL ? "\n" : "");
    }
    pages.push(
      text
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join("\n"),
    );
  }

  const chars = pages.reduce((n, p) => n + p.length, 0);
  if (chars / Math.max(doc.numPages, 1) >= MIN_CHARS_PER_PAGE) {
    out.documents.push({
      name: file.name,
      text: pages.map((p, i) => `--- Page ${i + 1} ---\n${p}`).join("\n\n"),
    });
    return;
  }

  // Scanned PDF: send page images instead, as many as the viewer's app allows.
  const room = maxImages - out.images.length;
  if (room <= 0) {
    throw new ExtractError(
      `“${file.name}” looks like a scan with no selectable text, and this app can’t send page images here. Try a PDF with selectable text.`,
    );
  }
  for (let n = 1; n <= Math.min(doc.numPages, room); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(2, 1600 / base.width) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (blob) out.images.push({ name: `${file.name} p.${n}`, blob });
  }
  if (doc.numPages > room) {
    out.documents.push({
      name: file.name,
      text: `(Scanned document: only the first ${room} of ${doc.numPages} pages could be included as images.)`,
    });
  }
}

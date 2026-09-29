import type { Figure } from "../../shared/guide";

// Turns the figure references Claude returns (file, page, crop box) into
// images, using the files the student just uploaded. Runs in the browser in
// every build, so the server never has to keep the files.

const MAX_FIGURES = 24;
const TARGET_WIDTH = 1400; // px of the full page before cropping
const PAD = 0.015; // extra margin around the crop box, as a fraction of the page

type Source = { kind: "pdf"; doc: any } | { kind: "image"; bitmap: ImageBitmap };

const norm = (name: string) => name.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "");

/** Match Claude's source_file to an upload, tolerating small differences in the name. */
function findFile(files: File[], name: string): File | undefined {
  return (
    files.find((f) => f.name === name) ??
    files.find((f) => norm(f.name) === norm(name)) ??
    files.find((f) => norm(name).includes(norm(f.name)) || norm(f.name).includes(norm(name))) ??
    (files.length === 1 ? files[0] : undefined)
  );
}

async function openSource(file: File): Promise<Source | null> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const g = globalThis as { pdfjsWorker?: unknown };
    if (!g.pdfjsWorker) g.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false })
      .promise;
    return { kind: "pdf", doc };
  }
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(file.name)) {
    return { kind: "image", bitmap: await createImageBitmap(file) };
  }
  return null;
}

async function drawPage(source: Source, page: number): Promise<HTMLCanvasElement | null> {
  const canvas = document.createElement("canvas");
  if (source.kind === "image") {
    const scale = Math.min(1, TARGET_WIDTH / source.bitmap.width);
    canvas.width = Math.round(source.bitmap.width * scale);
    canvas.height = Math.round(source.bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(source.bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  }
  if (page < 1 || page > source.doc.numPages) return null;
  const p = await source.doc.getPage(page);
  const base = p.getViewport({ scale: 1 });
  const viewport = p.getViewport({ scale: TARGET_WIDTH / base.width });
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await p.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/** Crop a rendered page to the figure's box (with a little margin) and encode it. */
function cropToDataUrl(page: HTMLCanvasElement, crop: Figure["crop"]): string {
  const clamp = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
  let x0 = clamp(crop.x - PAD);
  let y0 = clamp(crop.y - PAD);
  let x1 = clamp(crop.x + crop.w + PAD);
  let y1 = clamp(crop.y + crop.h + PAD);
  // A degenerate box means Claude couldn't place it: fall back to the whole page.
  if (x1 - x0 < 0.05 || y1 - y0 < 0.03) [x0, y0, x1, y1] = [0, 0, 1, 1];
  const sx = Math.round(x0 * page.width);
  const sy = Math.round(y0 * page.height);
  const sw = Math.max(1, Math.round((x1 - x0) * page.width));
  const sh = Math.max(1, Math.round((y1 - y0) * page.height));
  const out = document.createElement("canvas");
  const scale = Math.min(1, 1100 / sw);
  out.width = Math.round(sw * scale);
  out.height = Math.round(sh * scale);
  out.getContext("2d")!.drawImage(page, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", 0.82);
}

/**
 * Render every figure it can. Figures whose file or page can't be found are
 * left out; the guide still works without them.
 */
export async function renderFigures(
  figures: Figure[] | undefined,
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const list = (figures ?? []).slice(0, MAX_FIGURES);
  if (!list.length || !files.length) return out;

  const sources = new Map<File, Promise<Source | null>>();
  const pages = new Map<string, Promise<HTMLCanvasElement | null>>();

  for (const [i, fig] of list.entries()) {
    try {
      const file = findFile(files, fig.source_file);
      if (!file) continue;
      if (!sources.has(file)) sources.set(file, openSource(file).catch(() => null));
      const source = await sources.get(file)!;
      if (!source) continue;
      const key = `${file.name}#${fig.page}`;
      if (!pages.has(key)) pages.set(key, drawPage(source, fig.page).catch(() => null));
      const page = await pages.get(key)!;
      if (page) out[fig.id] = cropToDataUrl(page, fig.crop ?? { x: 0, y: 0, w: 1, h: 1 });
    } catch {
      // Skip this figure; one bad page shouldn't lose the guide.
    }
    onProgress?.(i + 1, list.length);
  }
  return out;
}

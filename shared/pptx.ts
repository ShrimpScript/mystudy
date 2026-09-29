import JSZip from "jszip";

/** Slide text (and speaker notes) from a .pptx file, in slide order. */
export async function pptxText(data: ArrayBuffer | Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(data);
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

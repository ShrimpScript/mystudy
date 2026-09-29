import { normalizeGuide, type Guide } from "../../shared/guide";
import { DETAIL_GUIDANCE, SYSTEM_PROMPT, type Detail } from "../../shared/prompt";
import type { GenerateProgress, GenerateRequest } from "./api";
import { extractFiles, ExtractError } from "./extract-browser";
import { capability, type SampleError, type SampleFn } from "./runtime";

// claude.ai build: write the guide with the viewer's own Claude account.
// One call writes the reading guide; two more then run side by side for the
// glossary material and for flashcards + quiz. Splitting keeps every answer
// well inside the per-answer length limit.

const PROMPT_BUDGET = 240 * 1024; // the platform caps input at 256 KiB

const OUTLINE_SHAPE = `{
  "title": string,            // e.g. "Chapter 3 — Public Fire Protection"
  "course": string,           // course or subject
  "overview": string,         // 3–5 plain-language sentences
  "big_picture": string[],    // 3–6 one-sentence takeaways
  "sections": [{
    "id": string,             // short kebab-case slug, unique
    "heading": string,
    "source_ref": string,     // e.g. "Slides 8–18" or "pp. 2–4"; "" if unknown
    "simplified": string,     // 1–3 short paragraphs separated by a blank line; written to be read aloud
    "key_points": string[],   // 3–8 concise points
    "remember": string[]      // 0–4 must-memorize items for an exam
  }],
  "exam_focus": [{ "point": string, "why": string, "section_id": string }]   // the 5–10 most testable things
}`;

const FACTS_SHAPE = `{
  "key_terms": [{ "term": string, "definition": string, "section_id": string }],
  "numbers_to_know": [{ "value": string, "meaning": string, "section_id": string }],   // dates, statistics; [] if none
  "lists_to_memorize": [{ "title": string, "items": string[], "memory_aid": string, "section_id": string }],  // memory_aid "" if none helps
  "timeline": [{ "when": string, "event": string }]   // [] unless the material is historical
}`;

const PRACTICE_SHAPE = `{
  "flashcards": [{ "front": string, "back": string, "section_id": string }],
  "quiz": [{ "question": string, "choices": [string, string, string, string], "answer_index": number, "explanation": string, "section_id": string }]
}`;

export function generateLocal(
  req: GenerateRequest,
  onProgress: (p: GenerateProgress) => void,
): { promise: Promise<Guide>; cancel: () => void } {
  const controllers = new Set<AbortController>();
  let cancelled = false;
  const newSignal = () => {
    const c = new AbortController();
    controllers.add(c);
    return c.signal;
  };

  const state: GenerateProgress = { stage: "uploading", uploaded: 0, chars: 0, sections: 0, flashcards: 0, quiz: 0 };
  const emit = () => onProgress({ ...state });

  const promise = (async () => {
    const sample = await capability<SampleFn>("sample");
    if (!sample) throw new Error("Claude isn’t available in this view. Open the page on claude.ai while signed in.");
    const limits = await sample.limits().catch(() => null);
    const maxImages = limits?.images?.maxCount ?? 0;

    let material;
    try {
      material = await extractFiles(req.files, {
        maxImages,
        onFile: (done, total) => {
          state.uploaded = done / total;
          emit();
        },
      });
    } catch (err) {
      throw err instanceof ExtractError ? err : new Error("One of the files couldn’t be read. Is it damaged or password-protected?");
    }
    if (cancelled) throw new Error("Cancelled.");
    if (req.text.trim()) material.documents.push({ name: "Pasted notes", text: req.text });
    if (material.images.length > maxImages) {
      throw new Error(
        maxImages
          ? `This app can send at most ${maxImages} images at a time. Remove some photos and try again.`
          : "Photos and scanned pages can’t be sent from this app. Use a PDF with selectable text, or paste the text.",
      );
    }

    const source = material.documents
      .map((d) => `<document name="${d.name.replace(/"/g, "'")}">\n${d.text}\n</document>`)
      .join("\n\n");
    const imageNote = material.images.length
      ? `\n\nThe attached images are part of the material, in order: ${material.images.map((i) => i.name).join(", ")}.`
      : "";
    const names = [...req.files.map((f) => f.name), ...(req.text.trim() ? ["pasted notes"] : [])];
    const context = req.context.trim()
      ? `\n\nThe student added this context. Use it to decide emphasis, but don't invent content to satisfy it:\n<student_context>\n${req.context.trim()}\n</student_context>`
      : "";
    const preamble = `${SYSTEM_PROMPT}\n\nMaterial (${names.join(", ")}):\n<material>\n${source}\n</material>${imageNote}${context}\n\n${DETAIL_GUIDANCE[req.detail as Detail]}`;

    if (new TextEncoder().encode(preamble).length > PROMPT_BUDGET - 4096) {
      throw new Error("That’s more text than Claude can read in one go here. Upload about half as many pages at a time.");
    }
    const images = material.images.map((i) => i.blob);
    const imageOpts = images.length ? { images } : {};

    state.stage = "reading";
    emit();

    const outline = await ask<Partial<Guide>>(
      sample,
      `${preamble}\n\nStep 1 of 3: write the reading guide. Reply with only this JSON object:\n${OUTLINE_SHAPE}`,
      {
        ...imageOpts,
        signal: newSignal(),
        onText: ({ text }: { text: string }) => {
          state.stage = "writing";
          state.chars = text.length;
          state.sections = count(text, '"simplified"');
          emit();
        },
      },
    );
    if (!Array.isArray(outline.sections) || outline.sections.length === 0) {
      throw new Error("Claude didn’t return any sections. Please try again.");
    }

    state.stage = "finishing";
    emit();
    const sectionList = outline.sections.map((s) => `- ${s.id}: ${s.heading}`).join("\n");
    const followUp = `The guide's sections (use these exact ids for section_id):\n${sectionList}`;

    const [facts, practice] = await Promise.all([
      ask<Partial<Guide>>(
        sample,
        `${preamble}\n\n${followUp}\n\nStep 2 of 3: collect the reference material. Reply with only this JSON object:\n${FACTS_SHAPE}`,
        { ...imageOpts, signal: newSignal() },
      ),
      ask<Partial<Guide>>(
        sample,
        `${preamble}\n\n${followUp}\n\nStep 3 of 3: write active-recall practice covering every section. Reply with only this JSON object:\n${PRACTICE_SHAPE}`,
        {
          ...imageOpts,
          signal: newSignal(),
          onText: ({ text }: { text: string }) => {
            state.flashcards = count(text, '"front"');
            state.quiz = count(text, '"answer_index"');
            emit();
          },
        },
      ),
    ]);

    return normalizeGuide({
      title: str(outline.title) || names[0] || "Study guide",
      course: str(outline.course),
      overview: str(outline.overview),
      big_picture: arr(outline.big_picture),
      sections: arr(outline.sections).map((s) => ({
        ...s,
        source_ref: str(s.source_ref),
        key_points: arr(s.key_points),
        remember: arr(s.remember),
      })),
      exam_focus: arr(outline.exam_focus),
      key_terms: arr(facts.key_terms),
      numbers_to_know: arr(facts.numbers_to_know),
      lists_to_memorize: arr(facts.lists_to_memorize).map((l) => ({ ...l, items: arr(l.items), memory_aid: str(l.memory_aid) })),
      timeline: arr(facts.timeline),
      flashcards: arr(practice.flashcards).map((c) => ({ ...c, front: str(c.front), back: str(c.back) })),
      quiz: arr(practice.quiz).map((q) => ({ ...q, choices: arr(q.choices).map(String), answer_index: Number(q.answer_index) })),
    });
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      controllers.forEach((c) => c.abort());
    },
  };
}

async function ask<T>(sample: SampleFn, prompt: string, options: Record<string, unknown>): Promise<T> {
  try {
    return await sample.json<T>(prompt, options);
  } catch (err) {
    throw new Error(describe(err as SampleError));
  }
}

function describe(e: SampleError): string {
  switch (e?.code) {
    case "cancelled":
      return "Cancelled.";
    case "not_granted":
      return "Claude wasn’t allowed for this page. Reload and choose Allow when asked.";
    case "sampling_disabled":
      return "Claude isn’t available for this account.";
    case "rate_limited":
      return "You’ve hit a usage limit for now. Try again in a little while.";
    case "session_expired":
      return "Your claude.ai session expired. Sign in again, then retry.";
    case "prompt_too_large":
      return "That’s more than Claude can read in one go here. Upload fewer pages at a time.";
    case "image_rejected":
      return "One of the images couldn’t be used. Try a different photo or a PDF.";
    case "refused":
      return "Claude declined to work with this material.";
    case "invalid_json":
      return "The answer came back incomplete. Try again, or choose Concise depth.";
    default:
      return "Claude didn’t finish. Please try again.";
  }
}

function count(haystack: string, needle: string) {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

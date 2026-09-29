// The shape of a generated study guide. Shared by the server (JSON schema for
// structured output) and the client (rendering).

export interface Guide {
  title: string;
  course: string;
  overview: string;
  big_picture: string[];
  sections: Section[];
  key_terms: Term[];
  numbers_to_know: NumberFact[];
  lists_to_memorize: MemoryList[];
  timeline: TimelineEntry[];
  exam_focus: ExamPoint[];
  flashcards: Flashcard[];
  quiz: QuizQuestion[];
  /** Visuals from the source material. Optional: guides made before figures existed lack it. */
  figures?: Figure[];
}

/**
 * A picture from the uploaded material: a page (or part of one) of a PDF, or
 * an uploaded image. The app renders and crops it in the browser after
 * generation and stores the result alongside the guide.
 */
export interface Figure {
  id: string;
  /** File name as uploaded. */
  source_file: string;
  /** 1-based page within that file (1 for images). */
  page: number;
  /** Region of the page as fractions of its width and height (0–1). Whole page: 0,0,1,1. */
  crop: { x: number; y: number; w: number; h: number };
  caption: string;
  section_id: string;
  /** Search words for real-world photos of the subject, or "" when photos wouldn't help. */
  image_query: string;
}

export interface Section {
  id: string;
  heading: string;
  source_ref: string;
  simplified: string;
  key_points: string[];
  remember: string[];
}

export interface Term {
  term: string;
  definition: string;
  section_id: string;
  /** Search words for real-world photos of the term, or "" when it isn't a visual thing. */
  image_query?: string;
}

export interface NumberFact {
  value: string;
  meaning: string;
  section_id: string;
}

export interface MemoryList {
  title: string;
  items: string[];
  memory_aid: string;
  section_id: string;
}

export interface TimelineEntry {
  when: string;
  event: string;
}

export interface ExamPoint {
  point: string;
  why: string;
  section_id: string;
}

export interface Flashcard {
  front: string;
  back: string;
  section_id: string;
  /** A figure shown on the front ("What is this?"), or "". */
  figure_id?: string;
}

export interface QuizQuestion {
  question: string;
  choices: string[];
  answer_index: number;
  explanation: string;
  section_id: string;
}

/** A guide as stored on the device, with bookkeeping around it. */
export interface StoredGuide {
  id: string;
  createdAt: number;
  updatedAt: number;
  sourceFiles: string[];
  context: string;
  guide: Guide;
  sample?: boolean;
  /** Rendered figure images by figure id: data: URLs, or relative URLs for built-in guides. */
  figureImages?: Record<string, string>;
}

const str = { type: "string" } as const;
const strList = { type: "array", items: str } as const;

function obj(properties: Record<string, unknown>) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

export const guideJsonSchema = obj({
  title: { ...str, description: "Short title for the material, e.g. 'Chapter 3 — Public Fire Protection'." },
  course: { ...str, description: "Course name or subject if identifiable, else a best guess at the subject area." },
  overview: { ...str, description: "3–5 plain-language sentences: what this material is about and why it matters." },
  big_picture: { ...strList, description: "3–6 one-sentence takeaways. If a student remembers nothing else, they remember these." },
  sections: {
    type: "array",
    description: "The material reorganized into logical sections, in source order.",
    items: obj({
      id: { ...str, description: "Short kebab-case slug, unique within the guide, e.g. 'evolution-of-fire-protection'." },
      heading: str,
      source_ref: { ...str, description: "Where this came from in the source, e.g. 'Slides 8–18' or 'pp. 2–4'. Empty string if unknown." },
      simplified: { ...str, description: "A clear, plain-English explanation of the section in 1–3 short paragraphs separated by blank lines. Written to be read aloud." },
      key_points: { ...strList, description: "3–8 concise bullet points of the section's main ideas." },
      remember: { ...strList, description: "0–4 items that are must-memorize for an exam: definitions, names, dates, figures, lists. Each is one short sentence." },
    }),
  },
  key_terms: {
    type: "array",
    items: obj({
      term: str,
      definition: { ...str, description: "One or two sentences, plain language." },
      section_id: str,
      image_query: {
        ...str,
        description:
          "If the term names something physical a student should recognize on sight (equipment, a vehicle, a sign, a symbol, an organism, a landmark, an artwork), 2–6 search words for finding real photos of it, specific enough to avoid look-alikes (e.g. 'MC-331 propane tank trailer'). Otherwise \"\".",
      },
    }),
  },
  numbers_to_know: {
    type: "array",
    description: "Dates, statistics, quantities worth memorizing. Empty if the material has none.",
    items: obj({ value: { ...str, description: "The number or date as it should be memorized, e.g. '1679' or '4,000 / yr'." }, meaning: str, section_id: str }),
  },
  lists_to_memorize: {
    type: "array",
    description: "Enumerations the material presents that are likely to be tested (e.g. 'the four goals of…').",
    items: obj({
      title: str,
      items: strList,
      memory_aid: { ...str, description: "A short mnemonic or memory hook. Empty string if none is genuinely helpful." },
      section_id: str,
    }),
  },
  timeline: {
    type: "array",
    description: "Chronological events if the material is historical. Empty array otherwise.",
    items: obj({ when: str, event: str }),
  },
  exam_focus: {
    type: "array",
    description: "The 5–10 things most likely to be tested, with why.",
    items: obj({ point: str, why: str, section_id: str }),
  },
  flashcards: {
    type: "array",
    description:
      "20–40 active-recall cards covering the whole material. Fronts are questions or cues, backs are short answers. When figures show things to identify by sight, include picture cards: set figure_id and make the front a question like 'Which tank truck is this?' that the picture answers.",
    items: obj({
      front: str,
      back: str,
      section_id: str,
      figure_id: { ...str, description: "The id of a figure to show on the front, or \"\"." },
    }),
  },
  figures: {
    type: "array",
    description:
      "Visuals in the uploaded material that help a student recognize or understand something: diagrams, photos, symbols, labels, charts, labelled drawings. Up to 24. Skip decorative clip art, logos and page headers. For a figure used on a picture flashcard, crop to the picture only, leaving out any text that gives the answer; make a separate figure for each item a student must tell apart.",
    items: obj({
      id: { ...str, description: "Short kebab-case slug, unique, e.g. 'tank-truck-shapes'." },
      source_file: { ...str, description: "The file name exactly as given in the material." },
      page: { type: "integer", description: "1-based page number within that file; 1 for an image file." },
      crop: {
        ...obj({ x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" } }),
        description:
          "The figure's region as fractions of the page (x and w of its width, y and h of its height, origin top-left). Keep a small margin. Use 0,0,1,1 for a whole page or image.",
      },
      caption: { ...str, description: "What the figure shows and what to notice, in one or two sentences." },
      section_id: str,
      image_query: {
        ...str,
        description: "Search words for real-world photos of what the figure depicts, if seeing the real thing would help; otherwise \"\".",
      },
    }),
  },
  quiz: {
    type: "array",
    description: "10–15 multiple-choice questions with exactly 4 choices each.",
    items: obj({
      question: str,
      choices: strList,
      answer_index: { type: "integer", description: "0-based index of the correct choice." },
      explanation: { ...str, description: "Why the answer is right, in one or two sentences." },
      section_id: str,
    }),
  },
});

/** Defensive cleanup so the UI never has to guess. */
export function normalizeGuide(g: Guide): Guide {
  const ids = new Set(g.sections.map((s) => s.id));
  const fallbackId = g.sections[0]?.id ?? "";
  const fixId = <T extends { section_id: string }>(x: T) => (ids.has(x.section_id) ? x : { ...x, section_id: fallbackId });
  const figures = (g.figures ?? []).filter((f) => f.id && f.page >= 1).map(fixId);
  const figureIds = new Set(figures.map((f) => f.id));
  return {
    ...g,
    key_terms: g.key_terms.map(fixId),
    numbers_to_know: g.numbers_to_know.map(fixId),
    lists_to_memorize: g.lists_to_memorize.map(fixId),
    exam_focus: g.exam_focus.map(fixId),
    figures,
    flashcards: g.flashcards
      .filter((c) => c.front.trim() && c.back.trim())
      .map((c) => fixId({ ...c, figure_id: c.figure_id && figureIds.has(c.figure_id) ? c.figure_id : "" })),
    quiz: g.quiz
      .filter((q) => q.choices.length >= 2 && q.answer_index >= 0 && q.answer_index < q.choices.length)
      .map(fixId),
  };
}

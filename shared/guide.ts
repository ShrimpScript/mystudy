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
    items: obj({ term: str, definition: { ...str, description: "One or two sentences, plain language." }, section_id: str }),
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
    description: "20–40 active-recall cards covering the whole material. Fronts are questions or cues, backs are short answers.",
    items: obj({ front: str, back: str, section_id: str }),
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

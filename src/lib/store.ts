import { createStore, del, get, keys, set } from "idb-keyval";
import type { Guide, StoredGuide } from "../../shared/guide";

// Everything lives on the device (IndexedDB). Nothing about a guide is kept on the server.
const guides = createStore("margin", "guides");
const progress = createStore("margin-progress", "progress");

export async function listGuides(): Promise<StoredGuide[]> {
  const ids = (await keys(guides)) as string[];
  const all = await Promise.all(ids.map((id) => get<StoredGuide>(id, guides)));
  return all.filter((g): g is StoredGuide => Boolean(g)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getGuide = (id: string) => get<StoredGuide>(id, guides);

export async function saveGuide(guide: Guide, sourceFiles: string[], context: string): Promise<StoredGuide> {
  const now = Date.now();
  const stored: StoredGuide = {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    updatedAt: now,
    sourceFiles,
    context,
    guide,
  };
  await set(stored.id, stored, guides);
  return stored;
}

export async function deleteGuide(id: string) {
  await del(id, guides);
  await del(id, progress);
}

// ---- Study progress ----------------------------------------------------------

export interface Progress {
  /** Leitner box per card key (0 = new or last missed, 1+ = answered right; higher = more solid). */
  cards: Record<string, number>;
  quizBest?: number;
  quizLast?: { score: number; total: number; at: number };
  lastSection?: string;
}

export async function getProgress(id: string): Promise<Progress> {
  return (await get<Progress>(id, progress)) ?? { cards: {} };
}

export async function updateProgress(id: string, fn: (p: Progress) => Progress) {
  const next = fn(await getProgress(id));
  await set(id, next, progress);
  return next;
}

// ---- Sample ------------------------------------------------------------------

const SAMPLE_FLAG = "margin:sample-seeded";

/** On first run, add the bundled Chapter 3 guide so there's something to explore. */
export async function seedSample() {
  try {
    if (localStorage.getItem(SAMPLE_FLAG)) return;
  } catch {
    /* storage unavailable; seed anyway */
  }
  const res = await fetch("/samples/public-fire-protection.json");
  if (!res.ok) return;
  const data = (await res.json()) as Pick<StoredGuide, "id" | "sourceFiles" | "context" | "guide">;
  const now = Date.now();
  await set(data.id, { ...data, createdAt: now, updatedAt: now, sample: true } satisfies StoredGuide, guides);
  try {
    localStorage.setItem(SAMPLE_FLAG, "1");
  } catch {
    /* ignore */
  }
}

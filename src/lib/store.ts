import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";
import type { Guide, StoredGuide } from "../../shared/guide";
import hazmatFile from "../../public/samples/hazmat-recognition.json";
import fireFile from "../../public/samples/public-fire-protection.json";
import { capability, IS_ARTIFACT, type CollectionRef, type Db } from "./runtime";

// Guides and study progress. On claude.ai they live in the viewer's private
// `data/users/<id>/` area of the artifact's store, so they follow the person
// across devices. Elsewhere (or if that store is unavailable) they live in this
// browser's IndexedDB, and failing that, in memory for the visit.

export interface Progress {
  /** Leitner box per card key (0 = new or last missed, 1+ = answered right; higher = more solid). */
  cards: Record<string, number>;
  quizBest?: number;
  quizLast?: { score: number; total: number; at: number };
  lastSection?: string;
}

interface Backend {
  list(): Promise<StoredGuide[]>;
  get(id: string): Promise<StoredGuide | undefined>;
  put(g: StoredGuide): Promise<void>;
  remove(id: string): Promise<void>;
  getProgress(id: string): Promise<Progress | undefined>;
  putProgress(id: string, p: Progress): Promise<void>;
}

type SampleFile = Pick<StoredGuide, "id" | "sourceFiles" | "context" | "guide">;
const sample = (file: SampleFile, day: number): StoredGuide => ({
  ...file,
  createdAt: Date.UTC(2026, 8, day),
  updatedAt: Date.UTC(2026, 8, day),
  sample: true,
});

/** Guides bundled with the app: always available, never stored, not deletable. Newest first. */
export const SAMPLES: StoredGuide[] = [sample(hazmatFile as SampleFile, 29), sample(fireFile as SampleFile, 28)];
const sampleIds = new Set(SAMPLES.map((g) => g.id));

function memoryBackend(): Backend {
  const guides = new Map<string, StoredGuide>();
  const progress = new Map<string, Progress>();
  return {
    list: async () => [...guides.values()],
    get: async (id) => guides.get(id),
    put: async (g) => void guides.set(g.id, g),
    remove: async (id) => void (guides.delete(id), progress.delete(id)),
    getProgress: async (id) => progress.get(id),
    putProgress: async (id, p) => void progress.set(id, p),
  };
}

async function idbBackend(): Promise<Backend> {
  let guides: UseStore, progress: UseStore;
  try {
    guides = createStore("margin", "guides");
    progress = createStore("margin-progress", "progress");
    await keys(guides); // throws when storage is blocked
  } catch {
    return memoryBackend();
  }
  return {
    list: async () => {
      const ids = (await keys(guides)) as string[];
      const all = await Promise.all(ids.map((id) => get<StoredGuide>(id, guides)));
      return all.filter((g): g is StoredGuide => Boolean(g));
    },
    get: (id) => get<StoredGuide>(id, guides),
    put: (g) => set(g.id, g, guides),
    remove: async (id) => {
      await del(id, guides);
      await del(id, progress);
    },
    getProgress: (id) => get<Progress>(id, progress),
    putProgress: (id, p) => set(id, p, progress),
  };
}

async function claudeBackend(): Promise<Backend | null> {
  const [db, user] = await Promise.all([capability<Db>("db"), capability<{ id(): Promise<string | null> }>("user")]);
  const uid = await user?.id().catch(() => null);
  if (!db || !uid) return null;
  const base = db.doc(`data/users/${uid}/profile`);
  const guides: CollectionRef = base.collection("guides");
  const progress: CollectionRef = base.collection("progress");
  return {
    list: async () => (await guides.get()).docs.map((d) => d.data() as unknown as StoredGuide),
    get: async (id) => {
      const snap = await guides.doc(id).get();
      return snap.exists ? (snap.data() as unknown as StoredGuide) : undefined;
    },
    put: (g) => guides.doc(g.id).set(g as unknown as Record<string, unknown>),
    remove: async (id) => {
      await guides.doc(id).delete();
      await progress.doc(id).delete();
    },
    getProgress: async (id) => {
      const snap = await progress.doc(id).get();
      return snap.exists ? (snap.data() as unknown as Progress) : undefined;
    },
    putProgress: (id, p) => progress.doc(id).set(p as unknown as Record<string, unknown>),
  };
}

let backend: Promise<Backend> | null = null;
function store(): Promise<Backend> {
  backend ??= (async () => (IS_ARTIFACT && (await claudeBackend())) || idbBackend())();
  return backend;
}

// ---- Guides ------------------------------------------------------------------

export async function listGuides(): Promise<StoredGuide[]> {
  const stored = (await (await store()).list()).filter((g) => !sampleIds.has(g.id));
  return [...stored.sort((a, b) => b.updatedAt - a.updatedAt), ...SAMPLES];
}

export async function getGuide(id: string): Promise<StoredGuide | undefined> {
  const builtIn = SAMPLES.find((g) => g.id === id);
  if (builtIn) return builtIn;
  return (await store()).get(id);
}

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
  await (await store()).put(stored);
  return stored;
}

export async function deleteGuide(id: string) {
  if (sampleIds.has(id)) return;
  await (await store()).remove(id);
}

// ---- Study progress ----------------------------------------------------------

export async function getProgress(id: string): Promise<Progress> {
  return (await (await store()).getProgress(id)) ?? { cards: {} };
}

export async function updateProgress(id: string, fn: (p: Progress) => Progress) {
  const next = fn(await getProgress(id));
  await (await store()).putProgress(id, next);
  return next;
}

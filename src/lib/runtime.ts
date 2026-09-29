// Where the app is running. Published on claude.ai, the page gets `window.claude`
// and does everything in the browser: Claude is reached through the viewer's own
// account (the `sample` capability) and guides are stored with `db`. Anywhere else
// it talks to the Node server in /server.

interface ClaudeRuntime {
  use(name: string): Promise<any>;
}

const claude = (globalThis as { claude?: ClaudeRuntime }).claude;

export const IS_ARTIFACT = typeof claude?.use === "function";

const cache = new Map<string, Promise<any>>();

/** Resolve a claude.ai capability namespace, or null when unavailable. Never throws. */
export function capability<T = any>(name: string): Promise<T | null> {
  if (!claude) return Promise.resolve(null);
  if (!cache.has(name)) cache.set(name, claude.use(name).catch(() => null));
  return cache.get(name)!;
}

// The subset of the claude.ai runtime this app uses.

export interface SampleError {
  code: string;
  message: string;
  text?: string;
}

export interface SampleFn {
  (input: string, options?: Record<string, unknown>): Promise<{ text: string; truncated: boolean }>;
  json<T = unknown>(input: string, options?: Record<string, unknown>): Promise<T>;
  limits(): Promise<{ maxPromptBytes: number; images?: { maxCount: number; maxInputBytes: number; mediaTypes: string[] } }>;
}

export interface DocSnap {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface DocRef {
  get(): Promise<DocSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  collection(path: string): CollectionRef;
}

export interface CollectionRef {
  doc(id: string): DocRef;
  get(): Promise<{ docs: DocSnap[] }>;
}

export interface Db {
  doc(path: string): DocRef;
}

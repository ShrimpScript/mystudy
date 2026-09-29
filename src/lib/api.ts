import type { Guide } from "../../shared/guide";
import { generateLocal } from "./generate-local";
import { capability, IS_ARTIFACT } from "./runtime";

export interface Status {
  /** "claude": runs on claude.ai with the viewer's account; "server": the Node server. */
  kind: "claude" | "server";
  ready: boolean;
  passcodeRequired: boolean;
  model: string;
  mock: boolean;
  /** "blob": files go straight from the browser to Vercel Blob; "direct": multipart to the server. */
  uploadMode: "blob" | "direct";
  blobAccess: "public" | "private";
  maxUploadBytes: number;
}

export async function getStatus(): Promise<Status | null> {
  if (IS_ARTIFACT) {
    const sample = await capability("sample");
    return {
      kind: "claude",
      ready: Boolean(sample),
      passcodeRequired: false,
      model: "claude",
      mock: false,
      uploadMode: "direct",
      blobAccess: "private",
      maxUploadBytes: 50 * 1024 * 1024,
    };
  }
  try {
    const res = await fetch("/api/status");
    return res.ok ? { kind: "server", ...(await res.json()) } : null;
  } catch {
    return null;
  }
}

export type Stage = "uploading" | "reading" | "writing" | "finishing";

export interface GenerateProgress {
  stage: Stage;
  uploaded: number; // 0..1
  chars: number;
  sections: number;
  flashcards: number;
  quiz: number;
}

export interface GenerateRequest {
  files: File[];
  text: string;
  context: string;
  detail: "concise" | "standard" | "thorough";
  passcode: string;
  uploadMode: Status["uploadMode"];
  blobAccess: Status["blobAccess"];
}

/**
 * Upload material and stream generation progress. Uses XHR rather than fetch
 * because it reports upload progress and exposes the streamed body as it arrives.
 * In "blob" mode files are first uploaded directly to Vercel Blob (serverless
 * functions can't accept large request bodies) and the server fetches them.
 */
export function generateGuide(
  req: GenerateRequest,
  onProgress: (p: GenerateProgress) => void,
): { promise: Promise<Guide>; cancel: () => void } {
  if (IS_ARTIFACT) return generateLocal(req, onProgress);
  const xhr = new XMLHttpRequest();
  const uploads = new AbortController();
  let cancelled = false;

  const state: GenerateProgress = { stage: "uploading", uploaded: 0, chars: 0, sections: 0, flashcards: 0, quiz: 0 };
  const emit = () => onProgress({ ...state });

  const promise = (async () => {
    let body: FormData | string;
    if (req.uploadMode === "blob" && req.files.length) {
      const blobs = await uploadToBlob(req, uploads.signal, (fraction) => {
        state.uploaded = fraction;
        emit();
      });
      if (cancelled) throw new Error("Cancelled.");
      body = JSON.stringify({ blobs, text: req.text, context: req.context, detail: req.detail });
    } else {
      const form = new FormData();
      req.files.forEach((f) => form.append("files", f, f.name));
      form.append("text", req.text);
      form.append("context", req.context);
      form.append("detail", req.detail);
      body = form;
    }
    return stream(xhr, body, req.passcode, state, emit);
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      uploads.abort();
      xhr.abort();
    },
  };
}

async function uploadToBlob(
  req: GenerateRequest,
  signal: AbortSignal,
  onFraction: (f: number) => void,
): Promise<{ url: string; name: string; contentType: string }[]> {
  const { upload } = await import("@vercel/blob/client");
  const total = req.files.reduce((n, f) => n + f.size, 0) || 1;
  const loaded = new Array(req.files.length).fill(0);
  try {
    return await Promise.all(
      req.files.map(async (file, i) => {
        const blob = await upload(`uploads/${file.name}`, file, {
          access: req.blobAccess,
          handleUploadUrl: "/api/upload",
          clientPayload: req.passcode,
          contentType: file.type || "application/octet-stream",
          multipart: file.size > 5 * 1024 * 1024,
          abortSignal: signal,
          onUploadProgress: (e) => {
            loaded[i] = e.loaded;
            onFraction(loaded.reduce((a, b) => a + b, 0) / total);
          },
        });
        return { url: blob.url, name: file.name, contentType: file.type || "application/octet-stream" };
      }),
    );
  } catch (err) {
    if (signal.aborted) throw new Error("Cancelled.");
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(/passcode/i.test(msg) ? "Wrong or missing passcode." : `Upload failed: ${msg}`);
  }
}

function stream(
  xhr: XMLHttpRequest,
  body: FormData | string,
  passcode: string,
  state: GenerateProgress,
  emit: () => void,
): Promise<Guide> {
  return new Promise<Guide>((resolve, reject) => {
    let consumed = 0;
    let settled = false;
    const fail = (msg: string) => {
      if (!settled) {
        settled = true;
        reject(new Error(msg));
      }
    };

    const consume = () => {
      const text = xhr.responseText;
      let nl: number;
      while ((nl = text.indexOf("\n", consumed)) !== -1) {
        const line = text.slice(consumed, nl);
        consumed = nl + 1;
        if (!line.trim()) continue;
        let event: any;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.type === "stage") state.stage = event.stage;
        else if (event.type === "progress") Object.assign(state, event, { type: undefined });
        else if (event.type === "done") {
          settled = true;
          resolve(event.guide as Guide);
          return;
        } else if (event.type === "error") return fail(event.message);
        emit();
      }
    };

    xhr.open("POST", "/api/generate");
    if (passcode) xhr.setRequestHeader("x-app-passcode", passcode);
    if (typeof body === "string") xhr.setRequestHeader("Content-Type", "application/json");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof body !== "string") {
        state.uploaded = e.loaded / e.total;
        emit();
      }
    };
    xhr.upload.onload = () => {
      state.uploaded = 1;
      state.stage = "reading";
      emit();
    };
    xhr.onprogress = () => {
      if (xhr.status === 200) consume();
    };
    xhr.onload = () => {
      if (xhr.status !== 200) {
        let msg = `Request failed (${xhr.status}).`;
        if (xhr.status === 413) msg = "Those files are too large for this server to accept.";
        if (xhr.status === 504) msg = "The server timed out writing the guide. Try Concise depth or fewer pages.";
        try {
          msg = JSON.parse(xhr.responseText).error ?? msg;
        } catch {
          /* not JSON */
        }
        return fail(msg);
      }
      consume();
      fail("The connection closed before the guide finished. On Vercel's free plan this usually means the 5-minute limit was hit — try Concise depth or fewer pages.");
    };
    xhr.onerror = () => fail("Network error. Check your connection and try again.");
    xhr.onabort = () => fail("Cancelled.");
    xhr.send(body);
  });
}

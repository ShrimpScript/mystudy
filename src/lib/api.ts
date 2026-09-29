import type { Guide } from "../../shared/guide";

export interface Status {
  ready: boolean;
  passcodeRequired: boolean;
  model: string;
  mock: boolean;
}

export async function getStatus(): Promise<Status | null> {
  try {
    const res = await fetch("/api/status");
    return res.ok ? await res.json() : null;
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
}

/**
 * Upload material and stream generation progress. Uses XHR rather than fetch
 * because it reports upload progress and exposes the streamed body as it arrives.
 */
export function generateGuide(
  req: GenerateRequest,
  onProgress: (p: GenerateProgress) => void,
): { promise: Promise<Guide>; cancel: () => void } {
  const xhr = new XMLHttpRequest();
  const form = new FormData();
  req.files.forEach((f) => form.append("files", f, f.name));
  form.append("text", req.text);
  form.append("context", req.context);
  form.append("detail", req.detail);

  const state: GenerateProgress = { stage: "uploading", uploaded: 0, chars: 0, sections: 0, flashcards: 0, quiz: 0 };
  const emit = () => onProgress({ ...state });

  const promise = new Promise<Guide>((resolve, reject) => {
    let consumed = 0;
    let settled = false;
    const fail = (msg: string) => {
      if (!settled) {
        settled = true;
        reject(new Error(msg));
      }
    };

    const consume = () => {
      const body = xhr.responseText;
      let nl: number;
      while ((nl = body.indexOf("\n", consumed)) !== -1) {
        const line = body.slice(consumed, nl);
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
    if (req.passcode) xhr.setRequestHeader("x-app-passcode", req.passcode);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
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
        try {
          msg = JSON.parse(xhr.responseText).error ?? msg;
        } catch {
          /* not JSON */
        }
        return fail(msg);
      }
      consume();
      fail("The connection closed before the guide finished. Please try again.");
    };
    xhr.onerror = () => fail("Network error. Check your connection and try again.");
    xhr.onabort = () => fail("Cancelled.");
    xhr.send(form);
  });

  return { promise, cancel: () => xhr.abort() };
}

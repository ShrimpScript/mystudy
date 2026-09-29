import { useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Popover";
import { generateGuide, getStatus, type GenerateProgress, type Status } from "../lib/api";
import { usePrefs } from "../lib/prefs";
import { navigate } from "../lib/router";
import { saveGuide } from "../lib/store";

const ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.csv,.rtf,.html,.png,.jpg,.jpeg,.webp,.gif";
const MAX_BYTES = 30 * 1024 * 1024;

type Detail = "concise" | "standard" | "thorough";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function NewGuide() {
  const [status, setStatus] = useState<Status | null | undefined>(undefined);
  const [prefs, setPrefs] = usePrefs();
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [context, setContext] = useState("");
  const [detail, setDetail] = useState<Detail>("standard");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<GenerateProgress | null>(null);
  const [started, setStarted] = useState(0);
  const cancelRef = useRef<() => void>(() => {});
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getStatus().then(setStatus);
  }, []);

  const total = files.reduce((n, f) => n + f.size, 0);
  const tooBig = total > MAX_BYTES;
  const canSubmit = (files.length > 0 || text.trim().length > 0) && !tooBig && !progress;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const incoming = [...list].filter((f) => !files.some((x) => x.name === f.name && x.size === f.size));
    setFiles((prev) => [...prev, ...incoming].slice(0, 10));
    setError("");
  };

  const submit = async () => {
    setError("");
    setStarted(Date.now());
    setProgress({ stage: "uploading", uploaded: 0, chars: 0, sections: 0, flashcards: 0, quiz: 0 });
    const job = generateGuide({ files, text, context, detail, passcode: prefs.passcode }, setProgress);
    cancelRef.current = job.cancel;
    try {
      const guide = await job.promise;
      const names = [...files.map((f) => f.name), ...(text.trim() ? ["Pasted notes"] : [])];
      const stored = await saveGuide(guide, names, context);
      navigate({ name: "guide", id: stored.id, tab: "guide" });
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (progress) return <Working progress={progress} started={started} fileCount={files.length} onCancel={() => cancelRef.current()} />;

  const unavailable = status === null || (status && !status.ready);

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <p className="label">New study guide</p>
        <h1 className="display">What are you studying?</h1>
      </div>

      {unavailable && (
        <div className="notice">
          {status === null
            ? "Can’t reach the server. Start it with npm run dev, or check your deployment."
            : "The server doesn’t have an Anthropic API key yet. Add ANTHROPIC_API_KEY to its environment and restart it. You can still explore the sample guide."}
        </div>
      )}

      <section className="form-block">
        <h2 className="form-title">
          <span className="step mono">1</span> Material
        </h2>
        <div
          className={`dropzone ${dragging ? "is-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
        >
          <Icon name="upload" size={22} />
          <p>
            <button type="button" className="link" onClick={() => inputRef.current?.click()}>
              Choose files
            </button>{" "}
            <span className="only-wide">or drop them here</span>
          </p>
          <p className="hint">PDF, Word, PowerPoint, images of notes, or text · up to 10 files, 30 MB total</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPT}
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {files.length > 0 && (
          <ul className="filelist">
            {files.map((f, i) => (
              <li key={f.name + f.size}>
                <Icon name="file" size={16} />
                <span className="filelist-name">{f.name}</span>
                <span className="mono dim">{formatBytes(f.size)}</span>
                <button
                  className="btn-icon"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            ))}
            {tooBig && <li className="error-inline">That’s {formatBytes(total)}. The limit is 30 MB per guide.</li>}
          </ul>
        )}

        {showPaste ? (
          <label className="field">
            <span className="field-label">Pasted notes</span>
            <textarea
              className="textarea"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste lecture notes, a transcript, or a study sheet…"
            />
          </label>
        ) : (
          <button type="button" className="link small" onClick={() => setShowPaste(true)}>
            Paste text instead
          </button>
        )}
      </section>

      <section className="form-block">
        <h2 className="form-title">
          <span className="step mono">2</span> Context <span className="optional">optional</span>
        </h2>
        <textarea
          className="textarea"
          rows={4}
          value={context}
          onChange={(e) => setContext(e.target.value.slice(0, 4000))}
          placeholder={"Anything that helps decide what matters. For example:\n“Midterm is multiple choice, covers chapters 1–3.”\n“The professor said to know all the dates and NFPA standards.”"}
        />
      </section>

      <section className="form-block">
        <h2 className="form-title">
          <span className="step mono">3</span> Depth
        </h2>
        <Segmented<Detail>
          name="Depth"
          value={detail}
          onChange={setDetail}
          options={[
            { value: "concise", label: "Concise" },
            { value: "standard", label: "Standard" },
            { value: "thorough", label: "Thorough" },
          ]}
        />
        <p className="hint">
          {detail === "concise" && "The essentials. About 20 flashcards and 10 quiz questions."}
          {detail === "standard" && "Follows the material’s structure. About 30 flashcards and 12 questions."}
          {detail === "thorough" && "Keeps every testable detail. Up to 40 flashcards and 15 questions."}
        </p>
      </section>

      {status?.passcodeRequired && (
        <section className="form-block">
          <label className="field">
            <span className="field-label">Passcode</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={prefs.passcode}
              onChange={(e) => setPrefs({ passcode: e.target.value })}
            />
          </label>
        </section>
      )}

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}

      <div className="form-actions">
        <button className="btn btn-primary" disabled={!canSubmit || Boolean(unavailable)} onClick={submit}>
          Create study guide
        </button>
        <span className="hint">Usually takes one to three minutes.</span>
      </div>
    </div>
  );
}

function Working({
  progress,
  started,
  fileCount,
  onCancel,
}: {
  progress: GenerateProgress;
  started: number;
  fileCount: number;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.floor((now - started) / 1000);
  const elapsed = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const order = ["uploading", "reading", "writing", "finishing"] as const;
  const at = order.indexOf(progress.stage);
  const state = (i: number) => (i < at ? "done" : i === at ? "active" : "todo");

  const steps = [
    {
      title: "Uploading",
      detail: progress.stage === "uploading" ? `${Math.round(progress.uploaded * 100)}%` : `${fileCount || 1} item${fileCount === 1 ? "" : "s"}`,
    },
    { title: "Reading the material", detail: at === 1 ? "Working out what matters" : "" },
    {
      title: "Writing the guide",
      detail:
        at >= 2
          ? `${progress.sections} sections · ${progress.flashcards} cards · ${progress.quiz} questions`
          : "",
    },
    { title: "Finishing up", detail: "" },
  ];

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <p className="label">Working · {elapsed}</p>
        <h1 className="display">Writing your study guide</h1>
        <p className="lede">Keep this tab open. Long chapters can take a few minutes.</p>
      </div>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.title} className={`step-row is-${state(i)}`}>
            <span className="step-mark" aria-hidden>
              {state(i) === "done" ? <Icon name="check" size={14} /> : <span className="step-dot" />}
            </span>
            <span className="step-title">{s.title}</span>
            <span className="step-detail mono">{s.detail}</span>
          </li>
        ))}
      </ol>
      <button className="btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

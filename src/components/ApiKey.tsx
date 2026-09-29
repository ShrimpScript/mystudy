import { useState } from "react";
import { checkKey, MODELS } from "../lib/generate-key";
import { usePrefs } from "../lib/prefs";
import { Segmented } from "./Popover";

/** Static build: where the user pastes their Anthropic API key once. */
export function ApiKey() {
  const [prefs, setPrefs] = usePrefs();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(!prefs.apiKey);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const key = draft.trim();
    if (!key.startsWith("sk-ant-")) {
      setError("That doesn’t look like an Anthropic API key. Keys start with sk-ant-.");
      return;
    }
    setChecking(true);
    setError("");
    const problem = await checkKey(key);
    setChecking(false);
    if (problem) {
      setError(problem);
      return;
    }
    setPrefs({ apiKey: key });
    setDraft("");
    setEditing(false);
  };

  const model = MODELS.find((m) => m.id === prefs.model) ?? MODELS[0];

  return (
    <section className="form-block">
      <h2 className="form-title">
        Your Claude API key
      </h2>
      {editing ? (
        <>
          <p className="form-note">
            Guides are written by Claude using your own Anthropic API key. Create one at{" "}
            <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
              console.anthropic.com
            </a>{" "}
            (add a few dollars of credit under Billing), then paste it here. It’s saved only in this browser and sent only
            to Anthropic.
          </p>
          <div className="key-row">
            <input
              id="api-key"
              className="input mono"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-ant-…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              aria-label="Anthropic API key"
            />
            <button className="btn btn-primary" onClick={save} disabled={!draft.trim() || checking}>
              {checking ? "Checking…" : "Save key"}
            </button>
            {prefs.apiKey && (
              <button className="btn btn-quiet" onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          {error && <p className="error-inline">{error}</p>}
        </>
      ) : (
        <div className="key-saved">
          <span className="mono">sk-ant-…{prefs.apiKey.slice(-4)}</span>
          <span className="hint">Saved on this device</span>
          <button className="link small" onClick={() => setEditing(true)}>
            Change
          </button>
          <button
            className="link small"
            onClick={() => {
              setPrefs({ apiKey: "" });
              setEditing(true);
            }}
          >
            Remove
          </button>
        </div>
      )}
      <div className="field-label model-label">Model</div>
      <Segmented
        name="Model"
        value={model.id}
        onChange={(id) => setPrefs({ model: id })}
        options={MODELS.map((m) => ({ value: m.id, label: m.label }))}
      />
      <p className="hint">{model.note}</p>
    </section>
  );
}

import { useEffect } from "react";
import { narrator, useNarrator } from "../lib/narrator";
import { Icon } from "./Icon";
import { Popover } from "./Popover";

const RATES = [0.8, 1, 1.2, 1.4, 1.7, 2];

export function NarratorBar({ visible }: { visible: boolean }) {
  const s = useNarrator();

  // "K" toggles playback (Space is taken by page scroll and flashcards).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "k" || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      e.preventDefault();
      narrator.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // On flashcards and quiz the bar only stays while something is being read.
  if (!s.supported || s.segments.length === 0 || (!visible && !s.playing)) return null;

  const current = s.segments[s.index];
  const pct = s.segments.length > 1 ? (s.index / (s.segments.length - 1)) * 100 : 0;
  const nextRate = RATES[(RATES.indexOf(s.rate) + 1) % RATES.length] ?? 1;

  return (
    <div className={`narrator ${s.playing ? "is-playing" : ""}`} role="region" aria-label="Narrator">
      <div className="narrator-progress" style={{ width: `${pct}%` }} />
      <div className="narrator-inner">
        <div className="narrator-controls">
          <button className="btn-icon" onClick={() => narrator.skip(-1)} aria-label="Previous paragraph">
            <Icon name="prev" />
          </button>
          <button
            className="btn-icon btn-play"
            onClick={() => narrator.toggle()}
            aria-label={s.playing ? "Pause narrator" : "Play narrator"}
          >
            <Icon name={s.playing ? "pause" : "play"} size={20} />
          </button>
          <button className="btn-icon" onClick={() => narrator.skip(1)} aria-label="Next paragraph">
            <Icon name="next" />
          </button>
        </div>
        <div className="narrator-now">
          <span className="label">{s.playing ? "Reading" : s.index > 0 ? "Paused" : "Listen"}</span>
          <span className="narrator-title">{current?.section ?? s.title}</span>
        </div>
        <button className="btn-text mono" onClick={() => narrator.setRate(nextRate)} aria-label="Reading speed">
          {s.rate.toFixed(1)}×
        </button>
        <Popover label="Voice" button={<Icon name="speaker" />} placement="above">
          <div className="field-label">Voice</div>
          <select
            className="select"
            value={s.voiceURI || s.voices[0]?.voiceURI || ""}
            onChange={(e) => narrator.setVoice(e.target.value)}
          >
            {s.voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} · {v.lang}
              </option>
            ))}
          </select>
          <p className="hint">Voices come from your device. On iPhone, add better ones in Settings › Accessibility › Spoken Content.</p>
          <p className="hint">
            <kbd>K</kbd> play / pause
          </p>
        </Popover>
      </div>
    </div>
  );
}

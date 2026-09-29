import { useEffect, useMemo, useRef, useState } from "react";
import type { StoredGuide } from "../../shared/guide";
import { Icon } from "../components/Icon";
import { Segmented } from "../components/Popover";
import { narrator } from "../lib/narrator";
import { getProgress, updateProgress, type Progress } from "../lib/store";

interface Card {
  key: string;
  front: string;
  back: string;
  section_id: string;
}

type Scope = "all" | "review" | "section";
const REQUEUE_GAP = 3; // a missed card comes back after this many others

export function Flashcards({ stored, sectionFilter }: { stored: StoredGuide; sectionFilter?: string }) {
  const g = stored.guide;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [includeTerms, setIncludeTerms] = useState(false);
  const [scope, setScope] = useState<Scope>(sectionFilter ? "section" : "all");
  const [section, setSection] = useState(sectionFilter ?? g.sections[0]?.id ?? "");
  const [session, setSession] = useState(0); // bump to restart

  useEffect(() => {
    getProgress(stored.id).then(setProgress);
  }, [stored.id]);

  const allCards = useMemo<Card[]>(() => {
    const cards = g.flashcards.map((c, i) => ({ ...c, key: `c${i}` }));
    if (includeTerms)
      g.key_terms.forEach((t, i) => cards.push({ key: `t${i}`, front: t.term, back: t.definition, section_id: t.section_id }));
    return cards;
  }, [g, includeTerms]);

  const deck = useMemo(() => {
    if (!progress) return [];
    let cards = allCards;
    if (scope === "section") cards = cards.filter((c) => c.section_id === section);
    if (scope === "review") cards = cards.filter((c) => (progress.cards[c.key] ?? 0) < 1);
    // Weakest first, stable within a box.
    return [...cards].sort((a, b) => (progress.cards[a.key] ?? 0) - (progress.cards[b.key] ?? 0));
    // Progress is read once per session so grading doesn't reshuffle the deck mid-run.
  }, [allCards, scope, section, session, progress === null]);

  const known = progress ? allCards.filter((c) => (progress.cards[c.key] ?? 0) >= 1).length : 0;

  return (
    <div className="page page-narrow cards-page">
      <div className="deck-controls">
        <Segmented<Scope>
          name="Which cards"
          value={scope}
          onChange={(v) => {
            setScope(v);
            setSession((s) => s + 1);
          }}
          options={[
            { value: "all", label: "All" },
            { value: "review", label: "Needs review" },
            { value: "section", label: "One section" },
          ]}
        />
        {scope === "section" && (
          <select
            className="select"
            value={section}
            onChange={(e) => {
              setSection(e.target.value);
              setSession((s) => s + 1);
            }}
            aria-label="Section"
          >
            {g.sections.map((s, i) => (
              <option key={s.id} value={s.id}>
                §{String(i + 1).padStart(2, "0")} {s.heading}
              </option>
            ))}
          </select>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={includeTerms}
            onChange={(e) => {
              setIncludeTerms(e.target.checked);
              setSession((s) => s + 1);
            }}
          />
          Include key terms ({g.key_terms.length})
        </label>
        <p className="hint mono">
          {known}/{allCards.length} known
        </p>
      </div>

      {progress &&
        (deck.length === 0 ? (
          <p className="empty">
            {scope === "review" ? "Nothing needs review. Every card in this deck is marked as known." : "No cards here."}
          </p>
        ) : (
          <Session
            key={`${session}-${deck.length}`}
            deck={deck}
            onGrade={async (key, good) => {
              const next = await updateProgress(stored.id, (p) => {
                const box = p.cards[key] ?? 0;
                return { ...p, cards: { ...p.cards, [key]: good ? Math.min(box + 1, 4) : 0 } };
              });
              setProgress(next);
            }}
            onRestart={() => setSession((s) => s + 1)}
          />
        ))}
    </div>
  );
}

function Session({
  deck,
  onGrade,
  onRestart,
}: {
  deck: Card[];
  onGrade: (key: string, good: boolean) => void;
  onRestart: () => void;
}) {
  const [queue, setQueue] = useState(() => deck.map((c) => c.key));
  const [pos, setPos] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState({ good: 0, again: 0 });
  const [missed, setMissed] = useState<Set<string>>(new Set());
  const byKey = useMemo(() => new Map(deck.map((c) => [c.key, c])), [deck]);
  const card = byKey.get(queue[pos]);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);

  const grade = (good: boolean) => {
    if (!card || !flipped) return;
    onGrade(card.key, good);
    setTally((t) => (good ? { ...t, good: t.good + 1 } : { ...t, again: t.again + 1 }));
    if (!good) {
      setMissed((m) => new Set(m).add(card.key));
      setQueue((q) => {
        const next = [...q];
        next.splice(Math.min(pos + 1 + REQUEUE_GAP, next.length), 0, card.key);
        return next;
      });
    }
    setFlipped(false);
    setPos((p) => p + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (e.key === "1" || e.key === "ArrowLeft") grade(false);
      else if (e.key === "2" || e.key === "ArrowRight") grade(true);
      else if (e.key.toLowerCase() === "s" && card) narrator.say(flipped ? card.back : card.front);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!card) {
    const uniqueMissed = missed.size;
    return (
      <div className="session-done">
        <p className="label">Session complete</p>
        <p className="score">
          <span className="mono">{deck.length - uniqueMissed}</span> of <span className="mono">{deck.length}</span> right the
          first time
        </p>
        {uniqueMissed > 0 && (
          <p className="hint">
            {uniqueMissed} card{uniqueMissed === 1 ? "" : "s"} went back into the pile. They’ll show up first next time.
          </p>
        )}
        <button className="btn btn-primary" onClick={onRestart}>
          Study again
        </button>
      </div>
    );
  }

  const done = Math.min(pos, queue.length);
  return (
    <div className="session">
      <div className="session-meter" aria-hidden>
        <div style={{ width: `${(done / queue.length) * 100}%` }} />
      </div>
      <p className="label session-count mono">
        {String(done + 1).padStart(2, "0")} / {String(queue.length).padStart(2, "0")}
        {tally.again > 0 && <span className="dim"> · {tally.again} again</span>}
      </p>

      <button
        className={`flashcard ${flipped ? "is-flipped" : ""}`}
        onClick={() => {
          if (swiped.current) swiped.current = false;
          else setFlipped((f) => !f);
        }}
        onPointerDown={(e) => (touch.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t || !flipped) return;
          const dx = e.clientX - t.x;
          if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(e.clientY - t.y)) {
            swiped.current = true;
            grade(dx > 0);
          }
        }}
        aria-label={flipped ? `Answer: ${card.back}. Tap to show the question.` : `Question: ${card.front}. Tap to reveal the answer.`}
      >
        <span className="flashcard-face flashcard-front">
          <span className="label">Question</span>
          <span className="flashcard-text">{card.front}</span>
        </span>
        <span className="flashcard-face flashcard-back">
          <span className="label">Answer</span>
          <span className="flashcard-text">{card.back}</span>
          <span className="flashcard-cue">{card.front}</span>
        </span>
      </button>

      <div className="grade">
        {flipped ? (
          <>
            <button className="btn btn-again" onClick={() => grade(false)}>
              Again <kbd>1</kbd>
            </button>
            <button className="btn btn-good" onClick={() => grade(true)}>
              Got it <kbd>2</kbd>
            </button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={() => setFlipped(true)}>
            Show answer <kbd>Space</kbd>
          </button>
        )}
        <button
          className="btn-icon"
          onClick={() => narrator.say(flipped ? card.back : card.front)}
          aria-label="Read card aloud"
          title="Read aloud (S)"
        >
          <Icon name="speaker" />
        </button>
      </div>
      <p className="hint center only-touch">Tap the card to flip. Swipe right if you knew it, left to see it again.</p>
    </div>
  );
}

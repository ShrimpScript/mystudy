import { useEffect, useMemo, useState } from "react";
import type { QuizQuestion, StoredGuide } from "../../shared/guide";
import { href } from "../lib/router";
import { getProgress, updateProgress, type Progress } from "../lib/store";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
const pad = (n: number) => String(n).padStart(2, "0");

export function Quiz({ stored }: { stored: StoredGuide }) {
  const g = stored.guide;
  const [only, setOnly] = useState<number[] | null>(null); // question indexes for a "retake missed" run
  const [run, setRun] = useState(0);
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    getProgress(stored.id).then(setProgress);
  }, [stored.id, run]);

  const questions = useMemo(
    () => (only ?? g.quiz.map((_, i) => i)).map((i) => ({ q: g.quiz[i], i })),
    [g.quiz, only, run],
  );

  return (
    <div className="page page-narrow quiz-page">
      {progress?.quizLast && run === 0 && (
        <p className="hint mono">
          Last attempt {progress.quizLast.score}/{progress.quizLast.total}
          {progress.quizBest !== undefined && ` · best ${progress.quizBest}/${g.quiz.length}`}
        </p>
      )}
      <Run
        key={run}
        questions={questions}
        sectionName={(id) => {
          const i = g.sections.findIndex((s) => s.id === id);
          return i === -1 ? "" : `§${pad(i + 1)} ${g.sections[i].heading}`;
        }}
        sectionHref={(id) => href({ name: "guide", id: stored.id, tab: "guide", anchor: id })}
        onFinish={async (score) => {
          if (only) return; // partial retakes don't overwrite the full-quiz score
          await updateProgress(stored.id, (p) => ({
            ...p,
            quizLast: { score, total: g.quiz.length, at: Date.now() },
            quizBest: Math.max(p.quizBest ?? 0, score),
          }));
        }}
        onRetake={(missed) => {
          setOnly(missed);
          setRun((r) => r + 1);
        }}
      />
    </div>
  );
}

function Run({
  questions,
  sectionName,
  sectionHref,
  onFinish,
  onRetake,
}: {
  questions: { q: QuizQuestion; i: number }[];
  sectionName: (id: string) => string;
  sectionHref: (id: string) => string;
  onFinish: (score: number) => void;
  onRetake: (missed: number[] | null) => void;
}) {
  const [pos, setPos] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const current = questions[pos];
  const finished = pos >= questions.length;

  const choose = (c: number) => {
    if (picked !== null || !current) return;
    setPicked(c);
    setAnswers((a) => [...a, c]);
  };

  const next = () => {
    if (picked === null) return;
    const nextPos = pos + 1;
    if (nextPos >= questions.length) {
      const score = [...answers].filter((a, k) => a === questions[k].q.answer_index).length;
      onFinish(score);
    }
    setPicked(null);
    setPos(nextPos);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (finished || (e.target as HTMLElement).closest("input, textarea, select")) return;
      const n = Number(e.key);
      const letter = LETTERS.indexOf(e.key.toUpperCase());
      if (n >= 1 && n <= current.q.choices.length) choose(n - 1);
      else if (letter !== -1 && letter < current.q.choices.length) choose(letter);
      else if (e.key === "Enter") {
        e.preventDefault();
        next();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (finished) {
    const results = questions.map((x, k) => ({ ...x, answer: answers[k] }));
    const wrong = results.filter((r) => r.answer !== r.q.answer_index);
    const score = results.length - wrong.length;
    return (
      <div className="quiz-done">
        <p className="label">Result</p>
        <p className="score">
          <span className="mono">{score}</span> / <span className="mono">{results.length}</span>
        </p>
        {wrong.length > 0 ? (
          <>
            <h2 className="label">Review</h2>
            <ol className="review">
              {wrong.map((r) => (
                <li key={r.i}>
                  <p className="review-q">{r.q.question}</p>
                  <p className="review-a">
                    <span className="is-wrong">{r.q.choices[r.answer]}</span>
                    <span className="is-right">{r.q.choices[r.q.answer_index]}</span>
                  </p>
                  <p className="hint">
                    {r.q.explanation}{" "}
                    {sectionName(r.q.section_id) && (
                      <a href={sectionHref(r.q.section_id)} className="mono ref">
                        {sectionName(r.q.section_id)}
                      </a>
                    )}
                  </p>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="hint">Every question right.</p>
        )}
        <div className="form-actions">
          {wrong.length > 0 && (
            <button className="btn btn-primary" onClick={() => onRetake(wrong.map((w) => w.i))}>
              Retake the {wrong.length} I missed
            </button>
          )}
          <button className="btn btn-quiet" onClick={() => onRetake(null)}>
            Retake all
          </button>
        </div>
      </div>
    );
  }

  const { q } = current;
  return (
    <div className="question">
      <div className="session-meter" aria-hidden>
        <div style={{ width: `${(pos / questions.length) * 100}%` }} />
      </div>
      <p className="label mono">
        Q {pad(pos + 1)} / {pad(questions.length)}
      </p>
      <h2 className="question-text">{q.question}</h2>
      <ol className="choices">
        {q.choices.map((c, k) => {
          const state =
            picked === null ? "" : k === q.answer_index ? "is-right" : k === picked ? "is-wrong" : "is-dim";
          return (
            <li key={k}>
              <button className={`choice ${state}`} onClick={() => choose(k)} disabled={picked !== null} aria-pressed={picked === k}>
                <span className="choice-letter mono">{LETTERS[k]}</span>
                <span>{c}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {picked !== null && (
        <div className="explanation" role="status">
          <p className="label">{picked === q.answer_index ? "Correct" : "Not quite"}</p>
          <p>{q.explanation}</p>
          <button className="btn btn-primary" onClick={next} autoFocus>
            {pos + 1 === questions.length ? "See results" : "Next question"} <kbd>Enter</kbd>
          </button>
        </div>
      )}
    </div>
  );
}

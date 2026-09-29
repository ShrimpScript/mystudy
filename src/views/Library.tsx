import { useEffect, useState } from "react";
import type { StoredGuide } from "../../shared/guide";
import { Icon } from "../components/Icon";
import { href } from "../lib/router";
import { IS_ARTIFACT } from "../lib/runtime";
import { deleteGuide, getProgress, listGuides, type Progress } from "../lib/store";

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

export function Library() {
  const [guides, setGuides] = useState<StoredGuide[] | null>(null);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = async () => {
    const list = await listGuides();
    setGuides(list);
    const entries = await Promise.all(list.map(async (g) => [g.id, await getProgress(g.id)] as const));
    setProgress(Object.fromEntries(entries));
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (g: StoredGuide) => {
    setConfirming(null);
    await deleteGuide(g.id);
    load();
  };

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <p className="label">Library</p>
        <h1 className="display">Your study guides</h1>
        <p className="lede">
          Upload lecture slides, notes, or a chapter. You get a plain-language guide, the facts worth memorizing,
          flashcards, a practice quiz, and a narrator that reads it to you.
        </p>
        <a className="btn btn-primary" href={href({ name: "new" })}>
          <Icon name="plus" size={16} /> New study guide
        </a>
      </div>

      {guides === null ? null : guides.length === 0 ? (
        <p className="empty">Nothing here yet.</p>
      ) : (
        <ol className="shelf">
          {guides.map((g) => {
            const p = progress[g.id];
            const known = p ? Object.values(p.cards).filter((b) => b >= 1).length : 0;
            return (
              <li key={g.id} className="shelf-row">
                <a className="shelf-link" href={href({ name: "guide", id: g.id, tab: "guide" })}>
                  <span className="shelf-course label">
                    {g.guide.course}
                    {g.sample && <span className="tag">Sample</span>}
                  </span>
                  <span className="shelf-title">{g.guide.title}</span>
                  <span className="shelf-meta mono">
                    {dateFmt.format(g.createdAt)} · {g.guide.sections.length} sections · {known}/{g.guide.flashcards.length}{" "}
                    cards known
                    {p?.quizLast && ` · quiz ${p.quizLast.score}/${p.quizLast.total}`}
                  </span>
                </a>
                {!g.sample &&
                  (confirming === g.id ? (
                    <span className="shelf-confirm">
                      <button className="btn btn-danger" onClick={() => remove(g)}>
                        Delete
                      </button>
                      <button className="btn btn-quiet" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button
                      className="btn-icon shelf-delete"
                      onClick={() => setConfirming(g.id)}
                      aria-label={`Delete ${g.guide.title}`}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  ))}
              </li>
            );
          })}
        </ol>
      )}
      <p className="footnote">
        {IS_ARTIFACT
          ? "Your guides and progress are saved privately to your claude.ai account. Files you upload are read in your browser and sent to Claude to write the guide; the files themselves aren’t stored."
          : "Guides and progress are stored in this browser only. Uploaded files are sent to Claude to write the guide and are not kept."}
      </p>
    </div>
  );
}

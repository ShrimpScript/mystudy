import { useEffect, useState } from "react";
import type { StoredGuide } from "../../shared/guide";
import { href, type Tab } from "../lib/router";
import { getGuide } from "../lib/store";
import { Flashcards } from "./Flashcards";
import { GuideReader } from "./GuideReader";
import { Quiz } from "./Quiz";
import { Terms } from "./Terms";

const TABS: { tab: Tab; label: string }[] = [
  { tab: "guide", label: "Guide" },
  { tab: "terms", label: "Terms & facts" },
  { tab: "cards", label: "Flashcards" },
  { tab: "quiz", label: "Quiz" },
];

export function GuideView({ id, tab, anchor }: { id: string; tab: Tab; anchor?: string }) {
  const [stored, setStored] = useState<StoredGuide | null | undefined>(undefined);

  useEffect(() => {
    getGuide(id).then((g) => setStored(g ?? null));
  }, [id]);

  if (stored === undefined) return null;
  if (stored === null)
    return (
      <div className="page page-narrow">
        <p className="label">Not found</p>
        <h1 className="display">This guide isn’t on this device</h1>
        <p className="lede">
          Guides are saved in the browser that created them. <a href={href({ name: "library" })}>Back to your library</a>.
        </p>
      </div>
    );

  const g = stored.guide;
  const counts = [
    `${g.sections.length} sections`,
    `${g.key_terms.length} terms`,
    `${g.flashcards.length} cards`,
    `${g.quiz.length} questions`,
  ];

  return (
    <div className="guide">
      <header className="guide-head">
        <div className="guide-head-inner">
          <p className="label">{g.course}</p>
          <h1 className="display">{g.title}</h1>
          <p className="guide-meta mono">
            {stored.sourceFiles.length > 0 && <>From {stored.sourceFiles.join(", ")} · </>}
            {counts.join(" · ")}
          </p>
        </div>
      </header>
      <nav className="tabs" aria-label="Guide views">
        <div className="tabs-inner">
          {TABS.map((t) => (
            <a
              key={t.tab}
              href={href({ name: "guide", id, tab: t.tab })}
              className={`tab ${tab === t.tab ? "is-on" : ""}`}
              aria-current={tab === t.tab ? "page" : undefined}
            >
              {t.label}
            </a>
          ))}
        </div>
      </nav>
      {tab === "guide" && <GuideReader stored={stored} anchor={anchor} />}
      {tab === "terms" && <Terms stored={stored} />}
      {tab === "cards" && <Flashcards stored={stored} sectionFilter={anchor} />}
      {tab === "quiz" && <Quiz stored={stored} />}
    </div>
  );
}

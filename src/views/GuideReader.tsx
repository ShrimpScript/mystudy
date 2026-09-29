import { useEffect, useMemo, useRef, useState } from "react";
import type { Guide, StoredGuide } from "../../shared/guide";
import { DiagramView } from "../components/Diagram";
import { FigureView, SeeIt } from "../components/Figure";
import { Icon } from "../components/Icon";
import { narrator, useNarrator, type Segment } from "../lib/narrator";
import { href } from "../lib/router";

const pad = (n: number) => String(n).padStart(2, "0");
const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

/** The narration script, in reading order. Keys match `data-read` attributes below. */
function buildScript(g: Guide): Segment[] {
  const out: Segment[] = [{ key: "intro:overview", text: `${g.title}. ${g.overview}`, section: "Overview" }];
  if (g.big_picture.length)
    out.push({
      key: "intro:big",
      text: `If you remember nothing else: ${g.big_picture.join(" ")}`,
      section: "Overview",
    });
  g.sections.forEach((s, i) => {
    const label = `§${pad(i + 1)} ${s.heading}`;
    paragraphs(s.simplified).forEach((p, j) =>
      out.push({ key: `${s.id}:p${j}`, text: j === 0 ? `Section ${i + 1}. ${s.heading}. ${p}` : p, section: label }),
    );
    if (s.key_points.length)
      out.push({ key: `${s.id}:points`, text: `Key points. ${s.key_points.join(" ")}`, section: label });
    if (s.remember.length)
      out.push({ key: `${s.id}:remember`, text: `Remember. ${s.remember.join(" ")}`, section: label });
  });
  return out;
}

export function GuideReader({ stored, anchor }: { stored: StoredGuide; anchor?: string }) {
  const g = stored.guide;
  const script = useMemo(() => buildScript(g), [g]);
  const n = useNarrator();
  const [active, setActive] = useState(g.sections[0]?.id ?? "");
  const [tocOpen, setTocOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Load this guide into the narrator unless it's already queued (keeps position across tabs).
  useEffect(() => {
    if (narrator.getState().title !== stored.id) narrator.load(script, stored.id);
  }, [script, stored.id]);

  // Scroll to a requested section.
  useEffect(() => {
    if (anchor) document.getElementById(anchor)?.scrollIntoView({ block: "start" });
  }, [anchor]);

  // Highlight and follow what the narrator is reading.
  const readingKey = n.title === stored.id && (n.playing || n.index > 0) ? n.segments[n.index]?.key : undefined;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll(".is-reading").forEach((el) => el.classList.remove("is-reading"));
    if (!readingKey) return;
    const el = root.querySelector(`[data-read="${CSS.escape(readingKey)}"]`);
    el?.classList.add("is-reading");
    if (n.playing && el) {
      const r = el.getBoundingClientRect();
      if (r.top < 80 || r.bottom > window.innerHeight - 120) el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [readingKey, n.playing]);

  // Track which section is on screen for the contents rail.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = window.innerHeight * 0.3;
      let current = g.sections[0]?.id ?? "";
      for (const s of g.sections) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line) current = s.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [g.sections]);

  const cardsFor = (id: string) => g.flashcards.filter((c) => c.section_id === id).length;
  const images = stored.figureImages ?? {};
  // Section figures are the ones meant for reading; picture-card crops are shown on the cards.
  const cardOnly = new Set(g.flashcards.map((c) => c.figure_id).filter(Boolean));
  const seeItFor = (id: string) =>
    g.key_terms
      .filter((t) => t.section_id === id && t.image_query)
      .map((t) => ({ label: t.term.replace(/\s*\(.*\)$/, ""), query: t.image_query! }));
  const figuresFor = (id: string) =>
    (g.figures ?? []).filter((f) => f.section_id === id && images[f.id] && !cardOnly.has(f.id));
  const sectionIndex = Object.fromEntries(g.sections.map((s, i) => [s.id, i]));

  return (
    <div className={`reader ${n.playing && n.title === stored.id ? "is-narrating" : ""}`} ref={rootRef}>
      <aside className={`toc ${tocOpen ? "is-open" : ""}`} aria-label="Contents">
        <button className="toc-toggle btn btn-quiet" onClick={() => setTocOpen((o) => !o)} aria-expanded={tocOpen}>
          <Icon name="list" size={16} /> Contents
        </button>
        <ol className="toc-list">
          {g.sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={active === s.id ? "is-on" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(s.id)?.scrollIntoView({ block: "start", behavior: "smooth" });
                  setTocOpen(false);
                }}
              >
                <span className="mono">{pad(i + 1)}</span>
                <span>{s.heading}</span>
              </a>
            </li>
          ))}
        </ol>
      </aside>

      <article className="prose">
        <section className="intro">
          <p className="overview" data-read="intro:overview">
            {g.overview}
          </p>
          <button className="btn btn-primary btn-listen" onClick={() => (n.playing ? narrator.pause() : narrator.play(0))}>
            <Icon name={n.playing && n.title === stored.id ? "pause" : "play"} size={16} />
            {n.playing && n.title === stored.id ? "Pause" : "Listen to this guide"}
          </button>

          {g.big_picture.length > 0 && (
            <div className="big-picture" data-read="intro:big">
              <h2 className="label">If you remember nothing else</h2>
              <ol>
                {g.big_picture.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ol>
            </div>
          )}

          {g.exam_focus.length > 0 && (
            <div className="exam-focus">
              <h2 className="label">Most likely on the exam</h2>
              <ol>
                {g.exam_focus.map((e, i) => (
                  <li key={i}>
                    <span className="exam-point">{e.point}</span>
                    <span className="exam-why">
                      {e.why}{" "}
                      {sectionIndex[e.section_id] !== undefined && (
                        <a href={`#${e.section_id}`} onClick={(ev) => {
                          ev.preventDefault();
                          document.getElementById(e.section_id)?.scrollIntoView({ behavior: "smooth" });
                        }} className="mono ref">
                          §{pad(sectionIndex[e.section_id] + 1)}
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>

        {g.sections.map((s, i) => (
          <section key={s.id} id={s.id} className="section">
            <div className="section-body">
              <p className="label section-label">
                <span className="mono">§{pad(i + 1)}</span>
                {s.source_ref && <span>{s.source_ref}</span>}
              </p>
              <h2 className="section-heading">{s.heading}</h2>
              {paragraphs(s.simplified).map((p, j) => (
                <p key={j} data-read={`${s.id}:p${j}`}>
                  {p}
                </p>
              ))}
              {figuresFor(s.id).length > 0 && (
                <div className="section-figures">
                  {figuresFor(s.id).map((f) => (
                    <FigureView key={f.id} fig={f} src={images[f.id]} />
                  ))}
                </div>
              )}
              {(g.diagrams ?? [])
                .filter((d) => d.section_id === s.id)
                .map((d) => (
                  <DiagramView key={d.id} d={d} />
                ))}
              {s.key_points.length > 0 && (
                <ul className="points" data-read={`${s.id}:points`}>
                  {s.key_points.map((k, j) => (
                    <li key={j}>{k}</li>
                  ))}
                </ul>
              )}
              <SeeIt items={seeItFor(s.id)} />
              <div className="section-actions">
                <button className="btn-text" onClick={() => narrator.playFrom(`${s.id}:`)}>
                  <Icon name="play" size={14} /> Listen from here
                </button>
                {cardsFor(s.id) > 0 && (
                  <a className="btn-text" href={href({ name: "guide", id: stored.id, tab: "cards", anchor: s.id })}>
                    <Icon name="flip" size={14} /> {cardsFor(s.id)} cards
                  </a>
                )}
              </div>
            </div>
            {s.remember.length > 0 && (
              <aside className="remember" data-read={`${s.id}:remember`} aria-label="Remember">
                <h3 className="label">Remember</h3>
                <ul>
                  {s.remember.map((r, j) => (
                    <li key={j}>
                      <mark>{r}</mark>
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </section>
        ))}
        <p className="footnote end">
          Generated from {stored.sourceFiles.join(", ") || "your material"}. Check anything surprising against the original.
        </p>
      </article>
    </div>
  );
}

import { useMemo, useState } from "react";
import type { StoredGuide } from "../../shared/guide";
import { FigureView, RealPhotos } from "../components/Figure";
import { Icon } from "../components/Icon";
import { href } from "../lib/router";

export function Terms({ stored }: { stored: StoredGuide }) {
  const g = stored.guide;
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const match = (...parts: string[]) => !query || parts.some((p) => p.toLowerCase().includes(query));

  const terms = useMemo(
    () => [...g.key_terms].sort((a, b) => a.term.localeCompare(b.term)).filter((t) => match(t.term, t.definition)),
    [g.key_terms, query],
  );
  const numbers = g.numbers_to_know.filter((n) => match(n.value, n.meaning));
  const lists = g.lists_to_memorize.filter((l) => match(l.title, ...l.items));
  const timeline = g.timeline.filter((t) => match(t.when, t.event));
  const images = stored.figureImages ?? {};
  const visuals = (g.figures ?? []).filter((f) => images[f.id] && match(f.caption));
  const sectionHref = (id: string) => href({ name: "guide", id: stored.id, tab: "guide", anchor: id });
  const nothing = !terms.length && !numbers.length && !lists.length && !timeline.length && !visuals.length;

  return (
    <div className="page page-wide terms">
      <div className="search">
        <Icon name="search" size={16} />
        <input
          className="input input-bare"
          type="search"
          placeholder="Filter terms, numbers, lists…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter"
        />
      </div>

      {nothing && <p className="empty">Nothing matches “{q}”.</p>}

      {visuals.length > 0 && (
        <section className="visuals">
          <h2 className="label">Visuals · {visuals.length}</h2>
          <div className="visual-grid">
            {visuals.map((f) => (
              <FigureView key={f.id} fig={f} src={images[f.id]} compact />
            ))}
          </div>
        </section>
      )}

      <div className="terms-grid">
        {terms.length > 0 && (
          <section className="terms-col">
            <h2 className="label">Key terms · {terms.length}</h2>
            <dl className="glossary">
              {terms.map((t) => (
                <div key={t.term} className="glossary-row">
                  <dt>{t.term}</dt>
                  <dd>
                    {t.definition}{" "}
                    <a className="ref mono" href={sectionHref(t.section_id)} aria-label={`Read about ${t.term} in the guide`}>
                      ↗
                    </a>
                    {t.image_query && <RealPhotos query={t.image_query} label="Photos" />}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        <div className="terms-col">
          {lists.length > 0 && (
            <section>
              <h2 className="label">Lists to memorize</h2>
              {lists.map((l) => (
                <div key={l.title} className="memlist">
                  <h3>{l.title}</h3>
                  <ol>
                    {l.items.map((it, i) => (
                      <li key={i}>{it}</li>
                    ))}
                  </ol>
                  {l.memory_aid && <p className="memory-aid">{l.memory_aid}</p>}
                </div>
              ))}
            </section>
          )}

          {numbers.length > 0 && (
            <section>
              <h2 className="label">Numbers to know</h2>
              <table className="numbers">
                <tbody>
                  {numbers.map((n, i) => (
                    <tr key={i}>
                      <th scope="row" className="mono">
                        {n.value}
                      </th>
                      <td>{n.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {timeline.length > 0 && (
            <section>
              <h2 className="label">Timeline</h2>
              <ol className="timeline">
                {timeline.map((t, i) => (
                  <li key={i}>
                    <span className="mono when">{t.when}</span>
                    <span>{t.event}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

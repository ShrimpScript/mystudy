import { useEffect, useRef, useState } from "react";
import type { Figure } from "../../shared/guide";
import { imageSearchUrl, searchPhotos, type Photo, type PhotoKind } from "../lib/photos";
import { Icon } from "./Icon";
import { Segmented } from "./Popover";

/** A figure from the source material: tap to enlarge, optionally with real-world photos. */
export function FigureView({ fig, src, compact = false }: { fig: Figure; src: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <figure className={`figure ${compact ? "figure-compact" : ""}`}>
      <button className="figure-frame" onClick={() => setOpen(true)} aria-label={`Enlarge: ${fig.caption}`}>
        <img src={src} alt={fig.caption} loading="lazy" />
      </button>
      <figcaption>
        <span>{fig.caption}</span>
        <span className="figure-ref mono">
          {fig.source_file ? `${shortName(fig.source_file)} · ` : ""}p. {fig.page}
        </span>
      </figcaption>
      {fig.image_query && !compact && <RealPhotos query={fig.image_query} />}
      {open && <Lightbox src={src} caption={fig.caption} onClose={() => setOpen(false)} />}
    </figure>
  );
}

function shortName(name: string) {
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  return base.length > 28 ? base.slice(0, 26) + "…" : base;
}

export function Lightbox({ src, caption, onClose }: { src: string; caption: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal?.();
    const close = () => onClose();
    d.addEventListener("close", close);
    return () => d.removeEventListener("close", close);
  }, [onClose]);
  return (
    <dialog ref={ref} className="lightbox" onClick={(e) => e.target === e.currentTarget && ref.current?.close()}>
      <div className="lightbox-body">
        <img src={src} alt={caption} />
        <p>{caption}</p>
        <button className="btn" onClick={() => ref.current?.close()} autoFocus>
          <Icon name="close" size={14} /> Close
        </button>
      </div>
    </dialog>
  );
}

type PhotoState = { status: "loading" } | { status: "done"; photos: Photo[] } | { status: "error" };

/** "See real photos": searches Wikimedia Commons on demand and credits each result. */
export function RealPhotos({ query, label = "See real photos" }: { query: string; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="btn-text photos-toggle" onClick={() => setOpen(true)}>
        <Icon name="search" size={14} /> {label}
      </button>
    );
  return <PhotoPanel query={query} />;
}

/** A row of chips ("Steamer", "Pike pole"); tapping one shows real photos of it. */
export function SeeIt({ items }: { items: { label: string; query: string }[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!items.length) return null;
  const current = items.find((i) => i.query === open);
  return (
    <div className="see-it">
      <div className="see-it-row">
        <span className="label">See it for real</span>
        {items.map((i) => (
          <button
            key={i.query}
            className={`chip ${open === i.query ? "is-on" : ""}`}
            aria-expanded={open === i.query}
            onClick={() => setOpen(open === i.query ? null : i.query)}
          >
            {i.label}
          </button>
        ))}
      </div>
      {current && <PhotoPanel key={current.query} query={current.query} />}
    </div>
  );
}

/** Photos or diagrams for one query from Wikimedia Commons, with credits and a web fallback. */
function PhotoPanel({ query }: { query: string }) {
  const [kind, setKind] = useState<PhotoKind>("photo");
  const [state, setState] = useState<PhotoState>({ status: "loading" });
  const [enlarged, setEnlarged] = useState<Photo | null>(null);

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    searchPhotos(query, 4, kind)
      .then((photos) => live && setState({ status: "done", photos }))
      .catch(() => live && setState({ status: "error" }));
    return () => {
      live = false;
    };
  }, [query, kind]);

  const noun = kind === "photo" ? "photos" : "diagrams";
  return (
    <div className="photos" aria-live="polite">
      <Segmented<PhotoKind>
        name="Kind of image"
        value={kind}
        onChange={setKind}
        options={[
          { value: "photo", label: "Photos" },
          { value: "drawing", label: "Diagrams & symbols" },
        ]}
      />
      {state.status === "loading" && <p className="hint">Finding {noun}…</p>}
      {state.status === "error" && <p className="hint">Couldn’t reach Wikimedia Commons from here.</p>}
      {state.status === "done" && state.photos.length === 0 && <p className="hint">No matching {noun} on Wikimedia Commons.</p>}
      {state.status === "done" && state.photos.length > 0 && (
        <>
          <ul className={`photo-grid ${kind === "drawing" ? "is-drawing" : ""}`}>
            {state.photos.map((p) => (
              <li key={p.page}>
                <button className="photo" onClick={() => setEnlarged(p)} aria-label={`Enlarge: ${p.title}`}>
                  <img src={p.thumb} alt={p.title} loading="lazy" />
                </button>
                <a className="photo-credit" href={p.page} target="_blank" rel="noreferrer">
                  {p.credit}
                  {p.license && ` · ${p.license}`}
                </a>
              </li>
            ))}
          </ul>
          <p className="hint">Found by searching “{query}” on Wikimedia Commons. Check that each one matches.</p>
        </>
      )}
      <a className="btn-text" href={imageSearchUrl(query)} target="_blank" rel="noreferrer">
        More images on the web ↗
      </a>
      {enlarged && <Lightbox src={enlarged.thumb} caption={`${enlarged.title} — ${enlarged.credit}`} onClose={() => setEnlarged(null)} />}
    </div>
  );
}

// Real-world reference photos and diagrams from Wikimedia Commons (freely licensed, and its
// API allows requests straight from a browser). Results are found by search,
// so they're shown as references with credit, never as part of the source.

export interface Photo {
  thumb: string;
  width: number;
  height: number;
  page: string;
  title: string;
  credit: string;
  license: string;
}

const API = "https://commons.wikimedia.org/w/api.php";
const CACHE_PREFIX = "margin:photos:";
const cache = new Map<string, Promise<Photo[]>>();

// Commons metadata is HTML. DOMParser builds an inert document (no scripts run,
// no images load), unlike innerHTML on an element, so it's safe for untrusted markup.
const stripHtml = (html: string) =>
  (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/\s+/g, " ").trim();

export function imageSearchUrl(query: string) {
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`;
}

/** "photo" finds photographs; "drawing" finds diagrams, symbols and technical drawings (SVG). */
export type PhotoKind = "photo" | "drawing";

async function fetchPhotos(query: string, limit: number, kind: PhotoKind): Promise<Photo[]> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: `${query} filetype:${kind === "drawing" ? "drawing" : "bitmap"}`,
    gsrnamespace: "6",
    gsrlimit: String(limit + 2),
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: "640",
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  const data = await res.json();
  const pages = Object.values<any>(data?.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages
    .map((p) => {
      const info = p.imageinfo?.[0];
      if (!info?.thumburl) return null;
      const meta = info.extmetadata ?? {};
      return {
        thumb: info.thumburl,
        width: info.thumbwidth,
        height: info.thumbheight,
        page: info.descriptionurl,
        title: stripHtml(meta.ObjectName?.value ?? p.title?.replace(/^File:/, "") ?? ""),
        credit: stripHtml(meta.Artist?.value ?? "Unknown author"),
        license: stripHtml(meta.LicenseShortName?.value ?? ""),
      } satisfies Photo;
    })
    .filter((p): p is Photo => Boolean(p))
    .slice(0, limit);
}

/** Up to `limit` photos for a query. Cached for the session and in this browser. Rejects when offline or blocked. */
export function searchPhotos(query: string, limit = 4, kind: PhotoKind = "photo"): Promise<Photo[]> {
  const key = `${query.trim().toLowerCase()}|${limit}|${kind}`;
  if (!cache.has(key)) {
    cache.set(
      key,
      (async () => {
        try {
          const saved = localStorage.getItem(CACHE_PREFIX + key);
          if (saved) return JSON.parse(saved) as Photo[];
        } catch {
          /* storage unavailable */
        }
        const photos = await fetchPhotos(query, limit, kind);
        try {
          localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(photos));
        } catch {
          /* storage full or unavailable */
        }
        return photos;
      })().catch((err) => {
        cache.delete(key); // let a later tap try again
        throw err;
      }),
    );
  }
  return cache.get(key)!;
}

import { useEffect, useState } from "react";

// Hash routes keep the app deployable as static files behind any host.
//   #/                     library
//   #/new                  create a guide
//   #/g/:id/:tab?          a guide (tab: guide | terms | cards | quiz)

export type Route =
  | { name: "library" }
  | { name: "new" }
  | { name: "guide"; id: string; tab: Tab; anchor?: string };

export type Tab = "guide" | "terms" | "cards" | "quiz";
const TABS: Tab[] = ["guide", "terms", "cards", "quiz"];

export function parse(hash: string): Route {
  const [path, anchor] = hash.replace(/^#/, "").split("?at=");
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "new") return { name: "new" };
  if (parts[0] === "g" && parts[1]) {
    const tab = TABS.includes(parts[2] as Tab) ? (parts[2] as Tab) : "guide";
    return { name: "guide", id: decodeURIComponent(parts[1]), tab, anchor };
  }
  return { name: "library" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "library":
      return "#/";
    case "new":
      return "#/new";
    case "guide":
      return `#/g/${encodeURIComponent(route.id)}/${route.tab}${route.anchor ? `?at=${route.anchor}` : ""}`;
  }
}

export function navigate(route: Route) {
  location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

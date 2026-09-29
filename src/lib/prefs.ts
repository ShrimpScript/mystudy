import { useSyncExternalStore } from "react";
import { IS_ARTIFACT } from "./runtime";

export type Theme = "system" | "light" | "dark";
export type TextSize = "s" | "m" | "l";

interface Prefs {
  theme: Theme;
  size: TextSize;
  passcode: string;
  /** Static build only: the user's Anthropic API key, kept in this browser. */
  apiKey: string;
  model: string;
}

const KEY = "margin:prefs";
const DEFAULTS: Prefs = { theme: "system", size: "m", passcode: "", apiKey: "", model: "claude-opus-5-5" };

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

function apply(p: Prefs) {
  const el = document.documentElement;
  // On claude.ai the viewer owns data-theme on the root element; leave it alone.
  if (IS_ARTIFACT) {
    el.setAttribute("data-size", p.size);
    return;
  }
  if (p.theme === "system") el.removeAttribute("data-theme");
  else el.setAttribute("data-theme", p.theme);
  el.setAttribute("data-size", p.size);
}

// One shared copy so every component sees a change at once.
let current = read();
apply(current);
const listeners = new Set<() => void>();

function update(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  apply(current);
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage unavailable: keep for this visit */
  }
  listeners.forEach((l) => l());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function usePrefs() {
  const prefs = useSyncExternalStore(subscribe, () => current);
  return [prefs, update] as const;
}

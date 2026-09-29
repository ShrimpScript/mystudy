import { useEffect, useState } from "react";
import { IS_ARTIFACT } from "./runtime";

export type Theme = "system" | "light" | "dark";
export type TextSize = "s" | "m" | "l";

interface Prefs {
  theme: Theme;
  size: TextSize;
  passcode: string;
}

const KEY = "margin:prefs";
const DEFAULTS: Prefs = { theme: "system", size: "m", passcode: "" };

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

apply(read());

export function usePrefs() {
  const [prefs, setPrefs] = useState(read);
  useEffect(() => {
    apply(prefs);
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
  }, [prefs]);
  return [prefs, (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }))] as const;
}

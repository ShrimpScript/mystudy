// Turns the single-file Vite build into the page body claude.ai publishes:
// claude.ai supplies <!doctype>, <head> and <body>, so emit only the title,
// the Google Fonts links, the inlined styles, the mount point and the script.
import { readFileSync, writeFileSync } from "node:fs";

const html = readFileSync("dist-artifact/index.html", "utf8");
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);

const fonts = pick(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/g);
const styles = pick(/<style[\s\S]*?<\/style>/g);
const scripts = pick(/<script type="module"[\s\S]*?<\/script>/g);
if (!styles.length || !scripts.length) throw new Error("Expected inlined <style> and <script> in dist-artifact/index.html");

const page = [
  "<title>Margin Study Guides</title>",
  ...fonts,
  ...styles,
  '<div id="root"></div>',
  ...scripts.map((s) => s.replace(/\s+crossorigin(?=[\s>])/, "")),
].join("\n");

writeFileSync("dist-artifact/margin.html", page);
console.log(`dist-artifact/margin.html  ${(page.length / 1024).toFixed(0)} KB`);

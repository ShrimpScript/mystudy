// Local / container entry point. On Vercel, api/index.ts serves the same app.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  // No .env file: rely on the real environment.
}

// Imported after .env is loaded so the app sees its settings.
const { createApp } = await import("./app.js");
const app = createApp();

if (process.env.NODE_ENV === "production") {
  const dist = path.join(root, "dist");
  app.use(express.static(dist, { maxAge: "1h", index: false }));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  const mock = process.env.MOCK_GENERATION === "1";
  console.log(`mystudy server on http://localhost:${port}${mock ? " (MOCK mode)" : ""}`);
  if (!process.env.ANTHROPIC_API_KEY && !mock) console.warn("ANTHROPIC_API_KEY is not set — generation is disabled.");
});

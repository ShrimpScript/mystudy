import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig(({ mode }) =>
  mode === "artifact"
    ? {
        // claude.ai build: one self-contained page (only Google Fonts load from outside).
        plugins: [react(), viteSingleFile()],
        publicDir: false,
        build: { outDir: "dist-artifact", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
      }
    : {
        plugins: [react()],
        server: { host: true, proxy: { "/api": "http://localhost:8787" } },
      },
);

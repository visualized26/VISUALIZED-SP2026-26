import { defineConfig } from "vite";

// GitHub Pages serves the site from /<repo>/ ; local dev serves from /
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/VISUALIZED-SP2026-26/" : "/",
  server: { port: 5173, host: "localhost" },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
}));

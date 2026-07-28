import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves under /<repo>/ when using project pages.
// Override with VITE_BASE=/ for same-origin Flask hosting.
const base = process.env.VITE_BASE || "/";

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});

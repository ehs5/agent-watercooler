import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  plugins: [svelte()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
  },
  server: {
    // In dev the frontend runs on Vite's port and talks to a running server.
    proxy: {
      "/api": { target: "http://127.0.0.1:4747", changeOrigin: true },
    },
  },
});

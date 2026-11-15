import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: process.env.FRAMEBREAK_API ?? "http://127.0.0.1:8787",
        changeOrigin: false,
      },
    },
  },
  build: {
    rolldownOptions: {
      input: Object.fromEntries(["index.html", "asset-hypotheses/episode.html", "storyfork/index.html"]
        .map((path) => [path, fileURLToPath(new URL(path, import.meta.url))])),
    },
  },
});

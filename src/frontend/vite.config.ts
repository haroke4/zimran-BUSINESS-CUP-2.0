import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react(), tailwindcss()],
  base: command === "build" || isPreview ? "/static/dist/" : "/",
  server: {
    proxy: {
      "/api": process.env.STORYFORK_API_TARGET || "http://127.0.0.1:8000",
      "/media": process.env.STORYFORK_API_TARGET || "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: "../static/dist",
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "./src"),
    },
  },
}))

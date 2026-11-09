import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    rollupOptions: {
      input: {
        main: resolve(fileURLToPath(new URL(".",import.meta.url)), "index.html"),
        widget: resolve(fileURLToPath(new URL(".",import.meta.url)), "widget.html")
      }
    },
    target: "es2020",
    minify: "esbuild"
  }
});

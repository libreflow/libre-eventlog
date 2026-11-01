/// <reference types="vitest" />
// defineConfig depuis vitest/config : type la section `test` tout en
// restant compatible avec vite build/dev.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // ignore la sortie de compilation Rust (fichiers verrouillés par cargo)
      ignored: ["**/src-tauri/target/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
  test: {
    // Fonctions pures : environnement node suffisant (pas de DOM requis).
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});

import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    // PGlite + model streaming can take a moment on a cold start.
    testTimeout: 30_000,
    // PGlite is a single, file-backed instance shared across the repo
    // (./.pglite). Running test files in parallel workers makes them race on
    // that one database and the WASM engine aborts. Run files sequentially.
    fileParallelism: false,
  },
});

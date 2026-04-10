import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // litesvm is a native addon; each file boots its own in-process VM (loading
    // the solans + Metaplex `.so`s). Concurrent worker forks init litesvm at the
    // same time and flakily crash on CI linux ("Worker exited unexpectedly"), so
    // cap to a single worker (no concurrent inits), one file at a time. Each file
    // still gets a fresh fork (default isolation), so native state doesn't pile up.
    pool: "forks",
    fileParallelism: false,
    maxWorkers: 1,
  },
});

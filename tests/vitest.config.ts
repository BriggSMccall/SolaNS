import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // litesvm is a native addon; each file boots its own in-process VM (loading
    // the solans + Metaplex `.so`s). Under CI's limited cores/RAM, spawning a
    // fresh worker fork per file crashes ("Worker exited unexpectedly"). Run
    // every file sequentially (`fileParallelism: false`) in one reused fork
    // (`isolate: false`) — deterministic and memory-light. (vitest 4 dropped
    // `poolOptions.forks.singleFork`; `isolate: false` is the v4 equivalent.)
    fileParallelism: false,
    isolate: false,
    pool: "forks",
  },
});

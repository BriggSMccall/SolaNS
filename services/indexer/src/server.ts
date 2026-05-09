import { buildApp, MemoryStore } from "./app.ts";

const port = Number(process.env.PORT ?? 8788);

// In-memory store by default; swap for a persistent `IndexStore` adapter (Postgres,
// SQLite, …) for durability. Backfill by replaying historical txs through `/webhook`.
const app = buildApp(new MemoryStore());

app
  .listen({ port, host: "0.0.0.0" })
  .then((addr) => console.log(`SOLANS indexer listening on ${addr}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

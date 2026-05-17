/**
 * Keeper observability (§13). The keeper is a loop, not an HTTP service, so metrics
 * ride two seams it already has:
 *   1. a {@link MetricsNotifier} — just another {@link Notifier}, composed into the
 *      existing `MultiNotifier`, that counts keeper events by type; and
 *   2. an optional tiny HTTP server ({@link startMetricsServer}) exposing `/metrics`
 *      for a Prometheus scrape, started only when `KEEPER_METRICS_PORT` is set.
 * Both are injected/optional so `keeper.ts` stays pure.
 */
import { createServer, type Server } from "node:http";
import { CONTENT_TYPE, type Counter, Registry } from "@solans/observability";
import type { KeeperEvent, Notifier } from "./keeper.ts";

/** A {@link Notifier} sink that records each keeper event as a metric. */
export class MetricsNotifier implements Notifier {
  constructor(private readonly events: Counter) {}
  async notify(e: KeeperEvent): Promise<void> {
    this.events.inc(1, { type: e.type });
  }
}

export interface KeeperMetrics {
  registry: Registry;
  /** Increment once per completed sweep. */
  sweeps: Counter;
  /** A `Notifier` that counts events by type — add it to the keeper's sinks. */
  notifier: MetricsNotifier;
}

export function buildKeeperMetrics(): KeeperMetrics {
  const registry = new Registry();
  const events = registry.counter("solans_keeper_events_total", "Keeper events by type");
  const sweeps = registry.counter("solans_keeper_sweeps_total", "Completed keeper sweeps");
  return { registry, sweeps, notifier: new MetricsNotifier(events) };
}

/** Start a minimal `/metrics` (+ `/health`) HTTP server for a Prometheus scrape. */
export function startMetricsServer(registry: Registry, port: number): Server {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/metrics")) {
      res.writeHead(200, { "content-type": CONTENT_TYPE });
      res.end(registry.expose());
    } else if (req.url?.startsWith("/health")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port);
  return server;
}

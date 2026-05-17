import { describe, expect, it } from "vitest";
import { Counter, Gauge, Histogram, Registry, CONTENT_TYPE } from "@solans/observability";

describe("Counter", () => {
  it("accumulates per label set (order-independent) and renders HELP/TYPE + samples", () => {
    const c = new Counter("solans_http_requests_total", "HTTP requests");
    c.inc(1, { route: "/resolve", status: 200 });
    c.inc(2, { status: 200, route: "/resolve" }); // same series, keys reordered
    c.inc(1, { route: "/reverse", status: 404 });
    const out = c.expose();
    expect(out).toContain("# HELP solans_http_requests_total HTTP requests");
    expect(out).toContain("# TYPE solans_http_requests_total counter");
    expect(out).toContain('solans_http_requests_total{route="/resolve",status="200"} 3');
    expect(out).toContain('solans_http_requests_total{route="/reverse",status="404"} 1');
  });

  it("rejects negative increments (counters are monotonic)", () => {
    expect(() => new Counter("x", "x").inc(-1)).toThrow(/>= 0/);
  });

  it("renders an unlabeled sample with no brace block", () => {
    const c = new Counter("solans_sweeps_total", "sweeps");
    c.inc();
    expect(c.expose()).toContain("solans_sweeps_total 1");
    expect(c.expose()).not.toContain("{");
  });
});

describe("Gauge", () => {
  it("supports set/inc/dec", () => {
    const g = new Gauge("solans_indexed_names", "names");
    g.set(10);
    g.inc(5);
    g.dec(3);
    expect(g.expose()).toContain("solans_indexed_names 12");
    expect(g.expose()).toContain("# TYPE solans_indexed_names gauge");
  });
});

describe("Histogram", () => {
  it("emits cumulative le buckets + _sum + _count", () => {
    const h = new Histogram("solans_latency_seconds", "latency", [0.1, 0.5, 1]);
    h.observe(0.05); // <= 0.1, 0.5, 1
    h.observe(0.3); // <= 0.5, 1
    h.observe(2); // <= none of the finite buckets
    const out = h.expose();
    expect(out).toContain("# TYPE solans_latency_seconds histogram");
    expect(out).toContain('solans_latency_seconds_bucket{le="0.1"} 1');
    expect(out).toContain('solans_latency_seconds_bucket{le="0.5"} 2');
    expect(out).toContain('solans_latency_seconds_bucket{le="1"} 2');
    expect(out).toContain('solans_latency_seconds_bucket{le="+Inf"} 3');
    expect(out).toContain("solans_latency_seconds_sum 2.35");
    expect(out).toContain("solans_latency_seconds_count 3");
  });

  it("sorts buckets passed out of order", () => {
    const h = new Histogram("h", "h", [1, 0.1, 0.5]);
    expect(h.buckets).toEqual([0.1, 0.5, 1]);
  });
});

describe("Registry", () => {
  it("renders all metrics separated by a blank line, with a trailing newline", () => {
    const r = new Registry();
    r.counter("a_total", "a").inc();
    r.gauge("b", "b").set(7);
    const out = r.expose();
    expect(out).toContain("a_total 1");
    expect(out).toContain("b 7");
    expect(out.endsWith("\n")).toBe(true);
    expect(out).toContain("\n\n"); // blank line between the two metrics
  });

  it("rejects duplicate metric names", () => {
    const r = new Registry();
    r.counter("dup", "x");
    expect(() => r.counter("dup", "y")).toThrow(/already registered/);
  });

  it("exposes the Prometheus v0.0.4 content type", () => {
    expect(CONTENT_TYPE).toBe("text/plain; version=0.0.4; charset=utf-8");
  });
});

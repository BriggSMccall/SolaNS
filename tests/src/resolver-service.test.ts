import { describe, expect, it } from "vitest";
import { address, none, some } from "@solana/kit";
import {
  buildApp,
  decodeDohResponse,
  encodeDohQuery,
  MemoryCache,
  type ContentFetcher,
  type Resolver,
} from "solans-resolver";
import type { NameRecord, Record as SolansRecord } from "@solans/sdk";

const OWNER = address("2m5CoAk7ioZJbRYqHV9PJMNZN2gwpTPKQXR4GKyVifL7");

const sampleRecord = {
  discriminator: new Uint8Array(8),
  owner: OWNER,
  controller: none(),
  nameHash: new Uint8Array(32),
  tld: "chain",
  registeredAt: 0n,
  expiresAt: 1_893_456_000n,
  records: [{ key: "address.SOL", value: "So1111" }],
  resolver: none(),
  hostingRef: some("ipfs://Qm"),
  transferLocked: false,
  reverseSet: false,
  nftMint: none(),
  parent: none(),
  parentRegisteredAt: 0n,
  depth: 0,
  listed: false,
  bump: 255,
} as unknown as NameRecord;

function fake(over: Partial<Resolver> = {}): Resolver {
  return {
    resolve: async () => null,
    reverseLookup: async () => null,
    getRecords: async () => [],
    contentRef: async () => null,
    ...over,
  };
}

describe("resolver service (HTTP + DoH)", () => {
  it("GET /health", async () => {
    const res = await buildApp(fake()).inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("GET /resolve/:name — 404 when unregistered, record JSON otherwise", async () => {
    const app = buildApp(fake({ resolve: async (n) => (n === "alex.chain" ? sampleRecord : null) }));
    expect((await app.inject({ method: "GET", url: "/resolve/nobody.sol" })).statusCode).toBe(404);
    const res = await app.inject({ method: "GET", url: "/resolve/alex.chain" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("alex.chain");
    expect(body.owner).toBe(OWNER);
    expect(body.hostingRef).toBe("ipfs://Qm");
    expect(body.records).toEqual([{ key: "address.SOL", value: "So1111" }]);
  });

  it("GET /reverse/:pubkey — name or 404", async () => {
    const ok = await buildApp(fake({ reverseLookup: async () => "alex.chain" })).inject({
      method: "GET",
      url: `/reverse/${OWNER}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().name).toBe("alex.chain");
    expect((await buildApp(fake()).inject({ method: "GET", url: `/reverse/${OWNER}` })).statusCode).toBe(404);
  });

  it("GET /dns-query — DoH JSON TXT answers", async () => {
    const app = buildApp(
      fake({ getRecords: async () => [{ key: "url", value: "https://alex.chain" }] as SolansRecord[] }),
    );
    const res = await app.inject({ method: "GET", url: "/dns-query?name=alex.chain&type=TXT" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.Status).toBe(0);
    expect(body.Answer[0].data).toBe("url=https://alex.chain");
    expect((await buildApp(fake()).inject({ method: "GET", url: "/dns-query?name=x.sol" })).json().Status).toBe(3);
  });
});

describe("hosting gateway (GET /site, §6)", () => {
  // A mock upstream fetcher that records the URL it was asked for.
  function spyFetcher(body = "<h1>hi</h1>", contentType = "text/html", status = 200) {
    const calls: string[] = [];
    const fetchContent: ContentFetcher = async (url) => {
      calls.push(url);
      return { status, contentType, body: new TextEncoder().encode(body) };
    };
    return { fetchContent, calls };
  }
  const gateways = { ipfs: "https://ipfs.example", arweave: "https://ar.example" };

  it("404 when the name has no hosted content", async () => {
    const app = buildApp(fake({ contentRef: async () => null }), spyFetcher());
    expect((await app.inject({ method: "GET", url: "/site/alex.sol" })).statusCode).toBe(404);
  });

  it("proxies an ipfs:// ref to the IPFS gateway, passing through status + content-type", async () => {
    const f = spyFetcher("<h1>home</h1>", "text/html", 200);
    const app = buildApp(fake({ contentRef: async () => "ipfs://QmCID" }), { fetchContent: f.fetchContent, gateways });
    const res = await app.inject({ method: "GET", url: "/site/alex.sol" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toBe("<h1>home</h1>");
    expect(f.calls[0]).toBe("https://ipfs.example/ipfs/QmCID");
  });

  it("proxies an ar:// ref to the Arweave gateway and forwards the sub-path", async () => {
    const f = spyFetcher("body{}", "text/css", 200);
    const app = buildApp(fake({ contentRef: async () => "ar://Tx123" }), { fetchContent: f.fetchContent, gateways });
    const res = await app.inject({ method: "GET", url: "/site/alex.sol/assets/style.css" });
    expect(res.statusCode).toBe(200);
    expect(f.calls[0]).toBe("https://ar.example/Tx123/assets/style.css");
  });

  it("422 on an unsupported ref, 502 when the upstream fetch fails", async () => {
    const bad = buildApp(fake({ contentRef: async () => "not-a-ref" }), { gateways });
    expect((await bad.inject({ method: "GET", url: "/site/alex.sol" })).statusCode).toBe(422);

    const throwing: ContentFetcher = async () => {
      throw new Error("network down");
    };
    const app = buildApp(fake({ contentRef: async () => "ipfs://QmCID" }), { fetchContent: throwing, gateways });
    expect((await app.inject({ method: "GET", url: "/site/alex.sol" })).statusCode).toBe(502);
  });
});

describe("resolver cache (§13)", () => {
  it("serves /resolve and /reverse from cache, refetching after TTL", async () => {
    let now = 1_000_000;
    const cache = new MemoryCache(() => now);
    let resolves = 0;
    let reverses = 0;
    const app = buildApp(
      fake({
        resolve: async () => {
          resolves++;
          return sampleRecord;
        },
        reverseLookup: async () => {
          reverses++;
          return "alex.chain";
        },
      }),
      { cache, cacheTtl: 30 },
    );

    await app.inject({ method: "GET", url: "/resolve/alex.chain" });
    await app.inject({ method: "GET", url: "/resolve/alex.chain" });
    expect(resolves).toBe(1); // 2nd hit cached
    now += 31_000; // past the 30s TTL
    await app.inject({ method: "GET", url: "/resolve/alex.chain" });
    expect(resolves).toBe(2);

    await app.inject({ method: "GET", url: `/reverse/${OWNER}` });
    await app.inject({ method: "GET", url: `/reverse/${OWNER}` });
    expect(reverses).toBe(1);
  });
});

describe("binary DoH (RFC 8484, application/dns-message)", () => {
  const recs = [{ key: "url", value: "https://alex.chain" }] as SolansRecord[];

  it("answers a POST binary query with TXT records (NOERROR)", async () => {
    const app = buildApp(fake({ getRecords: async () => recs }));
    const res = await app.inject({
      method: "POST",
      url: "/dns-query",
      headers: { "content-type": "application/dns-message" },
      payload: Buffer.from(encodeDohQuery("alex.chain")),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/dns-message");
    const decoded = decodeDohResponse(new Uint8Array(res.rawPayload));
    expect(decoded.rcode).toBe("NOERROR");
    expect(decoded.answers[0].data).toEqual(["url=https://alex.chain"]);
  });

  it("answers a GET ?dns=<base64url> query, and NXDOMAIN for no records", async () => {
    const app = buildApp(fake({ getRecords: async () => recs }));
    const dns = Buffer.from(encodeDohQuery("alex.chain")).toString("base64url");
    const ok = await app.inject({ method: "GET", url: `/dns-query?dns=${dns}` });
    expect(decodeDohResponse(new Uint8Array(ok.rawPayload)).answers[0].data).toEqual(["url=https://alex.chain"]);

    const empty = buildApp(fake({ getRecords: async () => [] }));
    const nx = await empty.inject({
      method: "POST",
      url: "/dns-query",
      headers: { "content-type": "application/dns-message" },
      payload: Buffer.from(encodeDohQuery("nobody.sol")),
    });
    expect(decodeDohResponse(new Uint8Array(nx.rawPayload)).rcode).toBe("NXDOMAIN");
  });

  it("still serves the JSON DoH variant (?name=)", async () => {
    const app = buildApp(fake({ getRecords: async () => recs }));
    const res = await app.inject({ method: "GET", url: "/dns-query?name=alex.chain&type=TXT" });
    expect(res.json().Answer[0].data).toBe("url=https://alex.chain");
  });
});

describe("metrics (§13 Prometheus)", () => {
  it("GET /metrics exposes per-route request counts, latency, and cache hit/miss", async () => {
    const app = buildApp(fake({ resolve: async () => sampleRecord }), { cache: new MemoryCache() });
    await app.inject({ method: "GET", url: "/resolve/alex.chain" }); // miss
    await app.inject({ method: "GET", url: "/resolve/alex.chain" }); // hit

    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain; version=0.0.4");
    const body = res.payload;
    // Route patterns (not concrete paths) keep cardinality bounded.
    expect(body).toMatch(/solans_http_requests_total\{[^}]*route="\/resolve\/:name"[^}]*\} 2/);
    expect(body).toContain('solans_resolver_cache_total{result="hit"} 1');
    expect(body).toContain('solans_resolver_cache_total{result="miss"} 1');
    expect(body).toContain("solans_http_request_duration_seconds_bucket");
    expect(body).toContain("solans_http_request_duration_seconds_count");
  });
});

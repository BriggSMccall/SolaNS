import { describe, expect, it } from "vitest";
import { address, none, some } from "@solana/kit";
import { buildApp, type ContentFetcher, type Resolver } from "solans-resolver";
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

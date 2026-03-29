import { describe, expect, it } from "vitest";
import { address, none, some } from "@solana/kit";
import { buildApp, type Resolver } from "solans-resolver";
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
  bump: 255,
} as unknown as NameRecord;

function fake(over: Partial<Resolver> = {}): Resolver {
  return { resolve: async () => null, reverseLookup: async () => null, getRecords: async () => [], ...over };
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

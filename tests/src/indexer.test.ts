import { describe, expect, it } from "vitest";
import { getAddressDecoder, getBase58Decoder, type Address } from "@solana/kit";
import {
  getRegisterNameInstructionDataEncoder,
  getRenewNameInstructionDataEncoder,
  getTransferNameInstructionDataEncoder,
  getWrapSubdomainInstructionDataEncoder,
  SOLANS_PROGRAM_ADDRESS,
} from "@solans/sdk";
import {
  applyEvent,
  buildApp,
  MemoryStore,
  metasFromAddresses,
  parseSolansInstruction,
  type IndexEvent,
  type RawInstruction,
} from "solans-indexer";

/** 12 distinct valid addresses; index i is positioned to match a parsed account slot. */
const addr = (i: number): Address => getAddressDecoder().decode(new Uint8Array(32).fill(i + 1));
const addrs = Array.from({ length: 12 }, (_, i) => addr(i));

function ix(data: Uint8Array, accounts = addrs): RawInstruction {
  return { programAddress: SOLANS_PROGRAM_ADDRESS, accounts: metasFromAddresses(accounts), data: new Uint8Array(data) };
}

describe("parseSolansInstruction (label recovery from ix data)", () => {
  it("decodes register_name → owner (acct 1) + nameRecord (acct 3) + label/tld/years", () => {
    const data = getRegisterNameInstructionDataEncoder().encode({
      name: "alex",
      tld: "sol",
      nameHash: new Uint8Array(32).fill(7),
      years: 2,
    });
    const ev = parseSolansInstruction(ix(new Uint8Array(data)));
    expect(ev).toMatchObject({
      kind: "register",
      name: "alex",
      tld: "sol",
      fullName: "alex.sol",
      years: 2,
      owner: addr(1),
      nameRecord: addr(3),
    });
  });

  it("decodes renew_name (nameRecord acct 2) and transfer_name (newOwner from data)", () => {
    const renew = parseSolansInstruction(
      ix(new Uint8Array(getRenewNameInstructionDataEncoder().encode({ name: "alex", tld: "sol", years: 1 }))),
    );
    expect(renew).toMatchObject({ kind: "renew", name: "alex", tld: "sol", years: 1, nameRecord: addr(2) });

    const transfer = parseSolansInstruction(
      ix(new Uint8Array(getTransferNameInstructionDataEncoder().encode({ newOwner: addr(9) }))),
    );
    expect(transfer).toMatchObject({ kind: "transfer", newOwner: addr(9), nameRecord: addr(1) });
  });

  it("decodes wrap_subdomain → label + parent (acct 2) + child nameRecord (acct 3)", () => {
    const ev = parseSolansInstruction(
      ix(new Uint8Array(getWrapSubdomainInstructionDataEncoder().encode({ label: "pay", nameHash: new Uint8Array(32) }))),
    );
    expect(ev).toMatchObject({ kind: "subdomain", label: "pay", parent: addr(2), nameRecord: addr(3) });
  });

  it("ignores non-SOLANS instructions", () => {
    const foreign: RawInstruction = { programAddress: addr(5), accounts: [], data: new Uint8Array([1, 2, 3]) };
    expect(parseSolansInstruction(foreign)).toBeNull();
  });
});

describe("applyEvent + MemoryStore", () => {
  const reg: IndexEvent = {
    kind: "register",
    nameRecord: addr(3),
    fullName: "alex.sol",
    name: "alex",
    tld: "sol",
    owner: addr(1),
    nameHash: "00",
    years: 2,
  };

  it("indexes a registration, extends on renew, follows transfer, and drops on burn", async () => {
    const store = new MemoryStore();
    await applyEvent(store, reg, { ts: 1000, sig: "s1", slot: 1 });
    const e = await store.getByName("alex.sol");
    expect(e?.owner).toBe(addr(1));
    expect(e?.expiresAt).toBe(1000 + 2 * 31_536_000);
    expect(await store.watchlist()).toEqual(["alex.sol"]);

    await applyEvent(store, { kind: "renew", nameRecord: addr(3), name: "alex", tld: "sol", years: 1 }, { ts: 2000 });
    expect((await store.getByName("alex.sol"))?.expiresAt).toBe(1000 + 3 * 31_536_000);

    await applyEvent(store, { kind: "transfer", nameRecord: addr(3), newOwner: addr(5) }, {});
    expect((await store.getByName("alex.sol"))?.owner).toBe(addr(5));
    expect((await store.byOwner(addr(5))).map((x) => x.fullName)).toEqual(["alex.sol"]);

    await applyEvent(store, { kind: "burn", nameRecord: addr(3) }, {});
    expect((await store.getByName("alex.sol"))?.active).toBe(false);
    expect(await store.search("alex")).toEqual([]); // inactive excluded
    expect(await store.watchlist()).toEqual([]);
  });

  it("tracks listings: list → /listings, then buy clears it + reassigns owner", async () => {
    const store = new MemoryStore();
    await applyEvent(store, reg, { ts: 1000 });
    await applyEvent(store, { kind: "list", nameRecord: addr(3), seller: addr(1), priceLamports: "1500000000" }, { ts: 1100 });
    let listed = await store.listings();
    expect(listed.map((e) => e.fullName)).toEqual(["alex.sol"]);
    expect(listed[0].listed?.priceLamports).toBe("1500000000");

    await applyEvent(store, { kind: "buy", nameRecord: addr(3), newOwner: addr(8) }, { ts: 1200 });
    expect(await store.listings()).toEqual([]); // no longer listed
    expect((await store.getByName("alex.sol"))?.owner).toBe(addr(8)); // buyer owns it

    // a fresh list then cancel
    await applyEvent(store, { kind: "list", nameRecord: addr(3), seller: addr(8), priceLamports: "2000000000" }, {});
    expect((await store.listings()).length).toBe(1);
    await applyEvent(store, { kind: "unlist", nameRecord: addr(3) }, {});
    expect(await store.listings()).toEqual([]);
  });

  it("builds a subdomain full name from its indexed parent", async () => {
    const store = new MemoryStore();
    await applyEvent(store, reg, { ts: 1000 });
    await applyEvent(
      store,
      { kind: "subdomain", nameRecord: addr(7), parent: addr(3), owner: addr(1), label: "pay", nameHash: "01" },
      { ts: 1500 },
    );
    const sub = await store.getByName("pay.alex.sol");
    expect(sub?.name).toBe("pay");
    expect(sub?.tld).toBe("sol");
    expect((await store.watchlist()).sort()).toEqual(["alex.sol", "pay.alex.sol"]);
  });
});

describe("indexer HTTP service", () => {
  /** A Helius-shaped webhook tx carrying a register_name instruction. */
  function heliusRegisterTx(name: string) {
    const data = getRegisterNameInstructionDataEncoder().encode({
      name,
      tld: "sol",
      nameHash: new Uint8Array(32),
      years: 1,
    });
    return {
      signature: "sig1",
      slot: 42,
      timestamp: 1_700_000_000,
      instructions: [
        {
          programId: SOLANS_PROGRAM_ADDRESS,
          accounts: addrs as string[],
          data: getBase58Decoder().decode(new Uint8Array(data)),
        },
      ],
    };
  }

  it("POST /webhook indexes, then /search, /watchlist, /name, /owner serve it", async () => {
    const app = buildApp();
    const hook = await app.inject({ method: "POST", url: "/webhook", payload: [heliusRegisterTx("alex")] });
    expect(hook.statusCode).toBe(200);
    expect(hook.json().indexed).toBe(1);

    const search = await app.inject({ method: "GET", url: "/search?q=al" });
    expect(search.json().results[0].fullName).toBe("alex.sol");

    expect((await app.inject({ method: "GET", url: "/watchlist" })).json().names).toEqual(["alex.sol"]);

    const name = await app.inject({ method: "GET", url: "/name/alex.sol" });
    expect(name.statusCode).toBe(200);
    expect(name.json().owner).toBe(addr(1));
    expect((await app.inject({ method: "GET", url: "/name/ghost.sol" })).statusCode).toBe(404);

    const owner = await app.inject({ method: "GET", url: `/owner/${addr(1)}` });
    expect(owner.json().names.map((n: { fullName: string }) => n.fullName)).toEqual(["alex.sol"]);
  });

  it("GET /search without ?q is 400; /health ok", async () => {
    const app = buildApp();
    expect((await app.inject({ method: "GET", url: "/search" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ ok: true });
  });

  it("GET /metrics exposes Prometheus event/batch/HTTP counters (§13)", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/webhook", payload: [heliusRegisterTx("alex")] });

    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain; version=0.0.4");
    const body = res.payload;
    expect(body).toContain('solans_index_events_total{type="register"} 1');
    expect(body).toContain("solans_webhook_batches_total 1");
    expect(body).toMatch(/solans_http_requests_total\{[^}]*route="\/webhook"[^}]*\} 1/);
  });
});

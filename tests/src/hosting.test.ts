import { describe, expect, it, vi } from "vitest";
import { hostingUrl, pinBytes } from "@solans/sdk";

describe("hostingUrl (§6 content-ref → gateway URL)", () => {
  it("maps ipfs:// (with optional path) to the IPFS gateway", () => {
    expect(hostingUrl("ipfs://QmCID")).toBe("https://ipfs.io/ipfs/QmCID");
    expect(hostingUrl("ipfs://QmCID/page.html")).toBe("https://ipfs.io/ipfs/QmCID/page.html");
  });

  it("maps ar:// to the Arweave gateway", () => {
    expect(hostingUrl("ar://Tx123")).toBe("https://arweave.net/Tx123");
  });

  it("passes http(s) URLs through", () => {
    expect(hostingUrl("https://example.com/site")).toBe("https://example.com/site");
  });

  it("appends a request sub-path (static-site assets)", () => {
    expect(hostingUrl("ipfs://QmCID", "assets/x.css")).toBe("https://ipfs.io/ipfs/QmCID/assets/x.css");
    expect(hostingUrl("ar://Tx", "/a/b")).toBe("https://arweave.net/Tx/a/b");
  });

  it("resolves bare CIDs and Arweave tx ids heuristically", () => {
    expect(hostingUrl("QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG")).toContain("/ipfs/Qm");
    const tx = "abcdefghij_klmnopqrst-uvwxyz0123456789ABCDE"; // 43 base64url chars
    expect(tx.length).toBe(43);
    expect(hostingUrl(tx)).toBe(`https://arweave.net/${tx}`);
  });

  it("honors custom gateways and rejects empty/unparseable refs", () => {
    expect(hostingUrl("ipfs://Q", "", { ipfs: "https://g", arweave: "https://a" })).toBe("https://g/ipfs/Q");
    expect(hostingUrl("")).toBeNull();
    expect(hostingUrl(null)).toBeNull();
    expect(hostingUrl("not a ref")).toBeNull();
  });
});

describe("pinBytes (Pinata IPFS pin, §13)", () => {
  it("POSTs to Pinata with the JWT and returns the CID", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ IpfsHash: "QmPinned" }), { status: 200 }));
    const cid = await pinBytes("jwt-token", new TextEncoder().encode("<h1>hi</h1>"), "index.html", fetcher as never);
    expect(cid).toBe("QmPinned");
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("pinFileToIPFS");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer jwt-token");
  });

  it("throws on a non-2xx Pinata response", async () => {
    const fetcher = vi.fn(async () => new Response("nope", { status: 401 }));
    await expect(pinBytes("bad", new Uint8Array(), "x", fetcher as never)).rejects.toThrow(/Pinata pin failed/);
  });
});

/**
 * Hosting-layer helpers (Technical Concept §6): turn a name's content reference
 * (`hosting_ref`, or the `content`/`url` records) into a fetchable HTTP URL on a
 * public IPFS/Arweave gateway. Pure + transport-free so it's trivially testable
 * and reused by the resolver `/site` gateway and the CLI.
 */

/** Public gateway bases used to serve IPFS / Arweave content. */
export interface Gateways {
  /** IPFS HTTP gateway base, e.g. `https://ipfs.io` (paths become `/ipfs/<CID>`). */
  ipfs: string;
  /** Arweave gateway base, e.g. `https://arweave.net` (paths become `/<TxId>`). */
  arweave: string;
}

export const DEFAULT_GATEWAYS: Gateways = {
  ipfs: "https://ipfs.io",
  arweave: "https://arweave.net",
};

const trimEnd = (s: string) => s.replace(/\/+$/, "");
const stripSlashes = (s: string) => s.replace(/^\/+|\/+$/g, "");

/**
 * Resolve a hosting reference to a fetchable HTTP(S) URL, optionally with a
 * request sub-path appended (for serving a static site's assets).
 *
 * Accepts `ipfs://<CID>[/path]`, `ar://<TxId>[/path]`, an `http(s)://` URL
 * (served as-is), or a **bare** CID / Arweave TxId (heuristic: a 43-char
 * base64url string is treated as Arweave, a `Qm…`/`bafy…` string as IPFS).
 * Returns `null` for an empty or unrecognizable ref.
 */
export function hostingUrl(
  ref: string | null | undefined,
  subPath = "",
  gateways: Gateways = DEFAULT_GATEWAYS,
): string | null {
  const r = ref?.trim();
  if (!r) return null;
  const sub = subPath ? "/" + stripSlashes(subPath) : "";

  if (/^https?:\/\//i.test(r)) return trimEnd(r) + sub;

  let m = /^ipfs:\/\/(.+)$/i.exec(r);
  if (m) return `${trimEnd(gateways.ipfs)}/ipfs/${stripSlashes(m[1])}${sub}`;

  m = /^ar:\/\/(.+)$/i.exec(r);
  if (m) return `${trimEnd(gateways.arweave)}/${stripSlashes(m[1])}${sub}`;

  // Bare references: Arweave tx ids are exactly 43 base64url chars; IPFS CIDs are
  // base58 `Qm…` (v0) or base32 `bafy…`/`bafk…` (v1).
  if (/^[A-Za-z0-9_-]{43}$/.test(r)) return `${trimEnd(gateways.arweave)}/${r}${sub}`;
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|ba[a-z2-7]{40,})$/.test(r))
    return `${trimEnd(gateways.ipfs)}/ipfs/${r}${sub}`;

  return null;
}

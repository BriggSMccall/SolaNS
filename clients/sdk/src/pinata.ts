/**
 * IPFS pinning via Pinata (Technical Concept §13 "IPFS via Pinata"). Auth is a
 * Pinata JWT (no on-chain funding needed). The `fetch` is injectable so the POST
 * is unit-testable without network or credentials.
 */

export type Fetcher = typeof fetch;

const PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";

/**
 * Pin raw bytes to IPFS as a single file; returns the resulting CID. Used by the
 * CLI `host-upload` (which reads the file off disk first). Throws on a non-2xx
 * Pinata response or a missing `IpfsHash`.
 */
export async function pinBytes(
  jwt: string,
  bytes: Uint8Array,
  filename = "index.html",
  fetcher: Fetcher = fetch,
): Promise<string> {
  const form = new FormData();
  // Uint8Array is a valid Blob part at runtime; the cast sidesteps a DOM-lib
  // ArrayBufferLike/ArrayBuffer strictness mismatch.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form.append("file", new Blob([bytes as any]), filename);
  const res = await fetcher(PINATA_PIN_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Pinata pin failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { IpfsHash?: string };
  if (!json.IpfsHash) throw new Error("Pinata response missing IpfsHash");
  return json.IpfsHash;
}

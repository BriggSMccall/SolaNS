// Generates parity fixtures for the Rust client from the program-pinned TS client.
// Run from repo root: node clients/rust/tests/gen-vectors.mjs
import {
  computeNameHash, computeSubdomainHash, findConfigPda, findNameRecordPda,
  getNameRecordEncoder, getConfigEncoder,
} from "../../ts/src/index.ts";

const hex = (u) => Buffer.from(u).toString("hex");
const h = computeNameHash("alex", "sol");
const sub = computeSubdomainHash(h, "pay");

// A representative NameRecord covering options, records, tld.
const owner = "2m5CoAk7ioZJbRYqHV9PJMNZN2gwpTPKQXR4GKyVifL7";
const nameRecord = {
  owner, controller: null, nameHash: new Uint8Array(h), tld: "sol",
  registeredAt: 1_700_000_000n, expiresAt: 1_900_000_000n,
  records: [{ key: "address.SOL", value: "So11111111111111111111111111111111111111112" }, { key: "url", value: "https://alex.sol" }],
  resolver: null, hostingRef: "ipfs://QmCID", transferLocked: false, reverseSet: true,
  nftMint: null, parent: null, parentRegisteredAt: 0n, depth: 0, listed: false, bump: 254,
};
const nrBytes = getNameRecordEncoder().encode(nameRecord);

console.log(JSON.stringify({
  name_hash_alex_sol: hex(h),
  subdomain_pay: hex(sub),
  config_pda: (await findConfigPda())[0],
  name_pda_alex_sol: (await findNameRecordPda({ nameHash: h }))[0],
  name_record_hex: hex(nrBytes),
}, null, 2));

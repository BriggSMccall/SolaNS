# SOLANS — Decentralized Name Service on Solana

An ENS-style name service for Solana: turn a wallet into a human-readable name
(`alex.sol`, `alex.chain`, `alex.web3`) with on-chain key→value records, reverse
lookup, **tradeable NFT names**, **subdomains** (`pay.alex.sol`), a **marketplace**
(fixed-price + offers + **`$SOLANS` auctions**), **`$SOLANS` staking + buyback-burn**,
**IPFS/Arweave website hosting**, an **on-chain CPI resolver**, a typed SDK, and an
HTTP/DoH resolver + hosting gateway. **Alpha, Beta, M2 (NFTs), M3 (subdomains),
M4 (marketplace), M5a (fee-split), M5b (staking), M5c (pay-in-`$SOLANS` + buyback),
M4c (English auctions), M6 (hosting layer), the §5.2 CPI resolver, and §6.2 auto-renew** are built and
tested (the on-chain core, CLI, `@solans/sdk`, resolver + `/site` gateway, Metaplex
tokenization, the subdomain tree, SOL-denominated P2P trading, the §8.2 fee
distribution, fee-share staking, the §8.1 deflation paths, §9.1 timed auctions, the
§6 hosting layer, and §5.2 on-chain composability).

- **Names are NFTs** (§6.1): registering mints a 1-of-1 Metaplex NFT **by default**
  (the CLI `register` composes register + `tokenize_name` in one transaction;
  `--no-nft` opts out), so a name trades on Magic Eden / Tensor immediately. The
  `NameRecord` PDA stays canonical (expiry/records live there) and the **NFT holder
  controls it** — a dynamic NFT refreshed on `update_record`. `redeem_name` unwraps
  back to direct PDA ownership; `transfer_name` moves an un-tokenized name.
- **Subdomains** (`pay.alex.sol`): the parent owner mints/revokes children
  (`wrap_subdomain`/`revoke_subdomain`). A subdomain hashes recursively on its
  parent (`keccak256(0x00 || parent_hash || label)`) and resolves only while its
  parent chain stays intact — a claimed or burned parent invalidates the subtree.
- **Marketplace** (`list_name`/`buy_name` + `make_offer`/`accept_offer` +
  `start_auction`/`bid`/`settle_auction`): non-custodial fixed-price listings in
  **SOL** (the seller keeps `owner`; a `listed` flag freezes the name),
  **SOL-escrowed offers** (any bidder escrows a bid; the owner accepts/rejects), and
  **English `$SOLANS` auctions** (timed, refund-on-outbid, 5-min anti-snipe
  auto-extend; settlement transfers the name, pays the seller, and burns the fee).
  `buy_name`/`accept_offer` pay seller + a protocol fee atomically and flip
  ownership. Premium pricing for ≤4-digit numeric names. Tokenized names trade as
  NFTs on Magic Eden/Tensor instead.
- **Payment** is an SPL-token (`transfer_checked`) fee with tiered pricing by name
  length stored in a config account (no oracle). Each fee is **split per spec §8.2**
  — **60% treasury / 25% `$SOLANS` stakers / 10% referral / 5% burn** (configurable
  bps; an optional `--referrer` claims the 10%, else it folds into treasury).
- **`$SOLANS` staking** (`stake`/`unstake`/`claim_rewards`): stake `$SOLANS` to
  earn the 25% staker fee share (paid in the payment mint), pro-rata by stake
  weight via MasterChef accumulated-reward-per-share accounting. `stake-init`
  creates the pool and points the §8.2 staker share at its reward vault.
- **`$SOLANS` deflation** (§8.1, oracle-free off one admin-set rate): pay a
  registration/renewal fee **in `$SOLANS` at a discount** (`register --pay-solans`)
  and it's burned on the spot; and a **permissionless buyback** (`buyback`) burns
  `$SOLANS` in exchange for the accumulated 5% burn-vault revenue (a Config-PDA
  escrow), so the burn share reduces supply.
- **Website hosting** (§6): point a name at IPFS/Arweave content
  (`set-hosting alex ipfs://CID`, or the `content` record) and the resolver's
  `GET /site/alex.sol` gateway serves it from a public IPFS/Arweave gateway.
  `host alex` shows the resolved URL; `host-upload` pins a file via Pinata. Hosting
  (and the resolver) are **dynamic-NFT attributes** — the NFT holder sets them on a
  tokenized name without redeeming.
- **On-chain composability** (§5.2): the `resolve` instruction lets any Solana
  program CPI-call SOLANS and read a name's owner (or a record) from `return_data`,
  so a marketplace/DeFi program can verify `alex.sol → pubkey` on-chain:
  ```rust
  // In a consumer Anchor program (Cargo: solans = { features = ["cpi"] }):
  solans::cpi::resolve(ctx, name_hash, None)?;          // None → owner; Some(key) → a record
  let owner = Pubkey::try_from(&get_return_data().unwrap().1[..32]).unwrap();
  ```
- **Auto-renew** (§6.2): approve the Config PDA as the SPL delegate of your payment
  account (`auto-renew-enable <amount>`), and a permissionless keeper can then
  `auto-renew` your names near expiry from those pre-approved funds — the name never
  lapses. Only allowed within 30 days of expiry; revoke anytime (`auto-renew-disable`).
- **Names** are lowercase ASCII `[a-z0-9-]` **or emoji** (§9.2 — emoji names cost
  2× the length tier) under `.sol` / `.chain` / `.web3`, NFKC-normalized
  client-side and hashed on-chain with **keccak256** (the ENS namehash) as the PDA
  key. Unicode *letters* are rejected on-chain (anti-homograph).

## Layout

```
programs/solans/      Anchor 1.0 program (Rust)
  src/state/          Config, NameRecord, ReverseRecord (PDA accounts)
  src/instructions/   40 instructions (one file each: core + NFT + subdomains + marketplace + staking + buyback + auctions + resolve/admin + auto-renew)
  src/utils.rs        name validation, keccak256 + recursive subdomain hashing, fee CPI, NFT auth
clients/ts/           @solans/client — Codama-generated typed client + name glue
  src/generated/      auto-generated from the IDL (do not edit)
  src/{normalize,hashName}.ts   tld-aware name rules mirroring the program
clients/sdk/          @solans/sdk — SolansClient: resolve / reverseLookup / getRecords
clients/rust/         solans-client (Rust) — name hashing + PDA derivation + account decode + resolve (§13)
cli/                  solans-cli — @solana/kit CLI driving every instruction
services/resolver/    Fastify resolver: HTTP + DoH (JSON + binary RFC-8484) + cache + /site + /metrics
services/keeper/      auto-renew + notification keeper (§6.2): watchlist -> auto_renew + webhook events
services/indexer/     §13 indexer: Helius webhook -> label recovery -> search / owner / watchlist
services/observability/ §13 monitoring: zero-dep Prometheus metrics lib (wired into the 3 services)
web/                  §10/§13 Next.js 14 landing site ("Identity Forge"): forge UI + live pricing
tests/                vitest + litesvm in-process tests (incl. clock-warp claim + NFT)
  fixtures/           mpl_token_metadata.so — committed mainnet dump for NFT tests
scripts/deploy-devnet.sh        one-shot deploy + smoke
scripts/smoke-nft.sh            localnet register -> tokenize -> redeem (CLI)
scripts/smoke-subdomain.sh      localnet register -> subdomain create/resolve/revoke (CLI)
scripts/smoke-marketplace.sh    localnet register -> list -> buy (two wallets, CLI)
scripts/smoke-offers.sh         localnet register -> offer -> accept (two wallets, CLI)
scripts/smoke-fee-split.sh      localnet register -> 60/25/10/5 fee split (§8.2)
scripts/smoke-staking.sh        localnet stake -> earn the 25% fee share -> claim
scripts/smoke-buyback.sh        localnet pay-in-$SOLANS (burn) + buyback-burn (§8.1)
scripts/smoke-auction.sh        localnet register -> auction -> bid -> outbid (§9.1)
scripts/smoke-hosting.sh        localnet register(NFT) -> set-hosting(tokenized) -> host URL (§6)
scripts/smoke-resolver-cpi.sh   localnet register -> resolve-cpi (return_data) -> admin rotation (§5.2)
scripts/smoke-auto-renew.sh     localnet register -> auto-renew-enable (approve) -> too-early -> disable (§6.2)
```

## Instructions

| Instruction | Auth | Notes |
|---|---|---|
| `init_config` | admin | price tiers, treasury, payment mint, grace, year bounds |
| `update_config` | admin | adjust price tiers / grace / year bounds after init |
| `register_name` | payer | validates name, charges tiered fee, creates the PDA |
| `renew_name` | anyone | extends expiry from `max(expires_at, now)` |
| `update_record` | owner **or** controller | set / delete one key→value record |
| `set_controller` | owner | assign / clear a manager delegate |
| `set_resolver` | owner **or** NFT holder | set / clear a custom resolver program (dynamic-NFT attribute) |
| `set_hosting` | owner / controller / NFT holder | set / clear the Arweave/IPFS content ref (dynamic-NFT attribute) |
| `transfer_name` | owner | blocked while `transfer_locked`; clears controller + reverse flag |
| `lock_transfer` | owner | toggle the transfer lock |
| `set_reverse` | owner | point `owner → name` (stores the human label) |
| `claim_expired` | anyone | take over a name past `expires_at + grace` |
| `burn_name` | owner | close the PDA, reclaim rent |
| `tokenize_name` | owner | mint a 1-of-1 Metaplex NFT for the name (top-level only) |
| `redeem_name` | NFT holder | burn the NFT, restore direct PDA ownership |
| `wrap_subdomain` | parent owner | create a subdomain (`pay.alex.sol`) under a name |
| `revoke_subdomain` | parent owner | close a subdomain and reclaim its rent |
| `list_name` | owner | list for sale at a fixed SOL price (freezes the name) |
| `update_listing` | seller | reprice / re-extend an active listing |
| `cancel_listing` | seller / anyone-if-expired | unlist and unfreeze the name |
| `buy_name` | buyer | pay seller + fee in SOL, take ownership atomically |
| `make_offer` | anyone | escrow a SOL bid on any name |
| `accept_offer` | owner | take the escrowed SOL (minus fee), give the bidder the name |
| `cancel_offer` | bidder / owner / anyone-if-expired | refund the bidder, close the offer |
| `init_stake_pool` | admin | create the `$SOLANS` staking pool; point the 25% staker share at it |
| `stake` | staker | deposit `$SOLANS` (settles pending reward first) |
| `unstake` | staker | withdraw `$SOLANS` + pending reward |
| `claim_rewards` | staker | claim the pending fee share (payment mint) |
| `init_burn_pool` | admin | create the Config-owned buyback burn vault; record the `$SOLANS` mint |
| `set_solans_params` | admin | set the §8.1 pay-in rate + discount |
| `register_with_solans` | payer | register paying the fee in `$SOLANS` at a discount (burned) |
| `renew_with_solans` | payer | renew paying the fee in `$SOLANS` at a discount (burned) |
| `buyback_burn` | anyone | burn `$SOLANS`, reimbursed from the burn vault at the inverse rate |
| `start_auction` | owner | open an English `$SOLANS` auction (freezes the name) |
| `bid` | anyone | bid `$SOLANS` (refunds the prior bidder; auto-extends near the close) |
| `settle_auction` | anyone | after close: transfer the name, pay the seller, burn the fee |
| `cancel_auction` | seller | cancel before any bid (unfreezes the name) |
| `resolve` | anyone | view: write owner / a record value to `return_data` (CPI-callable, §5.2) |
| `transfer_admin` | admin | rotate the config admin (e.g. to a multisig/DAO) |
| `auto_renew` | anyone (keeper) | extend a name near expiry from the owner's pre-approved delegation (§6.2) |

While a name is tokenized, `update_record` is authorized by **NFT holdership**
(dynamic NFT) and the structural instructions above (transfer / controller /
resolver / hosting / lock / reverse / burn) are rejected with `Tokenized` —
ownership moves by trading the NFT; redeem to regain direct control. While a name
is **listed**, all owner-gated mutations are likewise frozen (`Listed`) so the
seller can't change the asset out from under a buyer; `buy_name` or
`cancel_listing` unfreezes it.

PDAs: `Config = [b"config"]`, `NameRecord = [b"name", name_hash]`,
`ReverseRecord = [b"reverse", owner]`. A top-level `name_hash` is
`keccak256(name+"."+tld)`; a subdomain's is `keccak256(0x00 + parent_hash + label)`.

## Toolchain

Anchor 1.0.x · Solana CLI 3.1.x · Rust ≥1.89 · Node ≥20 · pnpm 9+. The JS side
uses `@solana/kit` 6.x with a Codama-generated client.

## Develop

```bash
pnpm install
NO_DNA=1 anchor build          # compile program + emit IDL (target/idl/solans.json)
pnpm generate                  # regenerate clients/ts/src/generated from the IDL
pnpm --filter solans-tests test  # litesvm test suite (fast, in-process)
```

The generated client is committed; CI should run `pnpm generate` and fail on a
non-empty `git diff` to catch IDL drift.

## Deploy + use

**Local validator:**
```bash
solana-test-validator --reset &                       # in another shell
solana program deploy target/deploy/solans.so \
  --program-id target/deploy/solans-keypair.json --url localhost
# create a payment mint + treasury (see scripts/deploy-devnet.sh), then:
pnpm --filter solans-cli exec tsx src/index.ts --cluster localnet init-config \
  --mint <MINT> --treasury <TREASURY>
```

**Devnet (one-shot):** `bash scripts/deploy-devnet.sh` (needs a funded devnet
wallet — fund at <https://faucet.solana.com> if the CLI airdrop is rate-limited).

**CLI** (`--cluster localnet|devnet|mainnet` or `--url <rpc>`, `--keypair <path>`):
```bash
solans register alex --years 1   # fee split 60/25/10/5; --referrer <ta> claims 10%
solans resolve alex
solans record set alex url https://alex.sol
solans set-reverse alex
solans reverse-lookup <PUBKEY>          # -> alex.sol (round-trip validated)
solans transfer alex <NEW_OWNER>
solans lock alex   /   solans lock alex --unlock
solans register alex.chain              # any of .sol / .chain / .web3
solans set-resolver alex <PROGRAM>   /   solans set-hosting alex ipfs://Qm...
solans tokenize alex   # mint the name as a tradeable NFT (info shows the mint)
solans redeem alex     # burn the NFT, restore direct ownership (NFT holder)
solans subdomain create alex pay        # -> pay.alex.sol (parent owner)
solans resolve pay.alex.sol   /   solans subdomain revoke alex pay
solans list alex 5 --days 30   # list for 5 SOL; solans buy alex (another wallet)
solans unlist alex   /   solans update-listing alex 7
solans offer alex 3            # bid 3 SOL; owner: solans accept-offer alex <bidder>
solans cancel-offer alex       # bidder/owner refund
solans info alex   /   solans renew alex   /   solans burn alex
solans update-config --price5 2000000   # admin only; only provided flags change
```
Run via `pnpm --filter solans-cli exec tsx src/index.ts <args>`. Every write
simulates before sending; pass `--simulate` to stop after simulation, `--json`
for machine-readable reads.

## SDK + resolver service

`@solans/sdk` wraps the generated client with a high-level read API:

```ts
import { createSolanaRpc } from "@solana/kit";
import { SolansClient } from "@solans/sdk";

const solans = SolansClient.fromRpc(createSolanaRpc("https://api.devnet.solana.com"));
await solans.resolve("alex.chain");          // -> NameRecord | null
await solans.reverseLookup(wallet);          // -> "alex.chain" | null (round-trip validated)
await solans.getAddress("alex.sol", "SOL");  // -> the stored address.SOL record
```

`services/resolver` is a Fastify service on the SDK — `pnpm --filter solans-resolver dev`
(set `SOLANS_RPC_URL`), then `GET /resolve/:name`, `GET /reverse/:pubkey`, the
`/site/:name` hosting gateway, and DoH at `/dns-query` in **both** flavours: JSON
(`?name=alex.sol&type=TXT`) and **binary RFC 8484** (`application/dns-message`, e.g.
`curl -H 'content-type: application/dns-message' --data-binary @query.bin .../dns-query`).
Reads go through an in-process cache (`RESOLVER_CACHE_TTL`, Redis-pluggable via the
`Cache` interface). A Dockerfile is included.

`services/keeper` is the off-chain service that actually *runs* auto-renew (§6.2):
`pnpm --filter solans-keeper start` with `SOLANS_RPC_URL`, a `KEEPER_KEYPAIR`, and a
`WATCHLIST` (or `WATCHLIST_FILE` — a JSON array of names). Each sweep resolves every
watched name and, if it's within 30 days of expiry **and** the owner has delegated ≥
the renewal fee to the Config PDA (via `auto-renew-enable`), renews it from those
pre-approved funds; otherwise it emits a lifecycle event (`renewed` / `no-delegation`
/ `expiring-soon` / `renewal-failed`) to the console and an optional `NOTIFY_WEBHOOK_URL`
(Telegram/Dialect plug in behind the same `Notifier` interface). It's permissionless —
the keeper pays only the tx fee. It's **watchlist-driven** because a `NameRecord` stores
the name *hash*, not the label, and `auto_renew` needs the plaintext label; an indexer
that logs labels from registration events can feed the watchlist. A Dockerfile is included.

`services/indexer` is that indexer (§13): `pnpm --filter solans-indexer start`. It
recovers the plaintext **labels** the on-chain account hides — a `NameRecord` stores the
name hash, but the **instruction data** carries the label — by decoding SOLANS
transactions delivered by a **Helius webhook** to `POST /webhook` (with the
program-pinned generated decoders, so it never drifts), then serves `GET /search?q=`,
`/owner/:pubkey`, `/name/:name`, and `/watchlist` (which feeds the keeper's `WATCHLIST`).
The webhook receiver + decode + store are tested in-repo (`fastify.inject`); registering
the live Helius webhook is an external step. `MemoryStore` is the reference; implement the
async `IndexStore` for a persistent backend. A Dockerfile is included.

`services/observability` (`@solans/observability`) is a zero-dependency Prometheus
instrumentation lib (§13 "Monitoring: Grafana + Prometheus + PagerDuty"). The resolver
and indexer expose `GET /metrics` (per-route request counts + a latency histogram, plus
the resolver's cache hit/miss and the indexer's events-by-type / webhook-batch counters);
the keeper serves `/metrics` on `KEEPER_METRICS_PORT` when set (its metrics sink is just
another `Notifier`). Point a Prometheus scrape at those endpoints; Grafana dashboards and
PagerDuty alert routes are deployment-time config on top.

`web` is the §10/§13 **Next.js 14** landing site — a faithful build of the "SOLANS
Identity Forge" design (chrome-metallic, canvas particle background, the cold-key→name
"forge" animation). `pnpm --filter web dev`. The pricing calculator computes live quotes
with the SDK's `priceForLabel` (real §9.2 tiers) and the fee-split section shows the real
§8.2 **60/25/10/5**; the hero search resolves availability against `@solans/sdk` when
`NEXT_PUBLIC_SOLANS_RPC_URL` is set, falling back to the demo otherwise. Wallet writes
(register/manage/marketplace) are the staged Stage-2 continuation — see `web/README.md`.

## Security notes

- The program never trusts a client hash: `register_name` re-derives
  `keccak256(name+"."+tld)` on-chain and asserts it equals the supplied `name_hash`
  used as the PDA seed; names are validated to lowercase ASCII `[a-z0-9-]` or
  curated emoji — Unicode **letters are rejected on-chain** (the homograph vector),
  with NFKC normalization client-side (§11.1). The **PDA-parity** test proves
  client≡program.
- All arithmetic is checked; auth is enforced via Anchor `has_one` (owner-only)
  or an in-handler `owner || controller` check; payment uses
  `transfer_checked` (Token-2022-safe) into a config-validated treasury.
- Reverse records are best-effort: resolvers must round-trip validate
  (`reverse.owner == name.owner`), which the CLI/tests do.
- **Hardening (§M8)**: the program is **reproducibly buildable** —
  `bash scripts/verify-build.sh` (solana-verify) builds `solans.so` byte-for-byte and
  prints its sha256, so the deployed bytecode can be verified against source
  (`verify-from-repo`). `Config.admin` is rotatable (`transfer_admin`) but can only
  tune economic params (`update_config`); `payment_mint` / treasury / staking+burn
  vaults are immutable and admin can't touch user names or escrowed funds (markets are
  non-custodial). The authority handoff (deployer → 3/5 Squads multisig → Realms DAO
  with a 7-day timelock) is in [docs/GOVERNANCE.md](docs/GOVERNANCE.md); disclosure
  policy in [SECURITY.md](SECURITY.md).

## Deferred (fast-follows)

English auctions (5-min auto-extend) · `$SOLANS` token + fee-split + governance ·
tradeable/reverse subdomains · binary RFC-8484 DoH · Web UI · Arweave/IPFS hosting
service · Unicode/emoji names (+ emoji premium) · dynamic record realloc.

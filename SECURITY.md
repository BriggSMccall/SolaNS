# Security Policy

## Reporting a vulnerability

If you discover a security issue in the SOLANS program, clients, or services,
**please do not open a public issue**. Disclose privately so we can ship a fix
before details are public.

- **Email:** security@solans.example (PGP key on request)
- **Backup:** a DM to the maintainers listed in `git log` on the `main` branch.

Please include:

- a description of the issue and its impact,
- the affected component (program / client / service) and version/commit,
- a proof-of-concept or reproduction steps if you have one.

We aim to acknowledge a report within **48 hours** and to provide a remediation
timeline within **5 business days**. We support responsible disclosure and are
happy to credit reporters once a fix is deployed.

## Scope

In scope:

- the on-chain program (`programs/solans`),
- the generated/handwritten clients (`clients/*`),
- the off-chain services (`services/*`).

Out of scope: third-party dependencies (report upstream), social engineering,
and issues that require a compromised admin / keeper key.

## On-chain security model

- **No trusted client input.** `register_name` (and every register/renew path)
  re-derives `keccak256(name + "." + tld)` on-chain and asserts it equals the
  supplied `name_hash` used as the PDA seed. Names are validated to lowercase
  ASCII `[a-z0-9-]` or a curated emoji set; Unicode **letters are rejected
  on-chain** (the homograph vector). A PDA-parity test proves client ≡ program.
- **Checked arithmetic everywhere** (`overflow-checks = true` in release), auth
  via Anchor `has_one` / explicit owner-or-controller checks, and Token-2022-safe
  `transfer_checked` into config-validated treasury/staking/burn accounts.
- **Non-custodial markets.** Listings, offers, and auctions never let the
  protocol move a user's name or funds outside the documented swap; the admin
  can only tune economic parameters (`update_config` / `set_solans_params`) and
  cannot touch user names or escrowed funds.
- **Reproducible builds.** `bash scripts/verify-build.sh` (solana-verify) builds
  `solans.so` byte-for-byte and prints its sha256, so the deployed bytecode can be
  verified against this source tree.

## Known limitations (by design)

- **On-chain `resolve` is leaf-only.** The CPI resolver validates the requested
  record's own expiry but does **not** walk a subdomain's parent chain on-chain;
  full parent-chain validation (including parent expiry) is performed by the SDK /
  keeper off-chain. CPI consumers that resolve subdomains must validate the parent
  chain themselves.
- **`auto_renew` is permissionless and fixed-term.** A keeper can only extend a
  name by **exactly one year** and only within `RENEWAL_WINDOW_SECONDS` of expiry,
  charging the owner's pre-approved SPL delegation to the Config PDA. The owner's
  approval amount is the hard cap on what any keeper can ever pull.
- **`$SOLANS` rate is admin-set (no oracle).** `buyback_burn` reimburses keepers
  out of the burn vault at `Config.solans_rate`; the admin must keep the rate at
  or above market or the burn vault can be drained at a discount. This is monitored
  operationally — see `docs/GOVERNANCE.md`.

## Pre-mainnet checklist

See `docs/GOVERNANCE.md` for the authority-handoff and launch runbook, including
the required external audit, program-id rotation, and upgrade-authority transfer
to a multisig.

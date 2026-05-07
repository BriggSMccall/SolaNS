//! Parity + behaviour tests for `solans-client`.
//!
//! Hashing / PDA / account-layout vectors are emitted by the program-pinned TS
//! client (`tests/gen-vectors.mjs`) — matching them ⇒ matching the on-chain program
//! transitively (the TS client is Codama-from-IDL + the `register.test.ts`
//! PDA-parity test). Regenerate on an IDL change with:
//!   `node clients/rust/tests/gen-vectors.mjs`
use borsh::BorshSerialize;
use solana_program::pubkey::Pubkey;
use solans_client::*;
use std::collections::HashMap;
use std::str::FromStr;

// --- fixtures from tests/gen-vectors.mjs -------------------------------------
const NAME_HASH_ALEX_SOL: &str = "3e7fc65b23218f708eb5f8e09c2053122fc177d0c4dc334a280109f8735a8380";
const SUBDOMAIN_PAY: &str = "e1f490d82dcf988b54cd25e907a16f0a8c0bea3f6ccbb108d17d47044522393e";
const CONFIG_PDA: &str = "9hD6SDxR5YJ7cKe6ThKfVETMMGm4YP47PMgaCjp1ofBA";
const NAME_PDA_ALEX_SOL: &str = "Dmq5C3WvEdWoQXdjKMjBNdYEbMR6YZhjGdQ7okCepHxs";
const OWNER: &str = "2m5CoAk7ioZJbRYqHV9PJMNZN2gwpTPKQXR4GKyVifL7";
const NAME_RECORD_HEX: &str = "fe1611a1e531ee691a25fecc1918dd49c837697a9b70717d8f984c398f15beaebc8a54ad4b8f61d4003e7fc65b23218f708eb5f8e09c2053122fc177d0c4dc334a280109f8735a838003000000736f6c00f153650000000000b33f7100000000020000000b000000616464726573732e534f4c2b000000536f31313131313131313131313131313131313131313131313131313131313131313131313131313131320300000075726c1000000068747470733a2f2f616c65782e736f6c00010c000000697066733a2f2f516d4349440001000000000000000000000000fe";

/// The `NameRecord` Anchor discriminator (first 8 bytes of the TS-encoded blob).
const NAME_DISC: [u8; 8] = [0xfe, 0x16, 0x11, 0xa1, 0xe5, 0x31, 0xee, 0x69];

fn hexb(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn h32(s: &str) -> [u8; 32] {
    hexb(s).try_into().unwrap()
}

// -----------------------------------------------------------------------------

#[test]
fn hashing_matches_ts() {
    assert_eq!(name_hash("alex", "sol"), h32(NAME_HASH_ALEX_SOL));
    let h = name_hash("alex", "sol");
    assert_eq!(subdomain_hash(&h, "pay"), h32(SUBDOMAIN_PAY));
    // Dotted-path folding (root-first).
    assert_eq!(name_hash_for_path("alex.sol"), h);
    assert_eq!(name_hash_for_path("pay.alex.sol"), h32(SUBDOMAIN_PAY));
    // Two-level: pay.alex.sol then one more label.
    let two = subdomain_hash(&h32(SUBDOMAIN_PAY), "www");
    assert_eq!(name_hash_for_path("www.pay.alex.sol"), two);
}

#[test]
fn pdas_match_ts() {
    assert_eq!(find_config().0, Pubkey::from_str(CONFIG_PDA).unwrap());
    assert_eq!(
        find_name_record(&name_hash("alex", "sol")).0,
        Pubkey::from_str(NAME_PDA_ALEX_SOL).unwrap()
    );
}

#[test]
fn decodes_name_record_from_ts() {
    let nr = NameRecord::try_decode(&hexb(NAME_RECORD_HEX)).unwrap();
    assert_eq!(nr.owner(), Pubkey::from_str(OWNER).unwrap());
    assert_eq!(nr.name_hash, name_hash("alex", "sol"));
    assert_eq!(nr.tld, "sol");
    assert_eq!(nr.registered_at, 1_700_000_000);
    assert_eq!(nr.expires_at, 1_900_000_000);
    assert_eq!(nr.records.len(), 2);
    assert_eq!(nr.records[0].key, "address.SOL");
    assert_eq!(nr.records[1].value, "https://alex.sol");
    assert_eq!(nr.hosting_ref.as_deref(), Some("ipfs://QmCID"));
    assert!(nr.reverse_set);
    assert!(!nr.transfer_locked);
    assert!(!nr.listed);
    assert!(!nr.tokenized());
    assert_eq!(nr.depth, 0);
    assert_eq!(nr.bump, 254);
}

#[test]
fn trailing_padding_is_ignored() {
    // Real on-chain accounts are max-allocated → zero-padded past the borsh payload.
    let mut padded = hexb(NAME_RECORD_HEX);
    padded.resize(padded.len() + 128, 0u8);
    let nr = NameRecord::try_decode(&padded).unwrap();
    assert_eq!(nr.bump, 254);
    assert_eq!(nr.records.len(), 2);
}

#[test]
fn too_short_errors() {
    assert!(matches!(
        NameRecord::try_decode(&[0u8; 4]),
        Err(Error::TooShort)
    ));
}

// --- resolve over an in-memory fetcher ---------------------------------------

fn acct<T: BorshSerialize>(disc: &[u8; 8], v: &T) -> Vec<u8> {
    let mut b = disc.to_vec();
    v.serialize(&mut b).unwrap();
    b
}

fn mk_name(
    owner: [u8; 32],
    registered_at: i64,
    parent: Option<[u8; 32]>,
    parent_registered_at: i64,
) -> NameRecord {
    NameRecord {
        owner,
        controller: None,
        name_hash: [0u8; 32],
        tld: "sol".into(),
        registered_at,
        expires_at: registered_at + 31_536_000,
        records: vec![Record {
            key: "address.SOL".into(),
            value: "So1111".into(),
        }],
        resolver: None,
        hosting_ref: None,
        transfer_locked: false,
        reverse_set: false,
        nft_mint: None,
        parent,
        parent_registered_at,
        depth: if parent.is_some() { 1 } else { 0 },
        listed: false,
        bump: 255,
    }
}

#[test]
fn resolve_top_level_and_records() {
    let parent_pda = find_name_record(&name_hash("alex", "sol")).0;
    let rec = mk_name([7u8; 32], 1000, None, 0);
    let mut map = HashMap::new();
    map.insert(parent_pda, acct(&NAME_DISC, &rec));
    let client = SolansClient::new(move |a: &Pubkey| map.get(a).cloned());

    assert!(client.resolve("alex.sol").is_some());
    assert_eq!(
        client.get_address("alex.sol", "SOL").as_deref(),
        Some("So1111")
    );
    assert!(client.resolve("ghost.sol").is_none());
}

#[test]
fn resolve_walks_parent_chain_and_rejects_stale() {
    let parent_hash = name_hash("alex", "sol");
    let parent_pda = find_name_record(&parent_hash).0;
    let child_pda = find_name_record(&subdomain_hash(&parent_hash, "pay")).0;

    let parent = mk_name([1u8; 32], 1000, None, 0);
    let child = mk_name([1u8; 32], 2000, Some(parent_pda.to_bytes()), 1000);

    // Healthy chain → resolves.
    let mut ok = HashMap::new();
    ok.insert(parent_pda, acct(&NAME_DISC, &parent));
    ok.insert(child_pda, acct(&NAME_DISC, &child));
    let client = SolansClient::new(move |a: &Pubkey| ok.get(a).cloned());
    assert!(client.resolve("pay.alex.sol").is_some());

    // Parent re-registered (registered_at changed) → stale subtree → None.
    let stale_parent = mk_name([1u8; 32], 1500, None, 0);
    let mut stale = HashMap::new();
    stale.insert(parent_pda, acct(&NAME_DISC, &stale_parent));
    stale.insert(child_pda, acct(&NAME_DISC, &child));
    let c2 = SolansClient::new(move |a: &Pubkey| stale.get(a).cloned());
    assert!(c2.resolve("pay.alex.sol").is_none());

    // Parent burned (missing) → None.
    let mut orphan = HashMap::new();
    orphan.insert(child_pda, acct(&NAME_DISC, &child));
    let c3 = SolansClient::new(move |a: &Pubkey| orphan.get(a).cloned());
    assert!(c3.resolve("pay.alex.sol").is_none());
}

#[test]
fn reverse_lookup_round_trip_and_stale() {
    let owner = Pubkey::from_str(OWNER).unwrap();
    let name_hash_alex = name_hash("alex", "sol");
    let rpda = find_reverse(&owner).0;
    let npda = find_name_record(&name_hash_alex).0;

    let rev = ReverseRecord {
        owner: owner.to_bytes(),
        name_hash: name_hash_alex,
        name: "alex".into(),
        tld: "sol".into(),
        bump: 255,
    };
    // Anchor discriminator value is irrelevant to decode (we skip 8 bytes).
    let rev_bytes = acct(&[0u8; 8], &rev);

    // Forward record owned by the same wallet → round-trips.
    let fwd = mk_name(owner.to_bytes(), 1000, None, 0);
    let mut map = HashMap::new();
    map.insert(rpda, rev_bytes.clone());
    map.insert(npda, acct(&NAME_DISC, &fwd));
    let client = SolansClient::new(move |a: &Pubkey| map.get(a).cloned());
    assert_eq!(client.reverse_lookup(&owner).as_deref(), Some("alex.sol"));

    // Forward record owned by someone else → stale → None.
    let other = mk_name([9u8; 32], 1000, None, 0);
    let mut map2 = HashMap::new();
    map2.insert(rpda, rev_bytes);
    map2.insert(npda, acct(&NAME_DISC, &other));
    let c2 = SolansClient::new(move |a: &Pubkey| map2.get(a).cloned());
    assert!(c2.reverse_lookup(&owner).is_none());
}

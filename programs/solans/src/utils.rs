use crate::constants::*;
use crate::error::SolansError;
use crate::state::{Config, NameRecord};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    self, Burn, CloseAccount, Mint, TokenAccount, TokenInterface, TransferChecked,
};
use solana_keccak_hasher::hashv;

/// Whether `signer` may perform record-level operations on `nr`.
///
/// - **Tokenized** (`nft_mint == Some`): authority is whoever *holds* the NFT.
///   Holdership is proven by `nft_token_account` (its mint matches `nft_mint`,
///   its owner is the signer, and it holds the single token). The `owner` field
///   is intentionally ignored — it may be stale once the NFT trades on a market.
/// - **Not tokenized**: authority is the recorded `owner`.
pub fn name_authority_ok(
    nr: &NameRecord,
    signer: &Pubkey,
    nft_token_account: Option<&InterfaceAccount<TokenAccount>>,
) -> bool {
    match nr.nft_mint {
        Some(mint) => nft_token_account.is_some_and(|ta| {
            ta.mint == mint && ta.owner == *signer && ta.amount == 1
        }),
        None => nr.owner == *signer,
    }
}

/// An allowed emoji / pictograph code point (§9.2 "emoji names"). Unicode *letters*
/// stay banned on-chain — they're the homograph vector (Cyrillic `а` vs Latin `a`),
/// and §11.1's NFKC + confusables normalization runs client-side. Emoji are visually
/// distinct from ASCII letters, so allowing them adds the §9.2 category without
/// re-opening homograph attacks. The TS `normalize.ts` mirrors these ranges exactly.
pub fn is_emoji_char(c: char) -> bool {
    matches!(c as u32,
        0x1F300..=0x1FAFF   // emoticons, symbols & pictographs, transport, ext-A …
        | 0x2600..=0x27BF   // misc symbols + dingbats
        | 0x1F1E6..=0x1F1FF // regional indicators (flags)
        | 0x2300..=0x23FF   // misc technical (⌚ ⏰ …)
        | 0x2B00..=0x2BFF   // misc symbols and arrows (⭐ …)
        | 0x200D            // zero-width joiner (emoji sequences)
        | 0x20E3            // combining enclosing keycap
        | 0xFE0F            // variation selector-16
    )
}

/// Validate a name's canonical form: each char is lowercase ASCII `[a-z0-9-]` **or**
/// an allowed emoji (§9.2); length 1..=63 **bytes** (DNS cap); no leading/trailing/
/// double hyphen. The client already lowercased + NFKC-normalized + banned
/// confusables (§11.1) — on-chain we trust that, and additionally keep Unicode
/// letters out so no homograph can ever be registered.
pub fn validate_name(name: &str) -> Result<()> {
    let len = name.as_bytes().len();
    require!(
        len >= NAME_MIN_LEN && len <= NAME_MAX_LEN,
        SolansError::InvalidNameLength
    );

    let mut first: Option<char> = None;
    let mut last = '\0';
    let mut prev_hyphen = false;
    for c in name.chars() {
        if first.is_none() {
            first = Some(c);
        }
        last = c;
        require!(
            matches!(c, 'a'..='z' | '0'..='9' | '-') || is_emoji_char(c),
            SolansError::InvalidNameCharacter
        );
        if c == '-' {
            require!(!prev_hyphen, SolansError::InvalidNameHyphen);
            prev_hyphen = true;
        } else {
            prev_hyphen = false;
        }
    }
    let first = first.ok_or_else(|| error!(SolansError::InvalidNameLength))?;
    require!(first != '-' && last != '-', SolansError::InvalidNameHyphen);
    Ok(())
}

/// Validate the TLD against the program allowlist.
pub fn validate_tld(tld: &str) -> Result<()> {
    require!(ALLOWED_TLDS.contains(&tld), SolansError::InvalidTld);
    Ok(())
}

/// Canonical name hash: `keccak256(name + "." + tld)` (spec §2.1, the ENS
/// namehash convention). Computed on-chain so the program never trusts a
/// client-supplied hash. The client mirrors this exactly (`@noble/hashes` keccak_256
/// over the same UTF-8 bytes).
pub fn compute_name_hash(name: &str, tld: &str) -> [u8; 32] {
    hashv(&[name.as_bytes(), b".", tld.as_bytes()]).to_bytes()
}

/// Canonical subdomain hash: `keccak256(0x00 || parent_hash || label)`. Recursive on
/// the parent's hash so the program never needs the parent's full string. The
/// `0x00` separator makes this preimage space disjoint from top-level names
/// (whose preimages always start with `[a-z0-9]`), so PDAs can never collide
/// across schemes or depths. Mirrored byte-for-byte by the client.
pub fn compute_subdomain_hash(parent_hash: &[u8; 32], label: &str) -> [u8; 32] {
    hashv(&[&[0u8], parent_hash.as_ref(), label.as_bytes()]).to_bytes()
}

/// Move `amount` lamports from a **program-owned** account to another (checked).
/// Used to pay out an Offer PDA's SOL escrow; `from` must be owned by this
/// program so the runtime permits the debit.
pub fn move_lamports(from: &AccountInfo, to: &AccountInfo, amount: u64) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let from_balance = from.lamports();
    let to_balance = to.lamports();
    **from.try_borrow_mut_lamports()? = from_balance
        .checked_sub(amount)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    **to.try_borrow_mut_lamports()? = to_balance
        .checked_add(amount)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    Ok(())
}

/// Validate a registration term against config bounds.
pub fn validate_years(years: u16, min_years: u16, max_years: u16) -> Result<()> {
    require!(
        years >= min_years && years <= max_years,
        SolansError::InvalidYears
    );
    Ok(())
}

/// Convert a registration term in years to seconds (checked).
pub fn years_to_secs(years: u16) -> Result<i64> {
    (years as i64)
        .checked_mul(SECONDS_PER_YEAR)
        .ok_or_else(|| error!(SolansError::MathOverflow))
}

/// A single Token-2022-safe `transfer_checked` of `amount` from `from` to `to`,
/// signed by a wallet `authority` (no-op when `amount == 0`). Works for SPL Token
/// and Token-2022 via the token interface. `CpiContext::new` takes the program id
/// (Pubkey) in 1.0.2.
pub fn transfer_tokens<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let cpi_accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    token_interface::transfer_checked(
        CpiContext::new(token_program.key(), cpi_accounts),
        amount,
        mint.decimals,
    )?;
    Ok(())
}

/// Like [`transfer_tokens`] but signed by a **PDA** `authority` (`signer_seeds`),
/// e.g. paying staking rewards or returning stake out of a pool-owned vault.
#[allow(clippy::too_many_arguments)]
pub fn transfer_tokens_signed<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let cpi_accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.clone(),
    };
    token_interface::transfer_checked(
        CpiContext::new_with_signer(token_program.key(), cpi_accounts, signer_seeds),
        amount,
        mint.decimals,
    )?;
    Ok(())
}

/// Burn `amount` tokens from a wallet-owned `from` account (no-op when `amount ==
/// 0`). Used by the §8.1 pay-in-`$SOLANS` paths and the buyback keeper to reduce
/// `$SOLANS` supply. The `authority` signs for its own account (no PDA).
pub fn burn_tokens<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let cpi_accounts = Burn {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        authority: authority.to_account_info(),
    };
    token_interface::burn(CpiContext::new(token_program.key(), cpi_accounts), amount)?;
    Ok(())
}

/// Like [`burn_tokens`] but signed by a **PDA** `authority` (`signer_seeds`), e.g.
/// burning the auction marketplace fee out of a pool-owned vault (no-op on 0).
pub fn burn_tokens_signed<'info>(
    token_program: &Interface<'info, TokenInterface>,
    mint: &InterfaceAccount<'info, Mint>,
    from: &InterfaceAccount<'info, TokenAccount>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let cpi_accounts = Burn {
        mint: mint.to_account_info(),
        from: from.to_account_info(),
        authority: authority.clone(),
    };
    token_interface::burn(
        CpiContext::new_with_signer(token_program.key(), cpi_accounts, signer_seeds),
        amount,
    )?;
    Ok(())
}

/// Close a **PDA-owned** token account, sending its rent lamports to `destination`.
/// The account must be empty (drain it first). The PDA `authority` signs.
pub fn close_token_account<'info>(
    token_program: &Interface<'info, TokenInterface>,
    account: &InterfaceAccount<'info, TokenAccount>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let cpi_accounts = CloseAccount {
        account: account.to_account_info(),
        destination: destination.clone(),
        authority: authority.clone(),
    };
    token_interface::close_account(CpiContext::new_with_signer(
        token_program.key(),
        cpi_accounts,
        signer_seeds,
    ))?;
    Ok(())
}

/// Initialize a freshly `init`-ed top-level `NameRecord` (shared by the USDC and
/// pay-in-`$SOLANS` register paths so the two stay byte-for-byte identical).
pub fn init_top_level_record(
    nr: &mut NameRecord,
    owner: Pubkey,
    name_hash: [u8; 32],
    tld: String,
    now: i64,
    expires_at: i64,
    bump: u8,
) {
    nr.owner = owner;
    nr.controller = None;
    nr.name_hash = name_hash;
    nr.tld = tld;
    nr.registered_at = now;
    nr.expires_at = expires_at;
    nr.records = Vec::new();
    nr.resolver = None;
    nr.hosting_ref = None;
    nr.transfer_locked = false;
    nr.reverse_set = false;
    nr.nft_mint = None;
    nr.parent = None;
    nr.parent_registered_at = 0;
    nr.depth = 0;
    nr.listed = false;
    nr.bump = bump;
}

/// Charge `amount` from the payer and distribute it per the §8.2 fee split:
/// treasury / `$SOLANS` stakers / referral / burn (all in the payment mint). The
/// referral share folds into treasury when no `referral` account is given. One
/// signed payment fanned out into up to four `transfer_checked` CPIs.
#[allow(clippy::too_many_arguments)]
pub fn distribute_fee<'info>(
    token_program: &Interface<'info, TokenInterface>,
    payer_token_account: &InterfaceAccount<'info, TokenAccount>,
    treasury: &InterfaceAccount<'info, TokenAccount>,
    staking_vault: &InterfaceAccount<'info, TokenAccount>,
    burn_vault: &InterfaceAccount<'info, TokenAccount>,
    referral: Option<&InterfaceAccount<'info, TokenAccount>>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &Signer<'info>,
    amount: u64,
    config: &Config,
) -> Result<()> {
    let (mut treasury_share, staking_share, referral_share, burn_share) = config.fee_split(amount);

    transfer_tokens(token_program, payer_token_account, staking_vault, mint, authority, staking_share)?;
    transfer_tokens(token_program, payer_token_account, burn_vault, mint, authority, burn_share)?;
    match referral {
        Some(r) => {
            transfer_tokens(token_program, payer_token_account, r, mint, authority, referral_share)?
        }
        // No referrer: the referral share goes to the treasury.
        None => {
            treasury_share = treasury_share
                .checked_add(referral_share)
                .ok_or_else(|| error!(SolansError::MathOverflow))?
        }
    }
    transfer_tokens(token_program, payer_token_account, treasury, mint, authority, treasury_share)?;
    Ok(())
}

/// Like [`distribute_fee`] but the source transfer is authorized by a **PDA
/// delegate** (`authority` + `signer_seeds`) rather than a `Signer` — used by
/// `auto_renew`, where the Config PDA is the SPL delegate of the owner's account.
/// Always referrer-less (the referral share folds into treasury).
#[allow(clippy::too_many_arguments)]
pub fn distribute_fee_signed<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    treasury: &InterfaceAccount<'info, TokenAccount>,
    staking_vault: &InterfaceAccount<'info, TokenAccount>,
    burn_vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
    amount: u64,
    config: &Config,
) -> Result<()> {
    let (treasury_share, staking_share, referral_share, burn_share) = config.fee_split(amount);
    // Referrer-less: the referral share folds into treasury.
    let treasury_total = treasury_share
        .checked_add(referral_share)
        .ok_or_else(|| error!(SolansError::MathOverflow))?;
    transfer_tokens_signed(token_program, from, staking_vault, mint, authority, signer_seeds, staking_share)?;
    transfer_tokens_signed(token_program, from, burn_vault, mint, authority, signer_seeds, burn_share)?;
    transfer_tokens_signed(token_program, from, treasury, mint, authority, signer_seeds, treasury_total)?;
    Ok(())
}

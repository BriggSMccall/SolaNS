use crate::constants::*;
use crate::error::SolansError;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use solana_sha256_hasher::hashv;

/// Validate a name's raw bytes against the on-chain canonical form:
/// lowercase ASCII `[a-z0-9-]`, length 1..=63, no leading/trailing/double hyphen.
///
/// Full Unicode/NFKC/confusables handling is intentionally a client concern;
/// restricting on-chain names to lowercase ASCII guarantees exactly one byte
/// string per registrable name, eliminating homograph/normalization attacks.
pub fn validate_name(name: &str) -> Result<()> {
    let bytes = name.as_bytes();
    let len = bytes.len();
    require!(
        len >= NAME_MIN_LEN && len <= NAME_MAX_LEN,
        SolansError::InvalidNameLength
    );
    // len >= 1 is guaranteed above, so indexing is safe.
    require!(
        bytes[0] != b'-' && bytes[len - 1] != b'-',
        SolansError::InvalidNameHyphen
    );

    let mut prev_hyphen = false;
    for &b in bytes {
        require!(
            matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'-'),
            SolansError::InvalidNameCharacter
        );
        if b == b'-' {
            require!(!prev_hyphen, SolansError::InvalidNameHyphen);
            prev_hyphen = true;
        } else {
            prev_hyphen = false;
        }
    }
    Ok(())
}

/// Validate the TLD against the MVP allowlist (`sol` only).
pub fn validate_tld(tld: &str) -> Result<()> {
    require!(tld == ALLOWED_TLD, SolansError::InvalidTld);
    Ok(())
}

/// Canonical name hash: `sha256(name + "." + tld)`. Computed on-chain so the
/// program never trusts a client-supplied hash. The client mirrors this exactly
/// (`@noble/hashes/sha256` over the same UTF-8 bytes).
pub fn compute_name_hash(name: &str, tld: &str) -> [u8; 32] {
    hashv(&[name.as_bytes(), b".", tld.as_bytes()]).to_bytes()
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

/// Charge a registration/renewal fee: a Token-2022-safe `transfer_checked` CPI
/// from `from` (the payer's token account) to `to` (the treasury). Works for
/// both SPL Token and Token-2022 mints via the token interface.
pub fn charge_fee<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    to: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    authority: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    let cpi_accounts = TransferChecked {
        from: from.to_account_info(),
        mint: mint.to_account_info(),
        to: to.to_account_info(),
        authority: authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(token_program.key(), cpi_accounts);
    token_interface::transfer_checked(cpi_ctx, amount, mint.decimals)?;
    Ok(())
}

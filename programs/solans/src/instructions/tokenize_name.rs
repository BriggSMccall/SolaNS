use crate::constants::*;
use crate::error::SolansError;
use crate::state::NameRecord;
use crate::utils::compute_name_hash;
use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::metadata::{
    create_master_edition_v3, create_metadata_accounts_v3, mpl_token_metadata::types::DataV2,
    CreateMasterEditionV3, CreateMetadataAccountsV3, Metadata,
};
use anchor_spl::token::{mint_to, Mint, MintTo, Token, TokenAccount};

/// Tokenize a name into a 1-of-1 Metaplex NFT.
///
/// The `name_record` PDA mints a single classic-SPL NFT to the owner's ATA and
/// is its mint/freeze/update authority. The PDA stays the canonical record; the
/// NFT becomes the tradeable controlling certificate (Magic Eden / Tensor). The
/// `name` label is verified against the stored hash (the PDA never stores it).
#[derive(Accounts)]
pub struct TokenizeName<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        has_one = owner @ SolansError::NotOwner,
        seeds = [NAME_SEED, name_record.name_hash.as_ref()],
        bump = name_record.bump,
    )]
    pub name_record: Account<'info, NameRecord>,

    // A fresh mint keypair (the client generates + signs it). decimals 0,
    // mint+freeze authority = the name_record PDA. A random mint (rather than a
    // PDA) keeps the NFT standard for markets and lets a name re-tokenize after
    // a redeem (which burns the old mint).
    #[account(
        init,
        payer = owner,
        mint::decimals = 0,
        mint::authority = name_record,
        mint::freeze_authority = name_record,
    )]
    pub mint: Account<'info, Mint>,

    #[account(
        init,
        payer = owner,
        associated_token::mint = mint,
        associated_token::authority = owner,
    )]
    pub token_account: Account<'info, TokenAccount>,

    /// CHECK: The Metaplex metadata PDA, validated by its seeds and by the CPI.
    #[account(
        mut,
        seeds = [b"metadata", metadata_program.key().as_ref(), mint.key().as_ref()],
        bump,
        seeds::program = metadata_program.key(),
    )]
    pub metadata: UncheckedAccount<'info>,

    /// CHECK: The Metaplex master-edition PDA, validated by its seeds and by the CPI.
    #[account(
        mut,
        seeds = [b"metadata", metadata_program.key().as_ref(), mint.key().as_ref(), b"edition"],
        bump,
        seeds::program = metadata_program.key(),
    )]
    pub master_edition: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub metadata_program: Program<'info, Metadata>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn handler(ctx: Context<TokenizeName>, name: String) -> Result<()> {
    require!(
        ctx.accounts.name_record.nft_mint.is_none(),
        SolansError::Tokenized
    );
    require!(
        compute_name_hash(&name, &ctx.accounts.name_record.tld)
            == ctx.accounts.name_record.name_hash,
        SolansError::NameMismatch
    );

    let name_hash = ctx.accounts.name_record.name_hash;
    let bump = ctx.accounts.name_record.bump;
    // "<label>.<tld>" capped at the Metaplex 32-byte limit (names are ASCII, so
    // a byte truncate lands on a char boundary).
    let mut nft_name = format!("{}.{}", name, ctx.accounts.name_record.tld);
    nft_name.truncate(MPL_NAME_MAX_LEN);

    let signer_seeds: &[&[&[u8]]] = &[&[NAME_SEED, name_hash.as_ref(), &[bump]]];

    // 1. Mint the single token to the owner's ATA (authority = the PDA).
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.name_record.to_account_info(),
            },
            signer_seeds,
        ),
        1,
    )?;

    // 2. Create the metadata account (mutable so records can refresh it later).
    create_metadata_accounts_v3(
        CpiContext::new_with_signer(
            ctx.accounts.metadata_program.key(),
            CreateMetadataAccountsV3 {
                metadata: ctx.accounts.metadata.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                mint_authority: ctx.accounts.name_record.to_account_info(),
                payer: ctx.accounts.owner.to_account_info(),
                update_authority: ctx.accounts.name_record.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            signer_seeds,
        ),
        DataV2 {
            name: nft_name,
            symbol: "SOLANS".to_string(),
            uri: String::new(),
            seller_fee_basis_points: 0,
            creators: None,
            collection: None,
            uses: None,
        },
        true,  // is_mutable
        true,  // update_authority_is_signer
        None,  // collection_details
    )?;

    // 3. Master edition with max_supply 0 -> a true 1-of-1 (no prints). This also
    //    moves the mint authority to the edition PDA, locking the supply at 1.
    create_master_edition_v3(
        CpiContext::new_with_signer(
            ctx.accounts.metadata_program.key(),
            CreateMasterEditionV3 {
                edition: ctx.accounts.master_edition.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                update_authority: ctx.accounts.name_record.to_account_info(),
                mint_authority: ctx.accounts.name_record.to_account_info(),
                payer: ctx.accounts.owner.to_account_info(),
                metadata: ctx.accounts.metadata.to_account_info(),
                token_program: ctx.accounts.token_program.to_account_info(),
                system_program: ctx.accounts.system_program.to_account_info(),
                rent: ctx.accounts.rent.to_account_info(),
            },
            signer_seeds,
        ),
        Some(0),
    )?;

    ctx.accounts.name_record.nft_mint = Some(ctx.accounts.mint.key());
    Ok(())
}

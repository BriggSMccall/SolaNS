use crate::constants::*;
use crate::error::SolansError;
use crate::state::NameRecord;
use anchor_lang::prelude::*;
use anchor_spl::metadata::{burn_nft, BurnNft, Metadata};
use anchor_spl::token::{Mint, Token, TokenAccount};

/// Redeem a tokenized name back to direct PDA ownership.
///
/// The NFT holder burns the 1-of-1 (closing the token, metadata and master
/// edition) and becomes the name's `owner`. Like a transfer, this clears the
/// controller and the reverse flag (the previous holder's delegated state must
/// not carry over to the new owner).
#[derive(Accounts)]
pub struct RedeemName<'info> {
    #[account(mut)]
    pub redeemer: Signer<'info>,

    #[account(
        mut,
        seeds = [NAME_SEED, name_record.name_hash.as_ref()],
        bump = name_record.bump,
    )]
    pub name_record: Account<'info, NameRecord>,

    #[account(mut)]
    pub mint: Account<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = redeemer,
        constraint = token_account.amount == 1 @ SolansError::NotAuthorized,
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
    pub metadata_program: Program<'info, Metadata>,
}

pub fn handler(ctx: Context<RedeemName>) -> Result<()> {
    require!(
        ctx.accounts.name_record.nft_mint == Some(ctx.accounts.mint.key()),
        SolansError::InvalidNftMint
    );

    // Burn the NFT (closes token + metadata + master edition). The redeemer owns
    // the token, so they sign directly — no PDA signature needed.
    burn_nft(
        CpiContext::new(
            ctx.accounts.metadata_program.key(),
            BurnNft {
                metadata: ctx.accounts.metadata.to_account_info(),
                owner: ctx.accounts.redeemer.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                token: ctx.accounts.token_account.to_account_info(),
                edition: ctx.accounts.master_edition.to_account_info(),
                spl_token: ctx.accounts.token_program.to_account_info(),
            },
        ),
        None,
    )?;

    let nr = &mut ctx.accounts.name_record;
    nr.owner = ctx.accounts.redeemer.key();
    nr.controller = None;
    nr.reverse_set = false;
    nr.nft_mint = None;
    Ok(())
}

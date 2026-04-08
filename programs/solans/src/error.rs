use anchor_lang::prelude::*;

#[error_code]
pub enum SolansError {
    #[msg("Name length must be between 1 and 63 characters")]
    InvalidNameLength,
    #[msg("Name contains invalid characters (allowed: lowercase a-z, 0-9, hyphen)")]
    InvalidNameCharacter,
    #[msg("Invalid hyphen position (no leading, trailing, or consecutive hyphens)")]
    InvalidNameHyphen,
    #[msg("Provided name does not match the account's name hash")]
    NameMismatch,
    #[msg("Unsupported TLD")]
    InvalidTld,
    #[msg("Registration term (years) is out of the allowed range")]
    InvalidYears,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Signer is not the owner of this name")]
    NotOwner,
    #[msg("Signer is not the owner or controller of this name")]
    NotAuthorized,
    #[msg("Name transfer is locked")]
    TransferLocked,
    #[msg("Name is not past its expiration + grace period")]
    NotExpired,
    #[msg("Record key not found")]
    RecordNotFound,
    #[msg("Record store is full")]
    TooManyRecords,
    #[msg("Record key or value exceeds the maximum length")]
    RecordTooLong,
    #[msg("Treasury token account does not match config")]
    InvalidTreasury,
    #[msg("Payment mint does not match config")]
    InvalidMint,
    #[msg("Signer is not the config admin")]
    NotAdmin,
    #[msg("Name is tokenized as an NFT; redeem it first")]
    Tokenized,
    #[msg("Provided mint is not this name's NFT")]
    InvalidNftMint,
    #[msg("Subdomain depth exceeds the maximum")]
    TooDeep,
    #[msg("Parent name has expired")]
    ParentExpired,
    #[msg("Account is not a subdomain of the provided parent")]
    NotParent,
    #[msg("Operation is not supported for a subdomain")]
    Subdomain,
    #[msg("Name is listed for sale; cancel the listing first")]
    Listed,
    #[msg("Name is not listed for sale")]
    NotListed,
    #[msg("Signer is not the seller of this listing")]
    NotSeller,
    #[msg("Listing has expired")]
    ListingExpired,
    #[msg("Buyer and seller must differ")]
    SelfPurchase,
    #[msg("Listing price does not match the expected price")]
    PriceMismatch,
    #[msg("Marketplace fee exceeds the maximum allowed")]
    InvalidFeeBps,
    #[msg("Offer has expired")]
    OfferExpired,
    #[msg("Signer cannot cancel this offer")]
    NotOfferer,
}

use anchor_lang::prelude::*;

#[error_code]
pub enum SquawkError {
    #[msg("Title exceeds 64 bytes")]
    TitleTooLong,
    #[msg("Question exceeds 128 bytes")]
    QuestionTooLong,
    #[msg("ends_at must be in the future")]
    InvalidEndsAt,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Channel is not open for joining")]
    ChannelNotOpen,
    #[msg("Withdrawals are locked while the channel is live or settling")]
    WithdrawLocked,
    #[msg("Nothing to withdraw")]
    NothingToWithdraw,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Only the channel host may do this")]
    Unauthorized,
    #[msg("Channel is not live")]
    ChannelNotLive,
    #[msg("Signer is neither the member nor their session key")]
    SessionKeyInvalid,
    #[msg("Rounds must be created in order")]
    RoundOutOfOrder,
    #[msg("Round is not pending")]
    RoundNotPending,
    #[msg("Round is not open for staking")]
    RoundNotStaking,
    #[msg("Round is already past its lock time")]
    RoundLockPassed,
    #[msg("Round lock time has not been reached")]
    RoundNotLockable,
    #[msg("Round is not resolvable yet")]
    RoundNotResolvable,
    #[msg("Round is not resolved")]
    RoundNotResolved,
    #[msg("Invalid round timing")]
    InvalidRoundTiming,
    #[msg("Insufficient ledger balance")]
    InsufficientBalance,
    #[msg("Position is on the opposite side")]
    OppositeSide,
    #[msg("Previous position must be claimed first")]
    PositionPending,
    #[msg("No open position to claim")]
    NothingToClaim,
    #[msg("Position belongs to a different round")]
    WrongRound,
    #[msg("Visibility must be 0 (public) or 1 (private)")]
    InvalidVisibility,
    #[msg("Channel is not private")]
    ChannelNotPrivate,
    #[msg("Account does not belong to this channel")]
    WrongChannel,
    #[msg("Round is not a Pyth price round")]
    NotPriceRound,
    #[msg("Price feed is not whitelisted")]
    InvalidPriceFeed,
    #[msg("Price round can only resolve within its window after lock")]
    PriceRoundWindow,
    #[msg("Price feed returned no price")]
    FeedUnavailable,
}

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
}

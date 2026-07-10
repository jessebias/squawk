//! Account structs — docs/plan.md §5.1.
//!
//! The vault is a plain SPL token account (ATA owned by the Channel PDA) and is
//! NEVER delegated to the ER; it exists only as a token account, not a struct here.
//! Channel / Round / Position / Member are delegated while the channel is Live.
use anchor_lang::prelude::*;

pub const MAX_TITLE_LEN: usize = 64;
pub const MAX_QUESTION_LEN: usize = 128;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum ChannelStatus {
    Open,
    Live,
    Settling,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum RoundStatus {
    Staking,
    Locked,
    ResolvedYes,
    ResolvedNo,
    Voided,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum Side {
    Yes,
    No,
}

/// Global config — seeds `["config"]`.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub usdc_mint: Pubkey,
    pub bump: u8,
}

/// The room — seeds `["channel", channel_id: u64 le]`. Delegated while Live.
#[account]
#[derive(InitSpace)]
pub struct Channel {
    pub host: Pubkey,
    pub channel_id: u64,
    pub title: [u8; MAX_TITLE_LEN],
    pub status: ChannelStatus,
    pub round_count: u16,
    pub active_round: u16,
    /// Sum of all member deposits currently held in the vault (ledger total).
    pub total_pool: u64,
    pub user_count: u16,
    pub created_at: i64,
    pub ends_at: i64,
    pub bump: u8,
}

/// One micro-question — seeds `["round", channel_key, round_index: u16 le]`.
/// Delegated while Live.
#[account]
#[derive(InitSpace)]
pub struct Round {
    pub channel: Pubkey,
    pub round_index: u16,
    pub question: [u8; MAX_QUESTION_LEN],
    pub status: RoundStatus,
    pub yes_pool: u64,
    pub no_pool: u64,
    pub opens_at: i64,
    pub locks_at: i64,
    pub resolves_by: i64,
    pub bump: u8,
}

/// One position per user per round — seeds `["position", round_key, user]`.
/// Delegated while Live. A second stake on the same side adds to `amount`;
/// staking the opposite side is rejected.
#[account]
#[derive(InitSpace)]
pub struct Position {
    pub round: Pubkey,
    pub user: Pubkey,
    pub side: Side,
    pub amount: u64,
    pub claimed: bool,
    pub bump: u8,
}

/// Per-user channel ledger — seeds `["member", channel_key, user]`.
/// Delegated while Live; only ledger numbers move on the ER, never tokens.
#[account]
#[derive(InitSpace)]
pub struct Member {
    pub channel: Pubkey,
    pub user: Pubkey,
    /// Lifetime deposits (history; not zeroed on withdraw).
    pub deposited: u64,
    /// Withdrawable ledger balance; updated in the ER as rounds resolve.
    pub balance: u64,
    /// Session key allowed to sign stake/claim_round for this member.
    pub session_key: Pubkey,
    pub bump: u8,
}

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
    /// Pre-created at/before go_live, not yet opened by the host.
    Pending,
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
    /// 0 = public ER, 1 = private (TEE PER, blind betting + unlisted).
    pub visibility: u8,
    /// Board mirror: the active round's display data duplicated onto the
    /// channel. On a private ER the Round accounts are host-only-readable,
    /// so members follow play through these fields instead. Written
    /// unconditionally (harmless on public channels).
    pub active_question: [u8; MAX_QUESTION_LEN],
    pub active_locks_at: i64,
    /// RoundStatus of the active round, as u8.
    pub active_round_status: u8,
    /// Resolve-time pool snapshots, revealed at resolve (zero while staking).
    pub reveal_yes: u64,
    pub reveal_no: u64,
    /// 0 = none, 1 = yes, 2 = no, 3 = voided.
    pub last_outcome: u8,
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
    /// Live pools: stakes flow in during Staking, claims deduct after resolve.
    /// Whatever remains after all claims is unclaimed/dust and stays accounted.
    pub yes_pool: u64,
    pub no_pool: u64,
    /// Pool snapshots taken at resolve time — payout ratios use these so
    /// claim order can't change anyone's share.
    pub snap_yes: u64,
    pub snap_no: u64,
    pub opens_at: i64,
    pub locks_at: i64,
    pub resolves_by: i64,
    pub bump: u8,
    /// 0 = Host (manual referee), 1 = PythPrice (trustless oracle resolve).
    /// Manual rounds leave the price fields below zeroed.
    pub oracle_kind: u8,
    /// Pyth Lazer feed account this price round resolves against (must be
    /// whitelisted); zeroed for manual rounds.
    pub price_feed: Pubkey,
    /// Target price (raw, exponent -8 to match the feed).
    pub target_price: i64,
    /// 0 = Above (`observed >= target` → YES), 1 = Below (`observed < target`).
    pub price_direction: u8,
    /// The observed feed price at resolution (0 until resolved) — kept for
    /// display/proof that the on-chain read decided the outcome.
    pub resolver_price: i64,
}

/// The member's single open position, embedded in `Member` (deviation from
/// docs/plan.md §5.1 standalone PDAs — see docs/decisions.md Phase 3): rounds
/// are sequential, so one open position per member suffices and no accounts
/// ever need creating on the ER. `amount == 0` means no open position. A
/// second stake on the same side adds to `amount`; the opposite side is
/// rejected; staking a new round requires claiming the old position first
/// (clients auto-claim on resolution).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub struct Position {
    pub round_index: u16,
    pub side: Side,
    pub amount: u64,
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
    /// The single open position (amount == 0 → none).
    pub position: Position,
    pub bump: u8,
}

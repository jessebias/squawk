use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use ephemeral_rollups_sdk::access_control::instructions::CreateEphemeralPermissionCpi;
use ephemeral_rollups_sdk::access_control::structs::{
    EphemeralMembersArgs, Member as PermissionMember, ACCOUNT_SIGNATURES_FLAG, AUTHORITY_FLAG,
    PERMISSION_SEED, TX_BALANCES_FLAG, TX_LOGS_FLAG, TX_MESSAGE_FLAG,
};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::consts::{EPHEMERAL_VAULT_ID, PERMISSION_PROGRAM_ID};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

pub mod errors;
pub mod state;

use errors::SquawkError;
use state::*;

declare_id!("4NT1YGUK1YWboAq9pyKLqGsHUQaRwDAi7kpATd6Ynuii");

#[ephemeral]
#[program]
pub mod squawk {
    use super::*;

    /// Instruction 1 (docs/plan.md §5.2) — one-time global config.
    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.usdc_mint = ctx.accounts.usdc_mint.key();
        config.bump = ctx.bumps.config;
        Ok(())
    }

    /// Instruction 2 — host creates the channel + its vault (ATA owned by the
    /// channel PDA; the vault is never delegated).
    pub fn create_channel(
        ctx: Context<CreateChannel>,
        channel_id: u64,
        title: String,
        ends_at: i64,
        visibility: u8,
    ) -> Result<()> {
        require!(title.len() <= MAX_TITLE_LEN, SquawkError::TitleTooLong);
        require!(visibility <= 1, SquawkError::InvalidVisibility);
        let now = Clock::get()?.unix_timestamp;
        require!(ends_at > now, SquawkError::InvalidEndsAt);

        let channel = &mut ctx.accounts.channel;
        channel.host = ctx.accounts.host.key();
        channel.channel_id = channel_id;
        let mut title_bytes = [0u8; MAX_TITLE_LEN];
        title_bytes[..title.len()].copy_from_slice(title.as_bytes());
        channel.title = title_bytes;
        channel.status = ChannelStatus::Open;
        channel.round_count = 0;
        channel.active_round = 0;
        channel.total_pool = 0;
        channel.user_count = 0;
        channel.created_at = now;
        channel.ends_at = ends_at;
        channel.bump = ctx.bumps.channel;
        channel.visibility = visibility;
        channel.active_question = [0u8; MAX_QUESTION_LEN];
        channel.active_locks_at = 0;
        channel.active_round_status = RoundStatus::Pending as u8;
        channel.reveal_yes = 0;
        channel.reveal_no = 0;
        channel.last_outcome = 0;
        Ok(())
    }

    /// Instruction 3 — user deposits USDC into the vault, gets a Member ledger,
    /// and registers the session key allowed to stake/claim on their behalf.
    pub fn join_channel(ctx: Context<JoinChannel>, amount: u64, session_key: Pubkey) -> Result<()> {
        require!(amount > 0, SquawkError::InvalidAmount);
        require!(
            ctx.accounts.channel.status == ChannelStatus::Open,
            SquawkError::ChannelNotOpen
        );

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user_token_account.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            ),
            amount,
        )?;

        let member = &mut ctx.accounts.member;
        member.channel = ctx.accounts.channel.key();
        member.user = ctx.accounts.user.key();
        member.deposited = amount;
        member.balance = amount;
        member.session_key = session_key;
        member.position = Position {
            round_index: 0,
            side: Side::Yes,
            amount: 0,
        };
        member.bump = ctx.bumps.member;

        let channel = &mut ctx.accounts.channel;
        channel.total_pool = channel
            .total_pool
            .checked_add(amount)
            .ok_or(SquawkError::Overflow)?;
        channel.user_count = channel
            .user_count
            .checked_add(1)
            .ok_or(SquawkError::Overflow)?;
        Ok(())
    }

    /// Instruction 4a (docs/plan.md §5.2) — host flips the channel Live.
    /// Delegation of the channel/member accounts follows as separate
    /// instructions (delegate_channel / delegate_member), composed by the
    /// client, since each delegation is its own CPI.
    pub fn go_live(ctx: Context<GoLive>) -> Result<()> {
        require!(
            ctx.accounts.channel.status == ChannelStatus::Open,
            SquawkError::ChannelNotOpen
        );
        ctx.accounts.channel.status = ChannelStatus::Live;
        Ok(())
    }

    /// Instruction 4b — delegate the Channel PDA to the ER. Host-only, Live only.
    /// `validator` targets a specific ER validator (the TEE for private channels).
    pub fn delegate_channel(
        ctx: Context<DelegateChannel>,
        channel_id: u64,
        validator: Option<Pubkey>,
    ) -> Result<()> {
        {
            let data = ctx.accounts.channel.try_borrow_data()?;
            let ch = Channel::try_deserialize(&mut data.as_ref())?;
            require!(ch.status == ChannelStatus::Live, SquawkError::ChannelNotLive);
            require_keys_eq!(ctx.accounts.payer.key(), ch.host, SquawkError::Unauthorized);
        }
        let id_bytes = channel_id.to_le_bytes();
        ctx.accounts.delegate_channel(
            &ctx.accounts.payer,
            &[b"channel", id_bytes.as_ref()],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Instruction 4c — delegate one Member PDA to the ER. Host-only, Live only.
    /// (The channel account may itself already be delegated; only its data is
    /// read here, which survives delegation.)
    pub fn delegate_member(
        ctx: Context<DelegateMember>,
        _channel_id: u64,
        user: Pubkey,
        validator: Option<Pubkey>,
    ) -> Result<()> {
        {
            let data = ctx.accounts.channel.try_borrow_data()?;
            let ch = Channel::try_deserialize(&mut data.as_ref())?;
            require!(ch.status == ChannelStatus::Live, SquawkError::ChannelNotLive);
            require_keys_eq!(ctx.accounts.payer.key(), ch.host, SquawkError::Unauthorized);
        }
        let channel_key = ctx.accounts.channel.key();
        ctx.accounts.delegate_member(
            &ctx.accounts.payer,
            &[b"member", channel_key.as_ref(), user.as_ref()],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Pre-creates the next Round PDA (base layer, while Open — before
    /// delegation). Rounds are created sequentially; the host script makes
    /// round_count of them, then delegates each after go_live.
    pub fn create_round(ctx: Context<CreateRound>, _channel_id: u64, round_index: u16) -> Result<()> {
        require!(
            ctx.accounts.channel.status == ChannelStatus::Open,
            SquawkError::ChannelNotOpen
        );
        require!(
            round_index == ctx.accounts.channel.round_count,
            SquawkError::RoundOutOfOrder
        );
        let round = &mut ctx.accounts.round;
        round.channel = ctx.accounts.channel.key();
        round.round_index = round_index;
        round.question = [0u8; MAX_QUESTION_LEN];
        round.status = RoundStatus::Pending;
        round.yes_pool = 0;
        round.no_pool = 0;
        round.snap_yes = 0;
        round.snap_no = 0;
        round.opens_at = 0;
        round.locks_at = 0;
        round.resolves_by = 0;
        round.bump = ctx.bumps.round;
        ctx.accounts.channel.round_count += 1;
        Ok(())
    }

    /// Instruction 4d — delegate one Round PDA to the ER. Host-only, Live only.
    pub fn delegate_round(
        ctx: Context<DelegateRound>,
        _channel_id: u64,
        round_index: u16,
        validator: Option<Pubkey>,
    ) -> Result<()> {
        {
            let data = ctx.accounts.channel.try_borrow_data()?;
            let ch = Channel::try_deserialize(&mut data.as_ref())?;
            require!(ch.status == ChannelStatus::Live, SquawkError::ChannelNotLive);
            require_keys_eq!(ctx.accounts.payer.key(), ch.host, SquawkError::Unauthorized);
        }
        let channel_key = ctx.accounts.channel.key();
        let idx_bytes = round_index.to_le_bytes();
        ctx.accounts.delegate_round(
            &ctx.accounts.payer,
            &[b"round", channel_key.as_ref(), idx_bytes.as_ref()],
            DelegateConfig {
                validator,
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Private-channel (PER) read gate for the Channel account: host + every
    /// member's wallet and session key may read it on the TEE ER; everyone
    /// else is blocked at ingress. Runs ON the ER after delegation; the
    /// channel PDA signs and pays the ephemeral rent (pre-funded on base
    /// before delegation). remaining_accounts = this channel's Member PDAs.
    pub fn create_channel_permission<'info>(
        ctx: Context<'_, '_, 'info, 'info, CreateChannelPermission<'info>>,
        channel_id: u64,
    ) -> Result<()> {
        let ch = read_private_live_channel(&ctx.accounts.channel, &ctx.accounts.host.key())?;
        let channel_key = ctx.accounts.channel.key();
        let mut members = vec![PermissionMember {
            flags: HOST_PERMISSION_FLAGS,
            pubkey: ch.host,
        }];
        for acc in ctx.remaining_accounts.iter() {
            let data = acc.try_borrow_data()?;
            let m = Member::try_deserialize(&mut data.as_ref())?;
            require_keys_eq!(m.channel, channel_key, SquawkError::WrongChannel);
            members.push(PermissionMember { flags: VIEW_FLAGS, pubkey: m.user });
            members.push(PermissionMember { flags: VIEW_FLAGS, pubkey: m.session_key });
        }
        let id_bytes = channel_id.to_le_bytes();
        CreateEphemeralPermissionCpi {
            permissioned_account: ctx.accounts.channel.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            payer: ctx.accounts.channel.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private: true, members },
        }
        .invoke_signed(&[&[b"channel", id_bytes.as_ref(), &[ch.bump]]])?;
        Ok(())
    }

    /// PER read gate for one Member account: only the host and that member
    /// (wallet + session key) may read it — individual stakes and balances
    /// stay hidden from other players.
    pub fn create_member_permission(
        ctx: Context<CreateMemberPermission>,
        _channel_id: u64,
        user: Pubkey,
    ) -> Result<()> {
        let ch = read_private_live_channel(&ctx.accounts.channel, &ctx.accounts.host.key())?;
        let channel_key = ctx.accounts.channel.key();
        let m = {
            let data = ctx.accounts.member.try_borrow_data()?;
            Member::try_deserialize(&mut data.as_ref())?
        };
        let members = vec![
            PermissionMember {
                flags: HOST_PERMISSION_FLAGS,
                pubkey: ch.host,
            },
            PermissionMember { flags: VIEW_FLAGS, pubkey: m.user },
            PermissionMember { flags: VIEW_FLAGS, pubkey: m.session_key },
        ];
        CreateEphemeralPermissionCpi {
            permissioned_account: ctx.accounts.member.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            payer: ctx.accounts.member.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private: true, members },
        }
        .invoke_signed(&[&[b"member", channel_key.as_ref(), user.as_ref(), &[m.bump]]])?;
        Ok(())
    }

    /// PER read gate for one Round account: HOST ONLY — the pools are
    /// invisible to players while staking. This is the blind bet; players
    /// follow the round through the channel's board-mirror fields and see
    /// the pools only when resolve_round reveals them there.
    pub fn create_round_permission(
        ctx: Context<CreateRoundPermission>,
        _channel_id: u64,
        round_index: u16,
    ) -> Result<()> {
        let ch = read_private_live_channel(&ctx.accounts.channel, &ctx.accounts.host.key())?;
        let channel_key = ctx.accounts.channel.key();
        let r = {
            let data = ctx.accounts.round.try_borrow_data()?;
            Round::try_deserialize(&mut data.as_ref())?
        };
        require_keys_eq!(r.channel, channel_key, SquawkError::WrongChannel);
        let members = vec![PermissionMember {
            flags: HOST_PERMISSION_FLAGS,
            pubkey: ch.host,
        }];
        let idx_bytes = round_index.to_le_bytes();
        CreateEphemeralPermissionCpi {
            permissioned_account: ctx.accounts.round.to_account_info(),
            permission: ctx.accounts.permission.to_account_info(),
            payer: ctx.accounts.round.to_account_info(),
            vault: ctx.accounts.vault.to_account_info(),
            magic_program: ctx.accounts.magic_program.to_account_info(),
            permission_program: ctx.accounts.permission_program.to_account_info(),
            args: EphemeralMembersArgs { is_private: true, members },
        }
        .invoke_signed(&[&[b"round", channel_key.as_ref(), idx_bytes.as_ref(), &[r.bump]]])?;
        Ok(())
    }

    /// Instruction 5 — host activates a pre-created round (ER).
    pub fn open_round(
        ctx: Context<OpenRound>,
        round_index: u16,
        question: String,
        locks_at: i64,
        resolves_by: i64,
    ) -> Result<()> {
        require!(
            ctx.accounts.channel.status == ChannelStatus::Live,
            SquawkError::ChannelNotLive
        );
        require!(question.len() <= MAX_QUESTION_LEN, SquawkError::QuestionTooLong);
        let now = Clock::get()?.unix_timestamp;
        require!(
            locks_at > now && resolves_by > locks_at,
            SquawkError::InvalidRoundTiming
        );
        let round = &mut ctx.accounts.round;
        require!(round.status == RoundStatus::Pending, SquawkError::RoundNotPending);

        let mut q = [0u8; MAX_QUESTION_LEN];
        q[..question.len()].copy_from_slice(question.as_bytes());
        round.question = q;
        round.status = RoundStatus::Staking;
        round.opens_at = now;
        round.locks_at = locks_at;
        round.resolves_by = resolves_by;
        let channel = &mut ctx.accounts.channel;
        channel.active_round = round_index;
        channel.active_question = q;
        channel.active_locks_at = locks_at;
        channel.active_round_status = RoundStatus::Staking as u8;
        channel.reveal_yes = 0;
        channel.reveal_no = 0;
        channel.last_outcome = 0;
        Ok(())
    }

    /// Instruction 6 — stake from the member ledger into a round pool (ER).
    /// Signed by the member's wallet OR their registered session key.
    pub fn stake(ctx: Context<Stake>, round_index: u16, side: Side, amount: u64) -> Result<()> {
        require!(amount > 0, SquawkError::InvalidAmount);
        require!(
            ctx.accounts.channel.status == ChannelStatus::Live,
            SquawkError::ChannelNotLive
        );
        let signer = ctx.accounts.signer.key();
        let member = &mut ctx.accounts.member;
        require!(
            signer == member.user || signer == member.session_key,
            SquawkError::SessionKeyInvalid
        );

        let round = &mut ctx.accounts.round;
        require!(round.status == RoundStatus::Staking, SquawkError::RoundNotStaking);
        let now = Clock::get()?.unix_timestamp;
        require!(now < round.locks_at, SquawkError::RoundLockPassed);
        require!(member.balance >= amount, SquawkError::InsufficientBalance);

        if member.position.amount > 0 {
            require!(
                member.position.round_index == round_index,
                SquawkError::PositionPending
            );
            require!(member.position.side == side, SquawkError::OppositeSide);
            member.position.amount = member
                .position
                .amount
                .checked_add(amount)
                .ok_or(SquawkError::Overflow)?;
        } else {
            member.position = Position { round_index, side, amount };
        }
        member.balance -= amount;
        let pool = match side {
            Side::Yes => &mut round.yes_pool,
            Side::No => &mut round.no_pool,
        };
        *pool = pool.checked_add(amount).ok_or(SquawkError::Overflow)?;
        Ok(())
    }

    /// Instruction 7 — lock the round at locks_at. Signerless and
    /// permissionless so both the MagicBlock crank and any client can fire it.
    pub fn lock_round(ctx: Context<LockRound>, _round_index: u16) -> Result<()> {
        let round = &mut ctx.accounts.round;
        require!(round.status == RoundStatus::Staking, SquawkError::RoundNotStaking);
        let now = Clock::get()?.unix_timestamp;
        require!(now >= round.locks_at, SquawkError::RoundNotLockable);
        round.status = RoundStatus::Locked;
        let channel = &mut ctx.accounts.channel;
        if channel.active_round == round.round_index {
            channel.active_round_status = RoundStatus::Locked as u8;
        }
        Ok(())
    }

    /// Instruction 8 — host resolves the round (host is the referee for the
    /// MVP, disclosed in the UI). Accepts Locked, or Staking past locks_at so
    /// a missed crank can't wedge the round. If the winning side has no
    /// stakes, the round voids and claims refund everyone.
    pub fn resolve_round(ctx: Context<ResolveRound>, _round_index: u16, outcome: Side) -> Result<()> {
        require!(
            ctx.accounts.channel.status == ChannelStatus::Live,
            SquawkError::ChannelNotLive
        );
        let round = &mut ctx.accounts.round;
        let now = Clock::get()?.unix_timestamp;
        let lockable = round.status == RoundStatus::Staking && now >= round.locks_at;
        require!(
            round.status == RoundStatus::Locked || lockable,
            SquawkError::RoundNotResolvable
        );
        round.snap_yes = round.yes_pool;
        round.snap_no = round.no_pool;
        let winning_pool = match outcome {
            Side::Yes => round.snap_yes,
            Side::No => round.snap_no,
        };
        round.status = if winning_pool == 0 {
            RoundStatus::Voided
        } else {
            match outcome {
                Side::Yes => RoundStatus::ResolvedYes,
                Side::No => RoundStatus::ResolvedNo,
            }
        };
        let channel = &mut ctx.accounts.channel;
        if channel.active_round == round.round_index {
            channel.active_round_status = round.status as u8;
            channel.reveal_yes = round.snap_yes;
            channel.reveal_no = round.snap_no;
            channel.last_outcome = match round.status {
                RoundStatus::ResolvedYes => 1,
                RoundStatus::ResolvedNo => 2,
                _ => 3,
            };
        }
        Ok(())
    }

    /// Claim a resolved/voided position into the member ledger. Signerless and
    /// permissionless: winnings can only ever go to the position's own member,
    /// so anyone (client auto-claim, host close-out loop) may fire it.
    pub fn claim_round(ctx: Context<ClaimRound>, round_index: u16) -> Result<()> {
        let member = &mut ctx.accounts.member;
        require!(member.position.amount > 0, SquawkError::NothingToClaim);
        require!(
            member.position.round_index == round_index,
            SquawkError::WrongRound
        );

        let round = &mut ctx.accounts.round;
        let amount = member.position.amount;
        let credit: u64 = match round.status {
            RoundStatus::Voided => {
                let pool = match member.position.side {
                    Side::Yes => &mut round.yes_pool,
                    Side::No => &mut round.no_pool,
                };
                *pool = pool.checked_sub(amount).ok_or(SquawkError::Overflow)?;
                amount
            }
            RoundStatus::ResolvedYes | RoundStatus::ResolvedNo => {
                let winner_side = if round.status == RoundStatus::ResolvedYes {
                    Side::Yes
                } else {
                    Side::No
                };
                if member.position.side == winner_side {
                    let (win_snap, lose_snap) = match winner_side {
                        Side::Yes => (round.snap_yes, round.snap_no),
                        Side::No => (round.snap_no, round.snap_yes),
                    };
                    let winnings = u64::try_from(
                        (amount as u128)
                            .checked_mul(lose_snap as u128)
                            .ok_or(SquawkError::Overflow)?
                            / (win_snap as u128),
                    )
                    .map_err(|_| SquawkError::Overflow)?;
                    match winner_side {
                        Side::Yes => {
                            round.yes_pool =
                                round.yes_pool.checked_sub(amount).ok_or(SquawkError::Overflow)?;
                            round.no_pool =
                                round.no_pool.checked_sub(winnings).ok_or(SquawkError::Overflow)?;
                        }
                        Side::No => {
                            round.no_pool =
                                round.no_pool.checked_sub(amount).ok_or(SquawkError::Overflow)?;
                            round.yes_pool =
                                round.yes_pool.checked_sub(winnings).ok_or(SquawkError::Overflow)?;
                        }
                    }
                    amount.checked_add(winnings).ok_or(SquawkError::Overflow)?
                } else {
                    0 // loser: stake stays in the losing pool for winners' claims
                }
            }
            _ => return err!(SquawkError::RoundNotResolved),
        };

        member.balance = member
            .balance
            .checked_add(credit)
            .ok_or(SquawkError::Overflow)?;
        member.position.amount = 0;
        Ok(())
    }

    /// Schedules a one-shot MagicBlock crank (ER) that fires lock_round at
    /// the round's locks_at. lock_round stays permissionless, so a client can
    /// always lock as fallback if the crank misses (docs/plan.md §5.2 item 7).
    pub fn schedule_lock_crank(
        ctx: Context<ScheduleLockCrank>,
        round_index: u16,
        task_id: i64,
        delay_millis: i64,
    ) -> Result<()> {
        use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
        use anchor_lang::solana_program::program::invoke;
        use magicblock_magic_program_api::{
            args::ScheduleTaskArgs, instruction::MagicBlockInstruction,
        };

        let crank_ix = Instruction {
            program_id: crate::ID,
            accounts: vec![
                AccountMeta::new(ctx.accounts.channel.key(), false),
                AccountMeta::new(ctx.accounts.round.key(), false),
            ],
            data: anchor_lang::InstructionData::data(&crate::instruction::LockRound {
                _round_index: round_index,
            }),
        };
        let ix_data = bincode::serialize(&MagicBlockInstruction::ScheduleTask(ScheduleTaskArgs {
            task_id,
            execution_interval_millis: delay_millis,
            iterations: 1,
            instructions: vec![crank_ix],
        }))
        .map_err(|_| ProgramError::InvalidArgument)?;

        let schedule_ix = Instruction::new_with_bytes(
            ctx.accounts.magic_program.key(),
            &ix_data,
            vec![
                AccountMeta::new(ctx.accounts.payer.key(), true),
                AccountMeta::new(ctx.accounts.channel.key(), false),
                AccountMeta::new(ctx.accounts.round.key(), false),
            ],
        );
        invoke(
            &schedule_ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.channel.to_account_info(),
                ctx.accounts.round.to_account_info(),
                ctx.accounts.magic_program.to_account_info(),
            ],
        )?;
        Ok(())
    }

    /// Host extends the channel end time. Runs on the base layer before
    /// delegation and on the ER while delegated — which makes it the Phase 2
    /// proof op: after delegation it must fail on base and succeed on the ER.
    pub fn extend_channel(ctx: Context<ExtendChannel>, new_ends_at: i64) -> Result<()> {
        require!(
            new_ends_at > ctx.accounts.channel.ends_at,
            SquawkError::InvalidEndsAt
        );
        ctx.accounts.channel.ends_at = new_ends_at;
        Ok(())
    }

    /// Instruction 9 — host closes the channel ON THE ER: marks it Closed and
    /// schedules commit + undelegation of the channel plus every delegated
    /// account passed in remaining_accounts (members; rounds in Phase 3).
    /// Base layer only ever sees status Closed after the commit lands, so
    /// withdraw's Closed gate is inherently safe (Settling state not needed).
    pub fn close_channel<'info>(
        ctx: Context<'_, '_, 'info, 'info, CloseChannel<'info>>,
    ) -> Result<()> {
        require!(
            ctx.accounts.channel.status == ChannelStatus::Live,
            SquawkError::ChannelNotLive
        );
        ctx.accounts.channel.status = ChannelStatus::Closed;
        // Serialize before the commit CPI snapshots account data.
        ctx.accounts.channel.exit(&crate::ID)?;

        let mut to_commit = vec![ctx.accounts.channel.to_account_info()];
        to_commit.extend(ctx.remaining_accounts.iter().cloned());
        MagicIntentBundleBuilder::new(
            ctx.accounts.host.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&to_commit)
        .build_and_invoke()?;
        Ok(())
    }

    /// Commit + undelegate a batch of delegated accounts (ER) without any
    /// state change — used to release Round PDAs after close_channel so the
    /// settlement bundle stays small. Permissionless: committing program
    /// state back to base is always safe.
    pub fn commit_rounds<'info>(
        ctx: Context<'_, '_, 'info, 'info, CommitRounds<'info>>,
    ) -> Result<()> {
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&ctx.remaining_accounts.to_vec())
        .build_and_invoke()?;
        Ok(())
    }

    /// Instruction 10 — redeem the Member ledger balance as real USDC.
    /// Allowed while Open (back out before go_live) or Closed (after
    /// settlement has committed back); never while Live/Settling, when the
    /// ledger is delegated and in play.
    pub fn withdraw(ctx: Context<Withdraw>) -> Result<()> {
        let status = ctx.accounts.channel.status;
        require!(
            status == ChannelStatus::Open || status == ChannelStatus::Closed,
            SquawkError::WithdrawLocked
        );
        let amount = ctx.accounts.member.balance;
        require!(amount > 0, SquawkError::NothingToWithdraw);

        let channel_id_bytes = ctx.accounts.channel.channel_id.to_le_bytes();
        let signer_seeds: &[&[u8]] = &[
            b"channel",
            channel_id_bytes.as_ref(),
            &[ctx.accounts.channel.bump],
        ];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to: ctx.accounts.user_token_account.to_account_info(),
                    authority: ctx.accounts.channel.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
        )?;

        ctx.accounts.member.balance = 0;
        let channel = &mut ctx.accounts.channel;
        channel.total_pool = channel
            .total_pool
            .checked_sub(amount)
            .ok_or(SquawkError::Overflow)?;
        Ok(())
    }
}

/// Read flags for private-channel members; the host additionally holds
/// AUTHORITY (may update/close the permission).
const VIEW_FLAGS: u8 = TX_LOGS_FLAG | TX_BALANCES_FLAG | TX_MESSAGE_FLAG | ACCOUNT_SIGNATURES_FLAG;
const HOST_PERMISSION_FLAGS: u8 = AUTHORITY_FLAG | VIEW_FLAGS;

/// Shared guard for the PER permission instructions: the channel must be
/// private, Live (delegated), and the signer must be its host.
fn read_private_live_channel(channel: &AccountInfo, host: &Pubkey) -> Result<Channel> {
    let data = channel.try_borrow_data()?;
    let ch = Channel::try_deserialize(&mut data.as_ref())?;
    require!(ch.status == ChannelStatus::Live, SquawkError::ChannelNotLive);
    require!(ch.visibility == 1, SquawkError::ChannelNotPrivate);
    require_keys_eq!(*host, ch.host, SquawkError::Unauthorized);
    Ok(ch)
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(channel_id: u64)]
pub struct CreateChannel<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = usdc_mint)]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = host,
        space = 8 + Channel::INIT_SPACE,
        seeds = [b"channel", channel_id.to_le_bytes().as_ref()],
        bump
    )]
    pub channel: Account<'info, Channel>,
    #[account(
        init,
        payer = host,
        associated_token::mint = usdc_mint,
        associated_token::authority = channel
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinChannel<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = usdc_mint)]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump
    )]
    pub channel: Account<'info, Channel>,
    #[account(
        init,
        payer = user,
        space = 8 + Member::INIT_SPACE,
        seeds = [b"member", channel.key().as_ref(), user.key().as_ref()],
        bump
    )]
    pub member: Account<'info, Member>,
    #[account(mut, token::mint = usdc_mint, token::authority = user)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = channel
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct GoLive<'info> {
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump,
        has_one = host @ SquawkError::Unauthorized
    )]
    pub channel: Account<'info, Channel>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(channel_id: u64)]
pub struct DelegateChannel<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA verified by seeds; handler checks host + Live from raw data
    #[account(mut, del, seeds = [b"channel", channel_id.to_le_bytes().as_ref()], bump)]
    pub channel: AccountInfo<'info>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(channel_id: u64, user: Pubkey)]
pub struct DelegateMember<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA verified by seeds; handler checks host + Live from raw data
    #[account(seeds = [b"channel", channel_id.to_le_bytes().as_ref()], bump)]
    pub channel: AccountInfo<'info>,
    /// CHECK: PDA verified by seeds; delegated via CPI
    #[account(mut, del, seeds = [b"member", channel.key().as_ref(), user.as_ref()], bump)]
    pub member: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(_channel_id: u64, round_index: u16)]
pub struct CreateRound<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump,
        has_one = host @ SquawkError::Unauthorized
    )]
    pub channel: Account<'info, Channel>,
    #[account(
        init,
        payer = host,
        space = 8 + Round::INIT_SPACE,
        seeds = [b"round", channel.key().as_ref(), round_index.to_le_bytes().as_ref()],
        bump
    )]
    pub round: Account<'info, Round>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(channel_id: u64, round_index: u16)]
pub struct DelegateRound<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: PDA verified by seeds; handler checks host + Live from raw data
    #[account(seeds = [b"channel", channel_id.to_le_bytes().as_ref()], bump)]
    pub channel: AccountInfo<'info>,
    /// CHECK: PDA verified by seeds; delegated via CPI
    #[account(mut, del, seeds = [b"round", channel.key().as_ref(), round_index.to_le_bytes().as_ref()], bump)]
    pub round: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(channel_id: u64)]
pub struct CreateChannelPermission<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    /// CHECK: PDA verified by seeds; handler checks host/Live/private from raw data
    #[account(mut, seeds = [b"channel", channel_id.to_le_bytes().as_ref()], bump)]
    pub channel: AccountInfo<'info>,
    /// CHECK: ephemeral permission PDA, created by the permission program
    #[account(
        mut,
        seeds = [PERMISSION_SEED, channel.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub permission: AccountInfo<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub vault: AccountInfo<'info>,
    /// CHECK: the MagicBlock magic program
    #[account(address = ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID)]
    pub magic_program: AccountInfo<'info>,
    /// CHECK: the ephemeral permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(channel_id: u64, user: Pubkey)]
pub struct CreateMemberPermission<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    /// CHECK: PDA verified by seeds; handler checks host/Live/private from raw data
    #[account(seeds = [b"channel", channel_id.to_le_bytes().as_ref()], bump)]
    pub channel: AccountInfo<'info>,
    /// CHECK: PDA verified by seeds; signs and pays the ephemeral rent
    #[account(mut, seeds = [b"member", channel.key().as_ref(), user.as_ref()], bump)]
    pub member: AccountInfo<'info>,
    /// CHECK: ephemeral permission PDA, created by the permission program
    #[account(
        mut,
        seeds = [PERMISSION_SEED, member.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub permission: AccountInfo<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub vault: AccountInfo<'info>,
    /// CHECK: the MagicBlock magic program
    #[account(address = ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID)]
    pub magic_program: AccountInfo<'info>,
    /// CHECK: the ephemeral permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(channel_id: u64, round_index: u16)]
pub struct CreateRoundPermission<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    /// CHECK: PDA verified by seeds; handler checks host/Live/private from raw data
    #[account(seeds = [b"channel", channel_id.to_le_bytes().as_ref()], bump)]
    pub channel: AccountInfo<'info>,
    /// CHECK: PDA verified by seeds; signs and pays the ephemeral rent
    #[account(mut, seeds = [b"round", channel.key().as_ref(), round_index.to_le_bytes().as_ref()], bump)]
    pub round: AccountInfo<'info>,
    /// CHECK: ephemeral permission PDA, created by the permission program
    #[account(
        mut,
        seeds = [PERMISSION_SEED, round.key().as_ref()],
        bump,
        seeds::program = PERMISSION_PROGRAM_ID
    )]
    pub permission: AccountInfo<'info>,
    /// CHECK: ephemeral rent vault
    #[account(mut, address = EPHEMERAL_VAULT_ID)]
    pub vault: AccountInfo<'info>,
    /// CHECK: the MagicBlock magic program
    #[account(address = ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID)]
    pub magic_program: AccountInfo<'info>,
    /// CHECK: the ephemeral permission program
    #[account(address = PERMISSION_PROGRAM_ID)]
    pub permission_program: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(round_index: u16)]
pub struct OpenRound<'info> {
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump,
        has_one = host @ SquawkError::Unauthorized
    )]
    pub channel: Account<'info, Channel>,
    #[account(
        mut,
        seeds = [b"round", channel.key().as_ref(), round_index.to_le_bytes().as_ref()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
#[instruction(round_index: u16)]
pub struct Stake<'info> {
    /// Member wallet OR registered session key (checked in the handler).
    pub signer: Signer<'info>,
    #[account(
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump
    )]
    pub channel: Account<'info, Channel>,
    #[account(
        mut,
        seeds = [b"round", channel.key().as_ref(), round_index.to_le_bytes().as_ref()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [b"member", channel.key().as_ref(), member.user.as_ref()],
        bump = member.bump
    )]
    pub member: Account<'info, Member>,
}

#[derive(Accounts)]
#[instruction(round_index: u16)]
pub struct LockRound<'info> {
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump
    )]
    pub channel: Account<'info, Channel>,
    #[account(
        mut,
        seeds = [b"round", channel.key().as_ref(), round_index.to_le_bytes().as_ref()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
#[instruction(round_index: u16)]
pub struct ResolveRound<'info> {
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump,
        has_one = host @ SquawkError::Unauthorized
    )]
    pub channel: Account<'info, Channel>,
    #[account(
        mut,
        seeds = [b"round", channel.key().as_ref(), round_index.to_le_bytes().as_ref()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
#[instruction(round_index: u16)]
pub struct ClaimRound<'info> {
    #[account(
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump
    )]
    pub channel: Account<'info, Channel>,
    #[account(
        mut,
        seeds = [b"round", channel.key().as_ref(), round_index.to_le_bytes().as_ref()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        seeds = [b"member", channel.key().as_ref(), member.user.as_ref()],
        bump = member.bump
    )]
    pub member: Account<'info, Member>,
}

#[derive(Accounts)]
#[instruction(round_index: u16)]
pub struct ScheduleLockCrank<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump
    )]
    pub channel: Account<'info, Channel>,
    #[account(
        mut,
        seeds = [b"round", channel.key().as_ref(), round_index.to_le_bytes().as_ref()],
        bump = round.bump
    )]
    pub round: Account<'info, Round>,
    /// CHECK: the MagicBlock magic program
    #[account(address = ephemeral_rollups_sdk::consts::MAGIC_PROGRAM_ID)]
    pub magic_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct ExtendChannel<'info> {
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump,
        has_one = host @ SquawkError::Unauthorized
    )]
    pub channel: Account<'info, Channel>,
}

#[commit]
#[derive(Accounts)]
pub struct CloseChannel<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump,
        has_one = host @ SquawkError::Unauthorized
    )]
    pub channel: Account<'info, Channel>,
}

#[commit]
#[derive(Accounts)]
pub struct CommitRounds<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = usdc_mint)]
    pub config: Account<'info, Config>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [b"channel", channel.channel_id.to_le_bytes().as_ref()],
        bump = channel.bump
    )]
    pub channel: Account<'info, Channel>,
    #[account(
        mut,
        seeds = [b"member", channel.key().as_ref(), user.key().as_ref()],
        bump = member.bump
    )]
    pub member: Account<'info, Member>,
    #[account(mut, token::mint = usdc_mint, token::authority = user)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = usdc_mint,
        associated_token::authority = channel
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

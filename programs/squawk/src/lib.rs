use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
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
    ) -> Result<()> {
        require!(title.len() <= MAX_TITLE_LEN, SquawkError::TitleTooLong);
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
    pub fn delegate_channel(ctx: Context<DelegateChannel>, channel_id: u64) -> Result<()> {
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
            DelegateConfig::default(),
        )?;
        Ok(())
    }

    /// Instruction 4c — delegate one Member PDA to the ER. Host-only, Live only.
    /// (The channel account may itself already be delegated; only its data is
    /// read here, which survives delegation.)
    pub fn delegate_member(ctx: Context<DelegateMember>, _channel_id: u64, user: Pubkey) -> Result<()> {
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
            DelegateConfig::default(),
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

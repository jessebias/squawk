use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use ephemeral_rollups_sdk::anchor::ephemeral;

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

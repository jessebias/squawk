use anchor_lang::prelude::*;

pub mod errors;
pub mod state;

declare_id!("4NT1YGUK1YWboAq9pyKLqGsHUQaRwDAi7kpATd6Ynuii");

#[program]
pub mod squawk {
    use super::*;

    /// Placeholder until Phase 1 lands the real instruction set (docs/plan.md §5.2).
    pub fn ping(_ctx: Context<Ping>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Ping {}

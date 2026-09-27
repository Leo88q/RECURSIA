//! Seasons: a weekly tournament funded by 25% of the studio's income.
//!
//! * Points = SKR a player collected from life (epoch rewards + host tax),
//!   accumulated in `Player::season_points` by `collect`.
//! * `season_submit` (permissionless) keeps the on-chain top-10 current: O(10).
//! * `advance_epoch` closes the season every `SEASON_EPOCHS` epochs and fixes
//!   prizes: rank share of the pool, but never more than
//!   `SEASON_PRIZE_CAP_BPS` of the winner's own points — buying points costs
//!   more than the prize they can win, so leaderboard farming never pays.
//! * `claim_season_prize` (permissionless) credits a fixed prize to the
//!   winner's own game balance; unclaimed prizes roll into the next season.
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::RecursiaError;
use crate::events::*;
use crate::instructions::common::*;
use crate::math;
use crate::state::*;

#[derive(Accounts)]
pub struct SeasonSubmit<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_SEASON], bump = config.season_bump)]
    pub season: Box<Account<'info, Season>>,
    /// Any player account. `Account<Player>` checks owner + discriminator and
    /// the program only ever creates players at [SEED_PLAYER, owner].
    pub player: Box<Account<'info, Player>>,
}

/// Insert / update `entry` in a points-desc top list. Existing entries keep
/// their rank on ties (stable sort). Returns false if it did not qualify.
pub fn leaderboard_insert(top: &mut [SeasonEntry], entry: SeasonEntry) -> bool {
    if let Some(pos) = top.iter().position(|e| e.player == entry.player) {
        top[pos].points = top[pos].points.max(entry.points);
    } else {
        let last = top.len() - 1;
        if top[last].player != Pubkey::default() && top[last].points >= entry.points {
            return false;
        }
        top[last] = entry;
    }
    top.sort_by(|a, b| b.points.cmp(&a.points));
    true
}

pub fn season_submit(ctx: Context<SeasonSubmit>) -> Result<()> {
    let p = &ctx.accounts.player;
    require!(
        p.season_id == ctx.accounts.config.season_id && p.season_points > 0,
        RecursiaError::NoSeasonPoints
    );
    let entry = SeasonEntry { player: p.owner, points: p.season_points };
    leaderboard_insert(&mut ctx.accounts.season.top, entry);
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimSeasonPrize<'info> {
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [SEED_SEASON], bump = config.season_bump)]
    pub season: Box<Account<'info, Season>>,
    /// The winner's player account (checked against the standings below).
    #[account(mut)]
    pub player: Box<Account<'info, Player>>,
    #[account(mut, seeds = [SEED_SEASON_POOL], bump = config.season_pool_bump)]
    pub season_pool: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Permissionless: the prize can only ever go to the winner's own balance.
pub fn claim_season_prize(ctx: Context<ClaimSeasonPrize>, rank: u8) -> Result<()> {
    let r = rank as usize;
    require!(r < SEASON_TOP, RecursiaError::NoPrize);
    let s = &mut ctx.accounts.season;
    let e = s.last_top[r];
    require!(
        e.player != Pubkey::default() && e.player == ctx.accounts.player.owner,
        RecursiaError::NoPrize
    );
    require!(s.last_claimed & (1u16 << r) == 0, RecursiaError::NoPrize);
    let amount = s.last_prizes[r];
    require!(amount > 0, RecursiaError::NoPrize);
    // effects before the transfer (#7)
    s.last_claimed |= 1u16 << r;
    let season_id = s.last_id;
    let pl = &mut ctx.accounts.player;
    pl.claimable = math::add(pl.claimable, amount)?;
    pl.total_earned = math::add(pl.total_earned, amount)?;
    let c = &mut ctx.accounts.config;
    c.total_season_paid = math::add(c.total_season_paid, amount)?;
    let bump = c.bump;
    vault_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.season_pool.to_account_info(),
        &ctx.accounts.claims_vault.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        bump,
        amount,
    )?;
    emit!(SeasonPrizePaid { season: season_id, rank, player: e.player, amount });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pk(n: u8) -> Pubkey {
        Pubkey::new_from_array([n; 32])
    }

    #[test]
    fn leaderboard_keeps_top_ten_sorted() {
        let mut top = [SeasonEntry::default(); SEASON_TOP];
        for n in 1..=12u8 {
            leaderboard_insert(&mut top, SeasonEntry { player: pk(n), points: n as u64 * 10 });
        }
        assert_eq!(top[0].player, pk(12));
        assert_eq!(top[9].player, pk(3));
        // too few points: rejected
        assert!(!leaderboard_insert(&mut top, SeasonEntry { player: pk(50), points: 30 }));
        // an existing entry moves up, no duplicates
        assert!(leaderboard_insert(&mut top, SeasonEntry { player: pk(3), points: 1_000 }));
        assert_eq!(top[0].player, pk(3));
        assert_eq!(top.iter().filter(|e| e.player == pk(3)).count(), 1);
        for w in top.windows(2) {
            assert!(w[0].points >= w[1].points);
        }
    }
}

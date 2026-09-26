use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::RecursiaError;
use crate::events::*;
use crate::instructions::common::*;
use crate::math;
use crate::state::*;

/// "Breaking the fourth wall": the inhabitants of a universe can overthrow
/// its architect. Votes are weighted by held territories (which cost real,
/// continuously-taxed tokens — Sybil resistance by economics), one active
/// rebellion at a time, long cooldown (anti proposal-spam, checklist #62).
#[derive(Accounts)]
pub struct RebellionVote<'info> {
    pub holder: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(
        mut, seeds = [SEED_TERRITORY, world.key().as_ref(), &[territory.index]], bump = territory.bump,
        constraint = territory.holder == holder.key() @ RecursiaError::NotHolder
    )]
    pub territory: Box<Account<'info, Territory>>,
}

pub fn start_rebellion(ctx: Context<RebellionVote>) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    let slot = Clock::get()?.slot;
    let p = ctx.accounts.config.params;
    let w = &mut ctx.accounts.world;
    require!(w.has_architect() && !w.liberated, RecursiaError::RebellionUnavailable);
    require!(!w.rebellion_active(slot), RecursiaError::RebellionUnavailable);
    require!(
        w.last_rebellion_slot == 0 || slot >= w.last_rebellion_slot.saturating_add(REBELLION_COOLDOWN_SLOTS),
        RecursiaError::Cooldown
    );
    // the architect cannot start a rebellion against themself (griefing guard)
    require_keys_neq!(ctx.accounts.holder.key(), w.architect, RecursiaError::Unauthorized);
    require!(ctx.accounts.territory.acquired_slot < slot, RecursiaError::RebellionUnavailable);
    w.rebellion_id = w.rebellion_id.checked_add(1).ok_or(RecursiaError::MathOverflow)?;
    w.rebellion_votes = 1;
    w.rebellion_deadline = slot.saturating_add(p.epoch_slots);
    w.last_rebellion_slot = slot;
    ctx.accounts.territory.voted_rebellion = w.rebellion_id;
    Ok(())
}

pub fn vote_rebellion(ctx: Context<RebellionVote>) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    let slot = Clock::get()?.slot;
    let w = &mut ctx.accounts.world;
    require!(w.rebellion_active(slot), RecursiaError::RebellionUnavailable);
    let t = &mut ctx.accounts.territory;
    require!(t.voted_rebellion != w.rebellion_id, RecursiaError::AlreadyVoted);
    // territories bought after the rebellion started can't vote (anti flash-buy)
    require!(t.acquired_slot < w.last_rebellion_slot, RecursiaError::RebellionUnavailable);
    t.voted_rebellion = w.rebellion_id;
    w.rebellion_votes = w.rebellion_votes.saturating_add(1);
    Ok(())
}

#[derive(Accounts)]
pub struct ExecuteRebellion<'info> {
    #[account(mut)]
    pub executor: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    /// Former architect keeps what they already earned (paid to their Player).
    #[account(
        init_if_needed, payer = executor, space = 8 + Player::INIT_SPACE,
        seeds = [SEED_PLAYER, world.architect.as_ref()], bump
    )]
    pub architect_player: Box<Account<'info, Player>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn execute_rebellion(ctx: Context<ExecuteRebellion>) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    let slot = Clock::get()?.slot;
    let w = &mut ctx.accounts.world;
    require!(w.rebellion_active(slot), RecursiaError::RebellionUnavailable);
    let owned = w.owned_mask.count_ones() as u64;
    let votes = w.rebellion_votes as u64;
    require!(
        votes >= REBELLION_MIN_VOTES as u64 && votes * BPS >= owned * REBELLION_THRESHOLD_BPS,
        RecursiaError::RebellionThreshold
    );
    let former = w.architect;
    let accrued = w.architect_accrued;
    w.architect_accrued = 0;
    w.architect = Pubkey::default();
    w.architect_fee_bps = 0;
    w.liberated = true;
    w.rebellion_deadline = slot; // close it
    let final_votes = w.rebellion_votes;
    let pl = &mut ctx.accounts.architect_player;
    if pl.owner == Pubkey::default() {
        pl.version = ACCOUNT_VERSION;
        pl.bump = ctx.bumps.architect_player;
        pl.owner = former;
    }
    require_keys_eq!(pl.owner, former, RecursiaError::Mismatch);
    pl.claimable = math::add(pl.claimable, accrued)?;
    pl.total_earned = math::add(pl.total_earned, accrued)?;
    let bump = ctx.accounts.config.bump;
    vault_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.world_vault.to_account_info(),
        &ctx.accounts.claims_vault.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        bump,
        accrued,
    )?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    emit!(Liberated { world: ctx.accounts.world.key(), former_architect: former, votes: final_votes });
    Ok(())
}

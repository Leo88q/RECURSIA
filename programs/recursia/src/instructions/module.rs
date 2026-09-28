use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::RecursiaError;
use crate::instructions::common::*;
use crate::math;
use crate::state::*;

/// Developers publish "laws of physics" (B/S rule sets). Every tick of every
/// world using the module pays the author a royalty — an on-chain rules
/// marketplace rather than an item marketplace.
#[derive(Accounts)]
pub struct RegisterModule<'info> {
    #[account(mut)]
    pub author: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init, payer = author, space = 8 + PhysicsModule::INIT_SPACE,
        seeds = [SEED_MODULE, &config.modules.to_le_bytes()], bump
    )]
    pub module: Box<Account<'info, PhysicsModule>>,
    #[account(mut, token::mint = mint, token::authority = author)]
    pub author_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_TREASURY], bump = config.treasury_bump)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    /// Player reward pool (SKR). Receives the non-studio part of every spend.
    #[account(mut, seeds = [SEED_REWARD_POOL], bump = config.reward_pool_bump)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn register_module(
    ctx: Context<RegisterModule>,
    birth: u16,
    survive: u16,
    royalty_bps: u16,
    name: [u8; 32],
    q_birth: u16,
    q_survive: u16,
    q_amp: u8,
) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    validate_rule(birth, survive)?;
    validate_quantum_rule(birth, survive, q_birth, q_survive, q_amp)?;
    validate_name(&name)?;
    require!(royalty_bps <= MAX_ROYALTY_BPS, RecursiaError::InvalidParams);

    let p = ctx.accounts.config.params;
    let (studio, to_pool) = math::split_spend(p.module_register_fee, p.protocol_bps)?;
    record_pool_inflow(&mut ctx.accounts.config, to_pool)?;
    let tp = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();
    let from = ctx.accounts.author_token.to_account_info();
    let auth = ctx.accounts.author.to_account_info();
    user_spend(
        &tp, &mint, &from, &auth,
        &ctx.accounts.treasury.to_account_info(), &ctx.accounts.reward_pool.to_account_info(),
        studio, to_pool,
    )?;

    let c = &mut ctx.accounts.config;
    let m = &mut ctx.accounts.module;
    m.version = ACCOUNT_VERSION;
    m.bump = ctx.bumps.module;
    m.id = c.modules;
    m.author = ctx.accounts.author.key();
    m.birth = birth;
    m.survive = survive;
    m.royalty_bps = royalty_bps;
    m.name = name;
    m.q_birth = q_birth;
    m.q_survive = q_survive;
    m.q_amp = q_amp;
    c.modules = c.modules.checked_add(1).ok_or(RecursiaError::MathOverflow)?;
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimModuleRoyalties<'info> {
    #[account(mut)]
    pub author: Signer<'info>,
    #[account(mut, has_one = author)]
    pub module: Box<Account<'info, PhysicsModule>>,
    #[account(
        init_if_needed, payer = author, space = 8 + Player::INIT_SPACE,
        seeds = [SEED_PLAYER, author.key().as_ref()], bump
    )]
    pub player: Box<Account<'info, Player>>,
    pub system_program: Program<'info, System>,
}

/// Royalty tokens already sit in the claims vault; this only moves the
/// ledger entry to the author's withdrawable balance.
pub fn claim_module_royalties(ctx: Context<ClaimModuleRoyalties>) -> Result<()> {
    let amount = ctx.accounts.module.accrued;
    require!(amount > 0, RecursiaError::NothingToClaim);
    ctx.accounts.module.accrued = 0;
    let pl = &mut ctx.accounts.player;
    if pl.owner == Pubkey::default() {
        pl.version = ACCOUNT_VERSION;
        pl.bump = ctx.bumps.player;
        pl.owner = ctx.accounts.author.key();
    }
    pl.claimable = math::add(pl.claimable, amount)?;
    pl.total_earned = math::add(pl.total_earned, amount)?;
    Ok(())
}

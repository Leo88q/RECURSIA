use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::RecursiaError;
use crate::events::*;
use crate::instructions::common::*;
use crate::math;
use crate::program::Recursia;
use crate::state::*;

// ---------------------------------------------------------------- initialize

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// Only the program's upgrade authority can initialize — prevents anyone
    /// from front-running initialization and becoming admin.
    #[account(constraint = program.programdata_address()? == Some(program_data.key()) @ RecursiaError::Unauthorized)]
    pub program: Program<'info, Recursia>,
    #[account(constraint = program_data.upgrade_authority_address == Some(authority.key()) @ RecursiaError::Unauthorized)]
    pub program_data: Account<'info, ProgramData>,
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [SEED_CONFIG], bump)]
    pub config: Box<Account<'info, Config>>,
    /// The SKR mint (external, classic SPL Token — `Account<Mint>` enforces
    /// the Tokenkeg owner, so Token-2022 extensions can't sneak in, #12).
    /// No freeze authority: nobody can freeze the game's vaults (#11).
    #[account(
        constraint = mint.decimals == DECIMALS @ RecursiaError::BadMint,
        constraint = mint.freeze_authority.is_none() @ RecursiaError::BadMint,
    )]
    pub mint: Box<Account<'info, Mint>>,
    #[account(init, payer = authority, seeds = [SEED_TREASURY], bump, token::mint = mint, token::authority = config)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = authority, seeds = [SEED_REWARD_POOL], bump, token::mint = mint, token::authority = config)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = authority, seeds = [SEED_CLAIMS], bump, token::mint = mint, token::authority = config)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize(ctx: Context<Initialize>, admin: Pubkey, params: Params) -> Result<()> {
    // Mainnet builds accept only the official SKR mint (counterfeits exist).
    #[cfg(feature = "mainnet")]
    require_keys_eq!(ctx.accounts.mint.key(), SKR_MINT, RecursiaError::BadMint);
    params.validate()?;
    require!(admin != Pubkey::default(), RecursiaError::Unauthorized);
    let c = &mut ctx.accounts.config;
    c.version = ACCOUNT_VERSION;
    c.bump = ctx.bumps.config;
    c.treasury_bump = ctx.bumps.treasury;
    c.reward_pool_bump = ctx.bumps.reward_pool;
    c.claims_bump = ctx.bumps.claims_vault;
    c.admin = admin;
    c.mint = ctx.accounts.mint.key();
    c.paused = false;
    c.params = params;
    c.pending = PendingAction::None;
    c.pending_eta = 0;
    c.pending_nonce = 0;
    c.cur_epoch = 1;
    c.epoch_start_slot = Clock::get()?.slot;
    Ok(())
}

// ---------------------------------------------------------------- reward pool

/// Anyone (studio, partners, sponsors) may top up the player reward pool.
/// SKR sent here can never be withdrawn by the admin: the only way out of the
/// pool is epoch emission to worlds (checklist #10/#53).
#[derive(Accounts)]
pub struct FundRewardPool<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [SEED_REWARD_POOL], bump = config.reward_pool_bump)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = funder)]
    pub funder_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn fund_reward_pool(ctx: Context<FundRewardPool>, amount: u64) -> Result<()> {
    require!(amount > 0, RecursiaError::ZeroAmount);
    user_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.funder_token.to_account_info(),
        &ctx.accounts.reward_pool.to_account_info(),
        &ctx.accounts.funder.to_account_info(),
        amount,
    )?;
    emit!(RewardPoolFunded { funder: ctx.accounts.funder.key(), amount });
    Ok(())
}

// ---------------------------------------------------------------- governance

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = admin)]
    pub config: Box<Account<'info, Config>>,
}

pub fn propose(ctx: Context<AdminOnly>, action: PendingAction) -> Result<()> {
    let c = &mut ctx.accounts.config;
    require!(c.pending == PendingAction::None, RecursiaError::ActionAlreadyPending);
    match action {
        PendingAction::None => return err!(RecursiaError::NoPendingAction),
        PendingAction::SetParams(p) => p.validate()?,
        PendingAction::SetAdmin(a) => require!(a != Pubkey::default(), RecursiaError::Unauthorized),
        PendingAction::TreasurySpend { amount, .. } => require!(amount > 0, RecursiaError::InvalidParams),
    }
    let now = Clock::get()?.unix_timestamp;
    // Timelock uses the CURRENT (≥48h) value; it can never be zeroed (Drift lesson, #82).
    c.pending = action;
    c.pending_eta = now
        .checked_add(c.params.timelock_secs.max(MIN_TIMELOCK_SECS))
        .ok_or(RecursiaError::MathOverflow)?;
    c.pending_nonce = c.pending_nonce.checked_add(1).ok_or(RecursiaError::MathOverflow)?;
    emit!(GovernanceProposed { nonce: c.pending_nonce, eta: c.pending_eta });
    Ok(())
}

pub fn cancel(ctx: Context<AdminOnly>) -> Result<()> {
    let c = &mut ctx.accounts.config;
    require!(c.pending != PendingAction::None, RecursiaError::NoPendingAction);
    c.pending = PendingAction::None;
    c.pending_eta = 0;
    Ok(())
}

pub fn set_pause(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    // Pause only halts gameplay; it can never move funds. Withdrawals of
    // already-credited balances keep working while paused.
    ctx.accounts.config.paused = paused;
    emit!(PauseChanged { paused });
    Ok(())
}

#[derive(Accounts)]
#[instruction(expected_nonce: u64)]
pub struct Execute<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = admin, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [SEED_TREASURY], bump = config.treasury_bump)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    /// Required only for TreasurySpend; checked against the proposal.
    #[account(mut, token::mint = mint)]
    pub recipient: Option<Box<Account<'info, TokenAccount>>>,
    pub token_program: Program<'info, Token>,
}

/// `expected_nonce` binds the signature to one specific proposal, so an old
/// pre-signed (e.g. durable-nonce) execute cannot be replayed against a
/// different, later proposal (checklist #41/#82).
pub fn execute(ctx: Context<Execute>, expected_nonce: u64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let c = &ctx.accounts.config;
    require!(c.pending != PendingAction::None, RecursiaError::NoPendingAction);
    require!(c.pending_nonce == expected_nonce, RecursiaError::Mismatch);
    require!(now >= c.pending_eta, RecursiaError::TimelockActive);
    let action = c.pending;
    let bump = c.bump;
    match action {
        PendingAction::SetParams(p) => {
            p.validate()?;
            ctx.accounts.config.params = p;
        }
        PendingAction::SetAdmin(a) => {
            ctx.accounts.config.admin = a;
        }
        PendingAction::TreasurySpend { amount, recipient } => {
            let r = ctx.accounts.recipient.as_ref().ok_or(RecursiaError::Mismatch)?;
            require_keys_eq!(r.key(), recipient, RecursiaError::Mismatch);
            vault_transfer(
                &ctx.accounts.token_program.to_account_info(),
                &ctx.accounts.mint.to_account_info(),
                &ctx.accounts.treasury.to_account_info(),
                &r.to_account_info(),
                &ctx.accounts.config.to_account_info(),
                bump,
                amount,
            )?;
        }
        PendingAction::None => unreachable!(),
    }
    let c = &mut ctx.accounts.config;
    c.pending = PendingAction::None;
    c.pending_eta = 0;
    emit!(GovernanceExecuted { nonce: expected_nonce });
    Ok(())
}

// ---------------------------------------------------------------- epochs

#[derive(Accounts)]
pub struct AdvanceEpoch<'info> {
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(seeds = [SEED_REWARD_POOL], bump = config.reward_pool_bump)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
}

/// Permissionless crank. Closes the current epoch and reserves emission for
/// it. Unclaimed emission of the epoch before simply stays in the pool.
pub fn advance_epoch(ctx: Context<AdvanceEpoch>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let c = &mut ctx.accounts.config;
    let end = c
        .epoch_start_slot
        .checked_add(c.params.epoch_slots)
        .ok_or(RecursiaError::MathOverflow)?;
    require!(slot >= end, RecursiaError::EpochNotOver);
    let pool = ctx.accounts.reward_pool.amount;
    let emission = if c.cur_total_sink == 0 {
        0
    } else {
        math::bps_floor(pool, c.params.emission_rate_bps as u64)?
    };
    c.prev_total_sink = c.cur_total_sink;
    c.prev_emission = emission;
    c.prev_claimed = 0;
    c.cur_total_sink = 0;
    c.cur_epoch = c.cur_epoch.checked_add(1).ok_or(RecursiaError::MathOverflow)?;
    c.epoch_start_slot = slot;
    emit!(EpochAdvanced { epoch: c.cur_epoch - 1, total_sink: c.prev_total_sink, emission });
    Ok(())
}

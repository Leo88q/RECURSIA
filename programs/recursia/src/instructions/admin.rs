use anchor_lang::prelude::*;
use anchor_spl::token::spl_token::instruction::AuthorityType;
use anchor_spl::token::{self, Mint, MintTo, SetAuthority, Token, TokenAccount};

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
    /// Program-owned mint. No freeze authority from birth; mint authority is
    /// revoked in `genesis`.
    #[account(init, payer = authority, seeds = [SEED_MINT], bump, mint::decimals = DECIMALS, mint::authority = config)]
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
    params.validate()?;
    require!(admin != Pubkey::default(), RecursiaError::Unauthorized);
    let c = &mut ctx.accounts.config;
    c.version = ACCOUNT_VERSION;
    c.bump = ctx.bumps.config;
    c.mint_bump = ctx.bumps.mint;
    c.treasury_bump = ctx.bumps.treasury;
    c.reward_pool_bump = ctx.bumps.reward_pool;
    c.claims_bump = ctx.bumps.claims_vault;
    c.admin = admin;
    c.mint = ctx.accounts.mint.key();
    c.genesis_done = false;
    c.paused = false;
    c.params = params;
    c.pending = PendingAction::None;
    c.pending_eta = 0;
    c.pending_nonce = 0;
    c.cur_epoch = 1;
    c.epoch_start_slot = Clock::get()?.slot;
    Ok(())
}

// ---------------------------------------------------------------- genesis

#[derive(Accounts)]
pub struct Genesis<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = admin, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_MINT], bump = config.mint_bump)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [SEED_TREASURY], bump = config.treasury_bump)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_REWARD_POOL], bump = config.reward_pool_bump)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
    /// Genesis distribution account (should be owned by the team multisig /
    /// vesting program). Must be an RCR token account.
    #[account(mut, token::mint = mint)]
    pub distribution: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn genesis(ctx: Context<Genesis>) -> Result<()> {
    require!(!ctx.accounts.config.genesis_done, RecursiaError::GenesisDone);
    let pool = math::bps_floor(TOTAL_SUPPLY, REWARD_POOL_BPS)?;
    let treasury = math::bps_floor(TOTAL_SUPPLY, TREASURY_BPS)?;
    let dist = math::sub(math::sub(TOTAL_SUPPLY, pool)?, treasury)?;
    let bump = [ctx.accounts.config.bump];
    let seeds: &[&[u8]] = &[SEED_CONFIG, &bump];
    let tp = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();
    let auth = ctx.accounts.config.to_account_info();
    for (to, amt) in [
        (ctx.accounts.reward_pool.to_account_info(), pool),
        (ctx.accounts.treasury.to_account_info(), treasury),
        (ctx.accounts.distribution.to_account_info(), dist),
    ] {
        token::mint_to(
            CpiContext::new_with_signer(
                tp.clone(),
                MintTo { mint: mint.clone(), to, authority: auth.clone() },
                &[seeds],
            ),
            amt,
        )?;
    }
    // Revoke mint authority forever (checklist #11). Freeze authority was
    // never set.
    token::set_authority(
        CpiContext::new_with_signer(
            tp,
            SetAuthority { current_authority: auth, account_or_mint: mint },
            &[seeds],
        ),
        AuthorityType::MintTokens,
        None,
    )?;
    ctx.accounts.mint.reload()?;
    require!(ctx.accounts.mint.mint_authority.is_none(), RecursiaError::InvariantViolated);
    require!(ctx.accounts.mint.freeze_authority.is_none(), RecursiaError::InvariantViolated);
    require!(ctx.accounts.mint.supply == TOTAL_SUPPLY, RecursiaError::InvariantViolated);
    let c = &mut ctx.accounts.config;
    c.genesis_done = true;
    c.epoch_start_slot = Clock::get()?.slot;
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
    require!(c.genesis_done, RecursiaError::GenesisPending);
    let end = c
        .epoch_start_slot
        .checked_add(c.params.epoch_slots)
        .ok_or(RecursiaError::MathOverflow)?;
    require!(slot >= end, RecursiaError::EpochNotOver);
    let pool = ctx.accounts.reward_pool.amount;
    let emission = if c.cur_total_burn == 0 {
        0
    } else {
        math::bps_floor(pool, c.params.emission_rate_bps as u64)?
    };
    c.prev_total_burn = c.cur_total_burn;
    c.prev_emission = emission;
    c.prev_claimed = 0;
    c.cur_total_burn = 0;
    c.cur_epoch = c.cur_epoch.checked_add(1).ok_or(RecursiaError::MathOverflow)?;
    c.epoch_start_slot = slot;
    emit!(EpochAdvanced { epoch: c.cur_epoch - 1, total_burn: c.prev_total_burn, emission });
    Ok(())
}

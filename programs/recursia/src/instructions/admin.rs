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
    #[account(init, payer = authority, seeds = [SEED_SPONSOR_POOL], bump, token::mint = mint, token::authority = config)]
    pub sponsor_pool: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = authority, seeds = [SEED_SEASON_POOL], bump, token::mint = mint, token::authority = config)]
    pub season_pool: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = authority, space = 8 + Season::INIT_SPACE, seeds = [SEED_SEASON], bump)]
    pub season: Box<Account<'info, Season>>,
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
    c.sponsor_pool_bump = ctx.bumps.sponsor_pool;
    c.season_pool_bump = ctx.bumps.season_pool;
    c.season_bump = ctx.bumps.season;
    c.season_id = 1;
    c.season_start_epoch = 1;
    let s = &mut ctx.accounts.season;
    s.version = ACCOUNT_VERSION;
    s.bump = ctx.bumps.season;
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

/// Anyone may fund the sponsor pool. Unlike the reward pool it is paid out by
/// live cells (not by spend), so sponsor money is what lets the best players
/// end up net positive. Per-world cap: `SPONSOR_CAP_BPS` of the world's own
/// pool contribution. Nobody can withdraw it.
#[derive(Accounts)]
pub struct FundSponsorPool<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [SEED_SPONSOR_POOL], bump = config.sponsor_pool_bump)]
    pub sponsor_pool: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = funder)]
    pub funder_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn fund_sponsor_pool(ctx: Context<FundSponsorPool>, amount: u64) -> Result<()> {
    require!(amount > 0, RecursiaError::ZeroAmount);
    user_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.funder_token.to_account_info(),
        &ctx.accounts.sponsor_pool.to_account_info(),
        &ctx.accounts.funder.to_account_info(),
        amount,
    )?;
    emit!(SponsorPoolFunded { funder: ctx.accounts.funder.key(), amount });
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
            // Only treasury funds already split with the season pool are
            // spendable: governance can never spend the players' season share.
            let seen = ctx.accounts.config.treasury_seen;
            require!(amount <= seen, RecursiaError::TreasuryLocked);
            ctx.accounts.config.treasury_seen = seen - amount;
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
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(seeds = [SEED_REWARD_POOL], bump = config.reward_pool_bump)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
    #[account(seeds = [SEED_SPONSOR_POOL], bump = config.sponsor_pool_bump)]
    pub sponsor_pool: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_TREASURY], bump = config.treasury_bump)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_SEASON_POOL], bump = config.season_pool_bump)]
    pub season_pool: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_SEASON], bump = config.season_bump)]
    pub season: Box<Account<'info, Season>>,
    pub token_program: Program<'info, Token>,
}

/// Permissionless crank. Closes the current epoch and reserves emission and
/// sponsor budget for it (unclaimed amounts of the epoch before simply stay in
/// their pools). Also sweeps the season share of new treasury inflow into the
/// season pool and closes the season every `SEASON_EPOCHS` epochs.
pub fn advance_epoch(ctx: Context<AdvanceEpoch>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let pool = ctx.accounts.reward_pool.amount;
    let sponsor = ctx.accounts.sponsor_pool.amount;
    let treasury_amount = ctx.accounts.treasury.amount;
    let season_pool_before = ctx.accounts.season_pool.amount;
    let c = &mut ctx.accounts.config;
    let end = c
        .epoch_start_slot
        .checked_add(c.params.epoch_slots)
        .ok_or(RecursiaError::MathOverflow)?;
    require!(slot >= end, RecursiaError::EpochNotOver);
    let emission = if c.cur_total_sink == 0 {
        0
    } else {
        math::bps_floor(pool, c.params.emission_rate_bps as u64)?
    };
    let sponsor_budget = if c.cur_total_score == 0 || c.cur_total_sink == 0 {
        0
    } else {
        math::bps_floor(sponsor, SPONSOR_RATE_BPS)?
    };
    c.prev_total_sink = c.cur_total_sink;
    c.prev_emission = emission;
    c.prev_claimed = 0;
    c.cur_total_sink = 0;
    c.prev_total_score = c.cur_total_score;
    c.prev_sponsor_budget = sponsor_budget;
    c.prev_sponsor_claimed = 0;
    c.cur_total_score = 0;
    c.cur_epoch = c.cur_epoch.checked_add(1).ok_or(RecursiaError::MathOverflow)?;
    c.epoch_start_slot = slot;

    // --- season share of the studio inflow since the last sweep (state first, #7)
    let inflow = treasury_amount.saturating_sub(c.treasury_seen);
    let season_share = math::bps_floor(inflow, SEASON_SHARE_BPS)?;
    c.treasury_seen = math::sub(treasury_amount, season_share)?;
    c.total_season_funded = math::add(c.total_season_funded, season_share)?;
    let season_pool_now = math::add(season_pool_before, season_share)?;
    let season_id = c.season_id;

    // --- season close: fix prizes of the finished season
    let close = c.cur_epoch.saturating_sub(c.season_start_epoch) >= SEASON_EPOCHS;
    let mut prizes_total = 0u64;
    if close {
        let s = &mut ctx.accounts.season;
        // Unpaid prizes of the season before are forfeited: they never left
        // the season pool, so the whole pool balance is available again.
        let mut prizes = [0u64; SEASON_TOP];
        for (r, e) in s.top.iter().enumerate() {
            if e.player != Pubkey::default() {
                prizes[r] = math::season_prize(season_pool_now, SEASON_RANK_BPS[r], e.points)?;
                prizes_total = math::add(prizes_total, prizes[r])?;
            }
        }
        s.last_id = season_id;
        s.last_top = s.top;
        s.last_prizes = prizes;
        s.last_claimed = 0;
        s.top = [SeasonEntry::default(); SEASON_TOP];
        c.season_id = season_id.checked_add(1).ok_or(RecursiaError::MathOverflow)?;
        c.season_start_epoch = c.cur_epoch;
    }
    let bump = c.bump;
    emit!(EpochAdvanced { epoch: c.cur_epoch - 1, total_sink: c.prev_total_sink, emission });

    vault_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.treasury.to_account_info(),
        &ctx.accounts.season_pool.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        bump,
        season_share,
    )?;
    if season_share > 0 {
        emit!(SeasonFunded { season: season_id, amount: season_share });
    }
    if close {
        emit!(SeasonClosed { season: season_id, prize_pool: season_pool_now, prizes_total });
    }
    Ok(())
}

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::RecursiaError;
use crate::events::*;
use crate::instructions::common::*;
use crate::math;
use crate::sim;
use crate::state::*;

/// Deterministic initial universe derived from the world address.
pub fn bigbang(world: &Pubkey) -> sim::Grid {
    let seed = hashv(&[b"recursia:bigbang", world.as_ref()]).to_bytes();
    let mut digests = [[0u8; 32]; 32];
    for (i, d) in digests.iter_mut().enumerate() {
        *d = hashv(&[&seed, &[i as u8]]).to_bytes();
    }
    sim::bigbang_from_digests(&digests)
}

#[allow(clippy::too_many_arguments)]
fn init_world(
    w: &mut World,
    key: Pubkey,
    bump: u8,
    vault_bump: u8,
    parent: Pubkey,
    parent_territory: u8,
    depth: u8,
    index: u64,
    architect: Pubkey,
    architect_fee_bps: u16,
    module: &PhysicsModule,
    module_key: Pubkey,
    name: [u8; 32],
    slot: u64,
    epoch: u64,
) {
    w.version = ACCOUNT_VERSION;
    w.bump = bump;
    w.vault_bump = vault_bump;
    w.depth = depth;
    w.parent = parent;
    w.parent_territory = parent_territory;
    w.index = index;
    w.architect = architect;
    w.architect_fee_bps = architect_fee_bps;
    w.module = module_key;
    w.birth = module.birth;
    w.survive = module.survive;
    w.name = name;
    w.grid = bigbang(&key);
    w.territory_alive = sim::territory_counts(&w.grid);
    w.last_tick_slot = slot;
    w.created_slot = slot;
    w.epoch_id = epoch;
    w.prev_epoch_id = epoch.saturating_sub(1);
    w.prev_claimed = true;
}

// ---------------------------------------------------------------- create root

#[derive(Accounts)]
pub struct CreateRootWorld<'info> {
    #[account(mut)]
    pub architect: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub module: Box<Account<'info, PhysicsModule>>,
    #[account(
        init, payer = architect, space = 8 + World::INIT_SPACE,
        seeds = [SEED_WORLD, Pubkey::default().as_ref(), &config.root_worlds.to_le_bytes()], bump
    )]
    pub world: Box<Account<'info, World>>,
    #[account(
        init, payer = architect, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump,
        token::mint = mint, token::authority = config
    )]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = architect)]
    pub architect_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_TREASURY], bump = config.treasury_bump)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn create_root_world(
    ctx: Context<CreateRootWorld>,
    architect_fee_bps: u16,
    name: [u8; 32],
    initial_energy: u64,
) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    validate_name(&name)?;
    require!(architect_fee_bps <= MAX_ARCHITECT_FEE_BPS, RecursiaError::InvalidParams);
    let slot = Clock::get()?.slot;
    let p = ctx.accounts.config.params;
    pay_creation_fee(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.architect_token.to_account_info(),
        &ctx.accounts.architect.to_account_info(),
        &ctx.accounts.treasury.to_account_info(),
        &mut ctx.accounts.config,
        p.world_create_fee,
    )?;
    user_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.architect_token.to_account_info(),
        &ctx.accounts.world_vault.to_account_info(),
        &ctx.accounts.architect.to_account_info(),
        initial_energy,
    )?;
    let key = ctx.accounts.world.key();
    let c = &mut ctx.accounts.config;
    let index = c.root_worlds;
    let epoch = c.cur_epoch;
    c.root_worlds = c.root_worlds.checked_add(1).ok_or(RecursiaError::MathOverflow)?;
    c.total_worlds = c.total_worlds.checked_add(1).ok_or(RecursiaError::MathOverflow)?;
    let module_key = ctx.accounts.module.key();
    ctx.accounts.module.worlds_using = ctx.accounts.module.worlds_using.saturating_add(1);
    let w = &mut ctx.accounts.world;
    init_world(
        w,
        key,
        ctx.bumps.world,
        ctx.bumps.world_vault,
        Pubkey::default(),
        0,
        0,
        index,
        ctx.accounts.architect.key(),
        architect_fee_bps,
        &ctx.accounts.module,
        module_key,
        name,
        slot,
        epoch,
    );
    w.energy = initial_energy;
    emit!(WorldCreated {
        world: key,
        parent: Pubkey::default(),
        parent_territory: 0,
        depth: 0,
        architect: w.architect,
        module: module_key,
    });
    Ok(())
}

fn pay_creation_fee<'info>(
    tp: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    auth: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    config: &mut Config,
    fee: u64,
) -> Result<()> {
    let burn = math::bps_floor(fee, config.params.fee_burn_bps as u64)?;
    user_burn(tp, mint, from, auth, burn)?;
    user_transfer(tp, mint, from, treasury, auth, math::sub(fee, burn)?)?;
    config.total_burned = math::add(config.total_burned, burn)?;
    Ok(())
}

// ---------------------------------------------------------------- create child

/// "Simulation inside a simulation": a territory holder spawns a universe
/// that lives *inside* their 8x8 block. It can only tick while that block has
/// living cells, and pays a host tax that flows up to the block's holder.
#[derive(Accounts)]
#[instruction(host_index: u8)]
pub struct CreateChildWorld<'info> {
    #[account(mut)]
    pub architect: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub module: Box<Account<'info, PhysicsModule>>,
    #[account(mut)]
    pub host_world: Box<Account<'info, World>>,
    #[account(
        mut,
        seeds = [SEED_TERRITORY, host_world.key().as_ref(), &[host_index]], bump = host_territory.bump,
        constraint = host_territory.holder == architect.key() @ RecursiaError::NotHolder,
        constraint = host_territory.child_world == Pubkey::default() @ RecursiaError::AlreadyHeld,
    )]
    pub host_territory: Box<Account<'info, Territory>>,
    #[account(
        init, payer = architect, space = 8 + World::INIT_SPACE,
        seeds = [SEED_WORLD, host_world.key().as_ref(), &(host_index as u64).to_le_bytes()], bump
    )]
    pub world: Box<Account<'info, World>>,
    #[account(
        init, payer = architect, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump,
        token::mint = mint, token::authority = config
    )]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = architect)]
    pub architect_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_TREASURY], bump = config.treasury_bump)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn create_child_world(
    ctx: Context<CreateChildWorld>,
    host_index: u8,
    architect_fee_bps: u16,
    name: [u8; 32],
    initial_energy: u64,
) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    validate_name(&name)?;
    require!(architect_fee_bps <= MAX_ARCHITECT_FEE_BPS, RecursiaError::InvalidParams);
    let depth = ctx.accounts.host_world.depth.checked_add(1).ok_or(RecursiaError::MathOverflow)?;
    require!(depth <= MAX_DEPTH, RecursiaError::MaxDepth);
    let slot = Clock::get()?.slot;
    let p = ctx.accounts.config.params;

    // host must not be in tax default
    {
        let hw = &mut ctx.accounts.host_world;
        let ht = &mut ctx.accounts.host_territory;
        require_keys_eq!(ht.world, hw.key(), RecursiaError::Mismatch);
        require!(ht.index == host_index, RecursiaError::Mismatch);
        if let TaxOutcome::Foreclose = accrue_tax(hw, ht, &p, slot)? {
            return err!(RecursiaError::DepositTooSmall);
        }
    }
    pay_creation_fee(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.architect_token.to_account_info(),
        &ctx.accounts.architect.to_account_info(),
        &ctx.accounts.treasury.to_account_info(),
        &mut ctx.accounts.config,
        p.world_create_fee,
    )?;
    user_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.architect_token.to_account_info(),
        &ctx.accounts.world_vault.to_account_info(),
        &ctx.accounts.architect.to_account_info(),
        initial_energy,
    )?;
    let key = ctx.accounts.world.key();
    let host_key = ctx.accounts.host_world.key();
    let idx = ctx.accounts.host_territory.index;
    ctx.accounts.host_territory.child_world = key;
    ctx.accounts.host_world.child_count = ctx.accounts.host_world.child_count.saturating_add(1);
    let c = &mut ctx.accounts.config;
    let epoch = c.cur_epoch;
    c.total_worlds = c.total_worlds.checked_add(1).ok_or(RecursiaError::MathOverflow)?;
    let module_key = ctx.accounts.module.key();
    ctx.accounts.module.worlds_using = ctx.accounts.module.worlds_using.saturating_add(1);
    let w = &mut ctx.accounts.world;
    init_world(
        w,
        key,
        ctx.bumps.world,
        ctx.bumps.world_vault,
        host_key,
        idx,
        depth,
        idx as u64,
        ctx.accounts.architect.key(),
        architect_fee_bps,
        &ctx.accounts.module,
        module_key,
        name,
        slot,
        epoch,
    );
    w.energy = initial_energy;
    emit!(WorldCreated {
        world: key,
        parent: host_key,
        parent_territory: idx,
        depth,
        architect: w.architect,
        module: module_key,
    });
    Ok(())
}

// ---------------------------------------------------------------- fund

#[derive(Accounts)]
pub struct FundWorld<'info> {
    pub funder: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = funder)]
    pub funder_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn fund_world(ctx: Context<FundWorld>, amount: u64) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    require!(amount > 0, RecursiaError::NothingToClaim);
    user_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.funder_token.to_account_info(),
        &ctx.accounts.world_vault.to_account_info(),
        &ctx.accounts.funder.to_account_info(),
        amount,
    )?;
    let w = &mut ctx.accounts.world;
    w.energy = math::add(w.energy, amount)?;
    Ok(())
}

// ---------------------------------------------------------------- tick

#[derive(Accounts)]
pub struct Tick<'info> {
    pub cranker: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, address = world.module @ RecursiaError::Mismatch)]
    pub module: Box<Account<'info, PhysicsModule>>,
    #[account(mut, seeds = [SEED_TREASURY], bump = config.treasury_bump)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = cranker)]
    pub cranker_token: Box<Account<'info, TokenAccount>>,
    /// Required iff `world` is a child universe.
    #[account(mut)]
    pub host_world: Option<Box<Account<'info, World>>>,
    #[account(mut)]
    pub host_vault: Option<Box<Account<'info, TokenAccount>>>,
    pub token_program: Program<'info, Token>,
}

pub fn tick(ctx: Context<Tick>) -> Result<()> {
    require_active(&ctx.accounts.config)?;
    let slot = Clock::get()?.slot;
    let p = ctx.accounts.config.params;
    let config_bump = ctx.accounts.config.bump;
    {
        let w = &ctx.accounts.world;
        let next = w.last_tick_slot.checked_add(p.tick_interval_slots).ok_or(RecursiaError::MathOverflow)?;
        require!(slot >= next, RecursiaError::TickTooEarly);
        require!(w.energy >= p.tick_cost, RecursiaError::OutOfEnergy);
    }
    let world_key = ctx.accounts.world.key();
    let is_child = !ctx.accounts.world.is_root();

    // --- host coupling checks
    if is_child {
        let hw = ctx.accounts.host_world.as_ref().ok_or(RecursiaError::Mismatch)?;
        let hv = ctx.accounts.host_vault.as_ref().ok_or(RecursiaError::Mismatch)?;
        require_keys_eq!(hw.key(), ctx.accounts.world.parent, RecursiaError::Mismatch);
        require_keys_neq!(hw.key(), world_key, RecursiaError::DuplicateAccounts);
        let expected_vault = Pubkey::create_program_address(
            &[SEED_WORLD_VAULT, hw.key().as_ref(), &[hw.vault_bump]],
            ctx.program_id,
        )
        .map_err(|_| RecursiaError::Mismatch)?;
        require_keys_eq!(hv.key(), expected_vault, RecursiaError::Mismatch);
        let host_idx = ctx.accounts.world.parent_territory as usize;
        require!(hw.territory_alive[host_idx] > 0, RecursiaError::Dormant);
    }

    let split = math::split_tick(
        p.tick_cost,
        p.cranker_bps,
        p.protocol_bps,
        p.host_bps,
        ctx.accounts.module.royalty_bps,
        is_child,
    )?;

    // --- effects on state BEFORE external calls (checklist #7)
    let (generation, pop) = {
        let config_ro = Config::clone(&ctx.accounts.config);
        let w = &mut ctx.accounts.world;
        roll_world_epoch(w, &config_ro);
        w.energy = math::sub(w.energy, p.tick_cost)?;
        let g = sim::step_n(&w.grid, w.birth, w.survive, p.gens_per_tick);
        w.grid = g;
        let counts = sim::territory_counts(&g);
        w.territory_alive = counts;
        for (score, c) in w.scores_cur.iter_mut().zip(counts.iter()) {
            *score = score.saturating_add(*c as u32);
        }
        w.generation = w.generation.saturating_add(p.gens_per_tick as u64);
        w.tick_count = w.tick_count.saturating_add(1);
        w.last_tick_slot = slot;
        let pop = sim::population(&g);
        if is_child && pop >= BREACH_POPULATION {
            w.resonance = w.resonance.saturating_add(1).min(BREACH_RESONANCE);
        }
        (w.generation, pop)
    };
    record_burn(&mut ctx.accounts.world, &mut ctx.accounts.config, split.burn)?;
    let m = &mut ctx.accounts.module;
    m.accrued = math::add(m.accrued, split.royalty)?;
    if is_child {
        let hw = ctx.accounts.host_world.as_mut().ok_or(RecursiaError::Mismatch)?;
        let idx = ctx.accounts.world.parent_territory as usize;
        if (hw.owned_mask >> idx) & 1 == 1 {
            hw.territory_pending[idx] = math::add(hw.territory_pending[idx], split.host)?;
            hw.rewards_reserved = math::add(hw.rewards_reserved, split.host)?;
        } else {
            hw.energy = math::add(hw.energy, split.host)?;
        }
    }

    // --- interactions
    let tp = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();
    let vault = ctx.accounts.world_vault.to_account_info();
    let cfg = ctx.accounts.config.to_account_info();
    vault_transfer(&tp, &mint, &vault, &ctx.accounts.cranker_token.to_account_info(), &cfg, config_bump, split.cranker)?;
    vault_transfer(&tp, &mint, &vault, &ctx.accounts.treasury.to_account_info(), &cfg, config_bump, split.protocol)?;
    vault_transfer(&tp, &mint, &vault, &ctx.accounts.claims_vault.to_account_info(), &cfg, config_bump, split.royalty)?;
    if is_child {
        let hv = ctx.accounts.host_vault.as_ref().ok_or(RecursiaError::Mismatch)?;
        vault_transfer(&tp, &mint, &vault, &hv.to_account_info(), &cfg, config_bump, split.host)?;
    }
    vault_burn(&tp, &mint, &vault, &cfg, config_bump, split.burn)?;

    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    if is_child {
        let hv = ctx.accounts.host_vault.as_mut().ok_or(RecursiaError::Mismatch)?;
        hv.reload()?;
        let amt = hv.amount;
        assert_world_solvent(ctx.accounts.host_world.as_ref().ok_or(RecursiaError::Mismatch)?, amt)?;
    }
    emit!(Ticked {
        world: world_key,
        generation,
        population: pop,
        burned: split.burn,
        host_tax: split.host,
        royalty: split.royalty,
        cranker: ctx.accounts.cranker.key(),
    });
    Ok(())
}

// ---------------------------------------------------------------- emission

#[derive(Accounts)]
pub struct ClaimWorldEpoch<'info> {
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_REWARD_POOL], bump = config.reward_pool_bump)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Permissionless crank: pulls the world's emission share for the previous
/// epoch and splits it across territories by accumulated live-cell score.
pub fn claim_world_epoch(ctx: Context<ClaimWorldEpoch>) -> Result<()> {
    require_active(&ctx.accounts.config)?;
    let config_ro = Config::clone(&ctx.accounts.config);
    let w = &mut ctx.accounts.world;
    roll_world_epoch(w, &config_ro);
    require!(
        !w.prev_claimed && w.prev_epoch_id.checked_add(1) == Some(config_ro.cur_epoch),
        RecursiaError::ClaimWindow
    );
    let reward = math::world_emission(
        config_ro.prev_emission,
        config_ro.prev_total_burn,
        w.burn_prev,
        config_ro.params.rebate_cap_bps,
        config_ro.prev_claimed,
    )?;
    w.prev_claimed = true;
    require!(reward > 0, RecursiaError::NothingToClaim);
    let (shares, rest) = math::distribute(reward, &w.scores_prev, &owned_array(w.owned_mask))?;
    let mut credited = 0u64;
    for (i, s) in shares.iter().enumerate() {
        if *s > 0 {
            w.territory_pending[i] = math::add(w.territory_pending[i], *s)?;
            credited = math::add(credited, *s)?;
        }
    }
    w.rewards_reserved = math::add(w.rewards_reserved, credited)?;
    w.energy = math::add(w.energy, rest)?;
    let epoch = w.prev_epoch_id;
    let c = &mut ctx.accounts.config;
    c.prev_claimed = math::add(c.prev_claimed, reward)?;
    c.total_emitted = math::add(c.total_emitted, reward)?;
    let bump = c.bump;
    vault_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.reward_pool.to_account_info(),
        &ctx.accounts.world_vault.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        bump,
        reward,
    )?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    emit!(EmissionClaimed { world: ctx.accounts.world.key(), epoch, amount: reward });
    Ok(())
}

// ---------------------------------------------------------------- breach

#[derive(Accounts)]
pub struct DoBreach<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, constraint = child.parent == host.key() @ RecursiaError::Mismatch)]
    pub child: Box<Account<'info, World>>,
    #[account(mut)]
    pub host: Box<Account<'info, World>>,
}

/// Bottom-up causation: a thriving child universe accumulates resonance and
/// eventually "leaks" a glider into its host block in the parent world.
pub fn breach(ctx: Context<DoBreach>) -> Result<()> {
    require_active(&ctx.accounts.config)?;
    require_keys_neq!(ctx.accounts.child.key(), ctx.accounts.host.key(), RecursiaError::DuplicateAccounts);
    let c = &mut ctx.accounts.child;
    require!(c.resonance >= BREACH_RESONANCE, RecursiaError::NoResonance);
    c.resonance = 0;
    let idx = c.parent_territory;
    let h = &mut ctx.accounts.host;
    sim::or_block(&mut h.grid, idx, sim::GLIDER);
    h.territory_alive[idx as usize] = block_count(&h.grid, idx as usize);
    emit!(Breach { child: c.key(), host: h.key(), territory: idx });
    Ok(())
}

// ---------------------------------------------------------------- architect

#[derive(Accounts)]
pub struct ClaimArchitect<'info> {
    #[account(mut)]
    pub architect: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, has_one = architect)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed, payer = architect, space = 8 + Player::INIT_SPACE,
        seeds = [SEED_PLAYER, architect.key().as_ref()], bump
    )]
    pub player: Box<Account<'info, Player>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn claim_architect(ctx: Context<ClaimArchitect>) -> Result<()> {
    let amount = ctx.accounts.world.architect_accrued;
    require!(amount > 0, RecursiaError::NothingToClaim);
    ctx.accounts.world.architect_accrued = 0;
    let pl = &mut ctx.accounts.player;
    if pl.owner == Pubkey::default() {
        pl.version = ACCOUNT_VERSION;
        pl.bump = ctx.bumps.player;
        pl.owner = ctx.accounts.architect.key();
    }
    pl.claimable = math::add(pl.claimable, amount)?;
    pl.total_earned = math::add(pl.total_earned, amount)?;
    let bump = ctx.accounts.config.bump;
    vault_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.world_vault.to_account_info(),
        &ctx.accounts.claims_vault.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        bump,
        amount,
    )?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    Ok(())
}

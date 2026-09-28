//! Quantum layer instructions: superposition → observation → collapse / decoherence.
//!
//! Lifecycle of a superposed territory:
//!  1. `quantum_commit` — the holder commits H(A, B, w, salt, owner, world, idx).
//!     Nobody can see the patterns (real commit-reveal: no counter-play, no
//!     front-running). Plant cost is spent now (studio share + reward pool); a stake is escrowed in the
//!     world vault. Optionally entangles a territory in ANOTHER world.
//!  2. `quantum_observe` — permissionless after `target_slot`. Fixes the entropy
//!     from the ORAO VRF answer to the seed fixed at commit (salted with the
//!     latest slot hash of the commit slot, so it could not be requested in
//!     advance); the observer cannot choose it and gets a bounty. Anyone may
//!     create the ORAO request for that seed — the answer doesn't depend on who
//!     asks or when, so the owner cannot "wait out" a bad outcome either.
//!  3. `quantum_collapse` — the owner reveals; the state collapses into A or B
//!     (entangled partner gets the other one), may tunnel into a neighbour
//!     block; the remaining stake is refunded.
//!  4. `quantum_decohere` — permissionless once an OBSERVED superposition's reveal
//!     window has passed: remaining stake goes to the reward pool (bounty to the
//!     caller). Withholding a bad outcome therefore always costs the stake.

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::RecursiaError;
use crate::events::*;
use crate::instructions::common::*;
use crate::math;
use crate::quantum;
use crate::sim;
use crate::state::*;


// ---------------------------------------------------------------- commit

#[derive(Accounts)]
#[instruction(index: u8)]
pub struct QuantumCommit<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut, seeds = [SEED_TERRITORY, world.key().as_ref(), &[index]], bump = territory.bump,
        constraint = territory.holder == holder.key() @ RecursiaError::NotHolder
    )]
    pub territory: Box<Account<'info, Territory>>,
    #[account(
        init, payer = holder, space = 8 + Superposition::INIT_SPACE,
        seeds = [SEED_SUPERPOSITION, world.key().as_ref(), &[index]], bump
    )]
    pub superposition: Box<Account<'info, Superposition>>,
    #[account(mut, token::mint = mint, token::authority = holder)]
    pub holder_token: Box<Account<'info, TokenAccount>>,
    /// Entangled partner world (must differ from `world`).
    #[account(mut)]
    pub world2: Option<Box<Account<'info, World>>>,
    #[account(mut)]
    pub territory2: Option<Box<Account<'info, Territory>>>,
    /// Studio treasury (SKR): `protocol_bps` of every player spend.
    #[account(mut, seeds = [SEED_TREASURY], bump = config.treasury_bump)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    /// Player reward pool (SKR). Receives the non-studio part of every spend.
    #[account(mut, seeds = [SEED_REWARD_POOL], bump = config.reward_pool_bump)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
    /// CHECK: address-pinned SlotHashes sysvar; only its newest entry is read
    /// (it salts the VRF seed so randomness can't be requested before the position exists).
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID @ RecursiaError::SlotHashes)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn quantum_commit(ctx: Context<QuantumCommit>, index: u8, commitment: [u8; 32]) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    require!(commitment != [0u8; 32], RecursiaError::CommitmentMismatch);
    let slot = Clock::get()?.slot;
    let p = ctx.accounts.config.params;
    let holder = ctx.accounts.holder.key();
    let world_key = ctx.accounts.world.key();

    // ---- checks (all before any effect)
    let entangled = match (&ctx.accounts.world2, &ctx.accounts.territory2) {
        (Some(w2), Some(t2)) => {
            require_keys_neq!(w2.key(), world_key, RecursiaError::DuplicateAccounts);
            check_territory_pda(t2, &w2.key(), ctx.program_id)?;
            require_keys_eq!(t2.holder, holder, RecursiaError::NotHolder);
            require!(w2.tick_count >= t2.next_plant_tick, RecursiaError::Cooldown);
            true
        }
        (None, None) => false,
        _ => return err!(RecursiaError::Mismatch),
    };
    require!(ctx.accounts.world.tick_count >= ctx.accounts.territory.next_plant_tick, RecursiaError::Cooldown);
    let n: u64 = if entangled { 2 } else { 1 };
    let spend = math::mul(p.plant_cost, n)?;
    let (studio, to_pool) = math::split_spend(spend, p.protocol_bps)?;
    let stake = math::mul(math::mul(p.plant_cost, QUANTUM_STAKE_MULT)?, n)?;

    // ---- effects
    {
        let w = &mut ctx.accounts.world;
        let t = &mut ctx.accounts.territory;
        if let TaxOutcome::Foreclose = accrue_tax(w, t, &p, slot)? {
            return err!(RecursiaError::DepositTooSmall);
        }
        t.next_plant_tick = w.tick_count.saturating_add(PLANT_COOLDOWN_TICKS);
    }
    let (world2, index2) = if entangled {
        let w2 = ctx.accounts.world2.as_mut().ok_or(RecursiaError::Mismatch)?;
        let t2 = ctx.accounts.territory2.as_mut().ok_or(RecursiaError::Mismatch)?;
        if let TaxOutcome::Foreclose = accrue_tax(w2, t2, &p, slot)? {
            return err!(RecursiaError::DepositTooSmall);
        }
        t2.next_plant_tick = w2.tick_count.saturating_add(PLANT_COOLDOWN_TICKS);
        (w2.key(), t2.index)
    } else {
        (Pubkey::default(), 0)
    };
    {
        let snapshot = Config::clone(&ctx.accounts.config);
        roll_world_epoch(&mut ctx.accounts.world, &snapshot);
        record_sink(&mut ctx.accounts.world, &mut ctx.accounts.config, to_pool)?;
        let w = &mut ctx.accounts.world;
        w.quantum_escrow = math::add(w.quantum_escrow, stake)?;
        w.superpositions = w.superpositions.saturating_add(1);
    }
    let target_slot = slot.checked_add(QUANTUM_DELAY_SLOTS).ok_or(RecursiaError::MathOverflow)?;
    let recent = {
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        quantum::latest_slot_hash(&data).ok_or(RecursiaError::SlotHashes)?
    };
    let sp = &mut ctx.accounts.superposition;
    sp.version = ACCOUNT_VERSION;
    sp.bump = ctx.bumps.superposition;
    sp.owner = holder;
    sp.world = world_key;
    sp.index = index;
    sp.world2 = world2;
    sp.index2 = index2;
    sp.commitment = commitment;
    sp.commit_slot = slot;
    sp.target_slot = target_slot;
    sp.observed = false;
    sp.stake = stake;
    // until observation `entropy` holds the VRF request seed (replaced by the entropy on observe)
    sp.entropy = quantum::vrf_seed_superposition(&world_key.to_bytes(), index, &commitment, &recent);

    // ---- interactions
    let tp = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();
    let from = ctx.accounts.holder_token.to_account_info();
    let auth = ctx.accounts.holder.to_account_info();
    user_spend(
        &tp, &mint, &from, &auth,
        &ctx.accounts.treasury.to_account_info(), &ctx.accounts.reward_pool.to_account_info(),
        studio, to_pool,
    )?;
    user_transfer(&tp, &mint, &from, &ctx.accounts.world_vault.to_account_info(), &auth, stake)?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    emit!(Superposed { world: world_key, index, owner: holder, world2, index2, target_slot, stake });
    Ok(())
}

// ---------------------------------------------------------------- observe (crank)

#[derive(Accounts)]
pub struct QuantumObserve<'info> {
    pub observer: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut, seeds = [SEED_SUPERPOSITION, world.key().as_ref(), &[superposition.index]], bump = superposition.bump,
        has_one = world
    )]
    pub superposition: Box<Account<'info, Superposition>>,
    #[account(mut, token::mint = mint)]
    pub observer_token: Box<Account<'info, TokenAccount>>,
    /// CHECK: ORAO VRF randomness account. Validated in the handler: address ==
    /// ORAO PDA of the seed fixed when the position was opened, owner == ORAO,
    /// state == Fulfilled with that seed (`quantum::orao_fulfilled`).
    pub vrf_request: UncheckedAccount<'info>,
    /// Player reward pool (SKR). Receives the non-studio part of every spend.
    #[account(mut, seeds = [SEED_REWARD_POOL], bump = config.reward_pool_bump)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Works while paused: measuring settles a user position, it is not gameplay.
pub fn quantum_observe(ctx: Context<QuantumObserve>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let sp_ro = &ctx.accounts.superposition;
    require!(!sp_ro.observed, RecursiaError::AlreadyObserved);
    require!(slot > sp_ro.target_slot, RecursiaError::NotMeasurable);
    let randomness = read_vrf(&ctx.accounts.vrf_request, &sp_ro.entropy)?;
    let hash = quantum::entropy_from_vrf(&randomness);
    let world_key = ctx.accounts.world.key();
    let index = sp_ro.index;
    let bump = ctx.accounts.config.bump;
    let tp = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();
    let vault = ctx.accounts.world_vault.to_account_info();
    let cfg = ctx.accounts.config.to_account_info();

    let bounty = ctx.accounts.superposition.stake / QUANTUM_BOUNTY_DIV;
    {
        let sp = &mut ctx.accounts.superposition;
        sp.observed = true;
        sp.observed_slot = slot;
        sp.entropy = hash;
        sp.reveal_deadline = slot.checked_add(QUANTUM_REVEAL_SLOTS).ok_or(RecursiaError::MathOverflow)?;
        sp.stake = math::sub(sp.stake, bounty)?;
        let w = &mut ctx.accounts.world;
        w.quantum_escrow = math::sub(w.quantum_escrow, bounty)?;
    }
    vault_transfer(&tp, &mint, &vault, &ctx.accounts.observer_token.to_account_info(), &cfg, bump, bounty)?;
    emit!(Observed { world: world_key, index, observer: ctx.accounts.observer.key(), measured_slot: slot, entropy: hash, bounty });
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    Ok(())
}

// ---------------------------------------------------------------- collapse (reveal)

#[derive(Accounts)]
pub struct QuantumCollapse<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(seeds = [SEED_TERRITORY, world.key().as_ref(), &[territory.index]], bump = territory.bump)]
    pub territory: Box<Account<'info, Territory>>,
    #[account(
        mut, seeds = [SEED_SUPERPOSITION, world.key().as_ref(), &[superposition.index]], bump = superposition.bump,
        has_one = world, has_one = owner, close = owner
    )]
    pub superposition: Box<Account<'info, Superposition>>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub world2: Option<Box<Account<'info, World>>>,
    pub territory2: Option<Box<Account<'info, Territory>>>,
    pub token_program: Program<'info, Token>,
}

/// Works while paused (settlement of a user position; the stake must never be
/// trapped or lost because of a pause).
pub fn quantum_collapse(
    ctx: Context<QuantumCollapse>,
    pattern_a: u64,
    pattern_b: u64,
    weight_bps: u16,
    salt: [u8; 32],
) -> Result<()> {
    require_top_level()?;
    let slot = Clock::get()?.slot;
    let owner = ctx.accounts.owner.key();
    let world_key = ctx.accounts.world.key();
    let sp = Superposition::clone(&ctx.accounts.superposition);

    // ---- checks
    require!(sp.observed, RecursiaError::NotObserved);
    require!(slot <= sp.reveal_deadline, RecursiaError::RevealWindowClosed);
    require!(weight_bps as u64 <= BPS, RecursiaError::InvalidWeight);
    require!(ctx.accounts.territory.index == sp.index, RecursiaError::Mismatch);
    let expect = quantum::commitment(pattern_a, pattern_b, weight_bps, &salt, &owner.to_bytes(), &world_key.to_bytes(), sp.index);
    require!(expect == sp.commitment, RecursiaError::CommitmentMismatch);
    if sp.is_entangled() {
        let w2 = ctx.accounts.world2.as_ref().ok_or(RecursiaError::Mismatch)?;
        let t2 = ctx.accounts.territory2.as_ref().ok_or(RecursiaError::Mismatch)?;
        require_keys_eq!(w2.key(), sp.world2, RecursiaError::Mismatch);
        check_territory_pda(t2, &w2.key(), ctx.program_id)?;
        require!(t2.index == sp.index2, RecursiaError::Mismatch);
    }

    // ---- effects
    let c = quantum::collapse(&sp.entropy, &sp.commitment, weight_bps);
    let (primary, partner) = if c.branch_a { (pattern_a, pattern_b) } else { (pattern_b, pattern_a) };
    let mut tunnel_to = None;
    {
        let w = &mut ctx.accounts.world;
        // A territory sold meanwhile is not written (no griefing either way),
        // but the stake is still refunded: revealing honestly is never punished.
        if ctx.accounts.territory.holder == owner {
            sim::write_block(&mut w.grid, sp.index, primary);
            w.territory_alive[sp.index as usize] = block_count(&w.grid, sp.index as usize);
            if c.tunnel {
                let n = quantum::neighbour(sp.index, c.tunnel_dir);
                sim::or_block(&mut w.grid, n, primary);
                w.territory_alive[n as usize] = block_count(&w.grid, n as usize);
                tunnel_to = Some(n);
            }
        }
        w.quantum_escrow = math::sub(w.quantum_escrow, sp.stake)?;
        w.superpositions = w.superpositions.saturating_sub(1);
    }
    let mut entangled_pattern = 0;
    if sp.is_entangled() {
        let holds = ctx.accounts.territory2.as_ref().map(|t| t.holder == owner).unwrap_or(false);
        let w2 = ctx.accounts.world2.as_mut().ok_or(RecursiaError::Mismatch)?;
        if holds {
            sim::write_block(&mut w2.grid, sp.index2, partner);
            w2.territory_alive[sp.index2 as usize] = block_count(&w2.grid, sp.index2 as usize);
            entangled_pattern = partner;
        }
    }

    // ---- interactions
    let bump = ctx.accounts.config.bump;
    vault_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.world_vault.to_account_info(),
        &ctx.accounts.owner_token.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        bump,
        sp.stake,
    )?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    emit!(Collapsed {
        world: world_key,
        index: sp.index,
        branch_a: c.branch_a,
        pattern: primary,
        tunnel_to,
        entangled_world: sp.world2,
        entangled_pattern,
    });
    Ok(())
}

// ---------------------------------------------------------------- decohere (crank)

#[derive(Accounts)]
pub struct QuantumDecohere<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut, seeds = [SEED_SUPERPOSITION, world.key().as_ref(), &[superposition.index]], bump = superposition.bump,
        has_one = world, has_one = owner, close = owner
    )]
    pub superposition: Box<Account<'info, Superposition>>,
    /// CHECK: only receives the superposition's rent; pinned by `has_one = owner`.
    #[account(mut)]
    pub owner: UncheckedAccount<'info>,
    #[account(mut, token::mint = mint)]
    pub caller_token: Box<Account<'info, TokenAccount>>,
    /// Player reward pool (SKR). Receives the non-studio part of every spend.
    #[account(mut, seeds = [SEED_REWARD_POOL], bump = config.reward_pool_bump)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn quantum_decohere(ctx: Context<QuantumDecohere>) -> Result<()> {
    // blocked while paused: nobody may lose a stake because they could not act
    require_active(&ctx.accounts.config)?;
    let slot = Clock::get()?.slot;
    let sp = Superposition::clone(&ctx.accounts.superposition);
    // Only an OBSERVED superposition whose owner didn't reveal in time can be
    // decohered. An unobserved one is waiting for the VRF: its outcome is already
    // fixed by the seed and becomes public the moment ORAO answers (anyone then
    // observes for the bounty), so the owner can't hide it — and an oracle outage
    // must never burn a player's stake.
    require!(sp.observed && slot > sp.reveal_deadline, RecursiaError::StillCoherent);
    let bounty = sp.stake / QUANTUM_BOUNTY_DIV;
    let penalty = math::sub(sp.stake, bounty)?;
    {
        let w = &mut ctx.accounts.world;
        w.quantum_escrow = math::sub(w.quantum_escrow, sp.stake)?;
        w.superpositions = w.superpositions.saturating_sub(1);
        record_pool_inflow(&mut ctx.accounts.config, penalty)?;
    }
    let bump = ctx.accounts.config.bump;
    let tp = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();
    let vault = ctx.accounts.world_vault.to_account_info();
    let cfg = ctx.accounts.config.to_account_info();
    vault_transfer(&tp, &mint, &vault, &ctx.accounts.caller_token.to_account_info(), &cfg, bump, bounty)?;
    vault_transfer(&tp, &mint, &vault, &ctx.accounts.reward_pool.to_account_info(), &cfg, bump, penalty)?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    emit!(Decohered { world: ctx.accounts.world.key(), index: sp.index, penalty, bounty });
    Ok(())
}

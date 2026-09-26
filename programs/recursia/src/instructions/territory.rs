use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::RecursiaError;
use crate::events::*;
use crate::instructions::common::*;
use crate::math;
use crate::sim;
use crate::state::*;

fn ensure_player(p: &mut Player, owner: Pubkey, bump: u8) -> Result<()> {
    if p.owner == Pubkey::default() {
        p.version = ACCOUNT_VERSION;
        p.bump = bump;
        p.owner = owner;
    } else {
        require_keys_eq!(p.owner, owner, RecursiaError::Mismatch);
        require!(p.version == ACCOUNT_VERSION, RecursiaError::BadVersion);
    }
    Ok(())
}

fn ensure_territory(t: &mut Territory, world: Pubkey, index: u8, bump: u8) -> Result<()> {
    if t.world == Pubkey::default() {
        t.version = ACCOUNT_VERSION;
        t.bump = bump;
        t.world = world;
        t.index = index;
    } else {
        require_keys_eq!(t.world, world, RecursiaError::Mismatch);
        require!(t.index == index, RecursiaError::Mismatch);
        require!(t.version == ACCOUNT_VERSION, RecursiaError::BadVersion);
    }
    Ok(())
}

pub struct AcquireArgs {
    pub max_price: u64,
    pub new_price: u64,
    pub deposit: u64,
    pub by_agent: bool,
}

/// Shared by human and agent acquisition. Returns total tokens spent by the
/// payer. Atomic: price, deposit, ownership change happen in ONE instruction
/// (checklist #70).
#[allow(clippy::too_many_arguments)]
fn acquire_core<'info>(
    config: &Config,
    world: &mut World,
    world_key: Pubkey,
    territory: &mut Territory,
    new_holder: Pubkey,
    new_player: &mut Player,
    seller_player: Option<&mut Player>,
    payer_token: &AccountInfo<'info>,
    payer_auth: &AccountInfo<'info>,
    payer_is_vault: bool,
    tp: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    world_vault: &AccountInfo<'info>,
    claims_vault: &AccountInfo<'info>,
    config_info: &AccountInfo<'info>,
    args: AcquireArgs,
) -> Result<u64> {
    let p = config.params;
    let slot = Clock::get()?.slot;
    let pay = |to: &AccountInfo<'info>, amount: u64| -> Result<()> {
        if payer_is_vault {
            vault_transfer(tp, mint, payer_token, to, config_info, config.bump, amount)
        } else {
            user_transfer(tp, mint, payer_token, to, payer_auth, amount)
        }
    };
    require!(args.new_price >= p.min_price && args.new_price <= MAX_PRICE, RecursiaError::BadPrice);
    let min_deposit = math::epoch_tax(args.new_price, p.harberger_bps)?;
    require!(args.deposit >= min_deposit, RecursiaError::DepositTooSmall);

    let mut seller = Pubkey::default();
    let mut seller_player = seller_player;
    if territory.is_held() {
        let Some(sp) = seller_player.as_mut() else {
            return err!(RecursiaError::Mismatch);
        };
        if let TaxOutcome::Foreclose = accrue_tax(world, territory, &p, slot)? {
            let old = territory.holder;
            release_territory(world, territory, sp, tp, mint, world_vault, claims_vault, config_info, config.bump, slot)?;
            emit!(Foreclosed { world: world_key, index: territory.index, holder: old });
        }
    }

    let price_paid;
    if territory.is_held() {
        require_keys_neq!(territory.holder, new_holder, RecursiaError::DuplicateAccounts);
        let Some(sp) = seller_player.as_mut() else {
            return err!(RecursiaError::Mismatch);
        };
        price_paid = territory.price;
        require!(price_paid <= args.max_price, RecursiaError::PriceSlippage);
        seller = territory.holder;
        pay(claims_vault, price_paid)?;
        sp.claimable = math::add(sp.claimable, price_paid)?;
        release_territory(world, territory, sp, tp, mint, world_vault, claims_vault, config_info, config.bump, slot)?;
    } else {
        price_paid = p.min_price;
        require!(price_paid <= args.max_price, RecursiaError::PriceSlippage);
        pay(world_vault, price_paid)?;
        world.energy = math::add(world.energy, price_paid)?;
    }

    pay(world_vault, args.deposit)?;
    world.deposits = math::add(world.deposits, args.deposit)?;

    let idx = territory.index as usize;
    territory.holder = new_holder;
    territory.price = args.new_price;
    territory.deposit = args.deposit;
    territory.last_tax_slot = slot;
    territory.last_price_change_slot = slot;
    territory.next_plant_tick = world.tick_count;
    territory.acquired_slot = slot;
    territory.voted_rebellion = 0;
    territory.agent_managed = args.by_agent;
    world.owned_mask |= 1u64 << idx;
    new_player.territories = new_player.territories.saturating_add(1);

    emit!(TerritoryAcquired {
        world: world_key,
        index: territory.index,
        buyer: new_holder,
        seller,
        price_paid,
        new_price: args.new_price,
        by_agent: args.by_agent,
    });
    math::add(price_paid, args.deposit)
}

// ---------------------------------------------------------------- acquire (human)

#[derive(Accounts)]
#[instruction(index: u8)]
pub struct Acquire<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed, payer = buyer, space = 8 + Territory::INIT_SPACE,
        seeds = [SEED_TERRITORY, world.key().as_ref(), &[index]], bump
    )]
    pub territory: Box<Account<'info, Territory>>,
    #[account(
        init_if_needed, payer = buyer, space = 8 + Player::INIT_SPACE,
        seeds = [SEED_PLAYER, buyer.key().as_ref()], bump
    )]
    pub buyer_player: Box<Account<'info, Player>>,
    /// Current holder's Player account (required iff the territory is held).
    #[account(mut)]
    pub seller_player: Option<Box<Account<'info, Player>>>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn acquire(
    ctx: Context<Acquire>,
    index: u8,
    max_price: u64,
    new_price: u64,
    deposit: u64,
) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    require!((index as usize) < TERRITORIES, RecursiaError::BadTerritory);
    let world_key = ctx.accounts.world.key();
    let buyer = ctx.accounts.buyer.key();
    ensure_territory(&mut ctx.accounts.territory, world_key, index, ctx.bumps.territory)?;
    ensure_player(&mut ctx.accounts.buyer_player, buyer, ctx.bumps.buyer_player)?;
    if let Some(sp) = ctx.accounts.seller_player.as_ref() {
        require_keys_neq!(sp.key(), ctx.accounts.buyer_player.key(), RecursiaError::DuplicateAccounts);
        let expected = Pubkey::create_program_address(
            &[SEED_PLAYER, sp.owner.as_ref(), &[sp.bump]],
            ctx.program_id,
        )
        .map_err(|_| RecursiaError::Mismatch)?;
        require_keys_eq!(sp.key(), expected, RecursiaError::Mismatch);
    }
    let config = Config::clone(&ctx.accounts.config);
    acquire_core(
        &config,
        &mut ctx.accounts.world,
        world_key,
        &mut ctx.accounts.territory,
        buyer,
        &mut ctx.accounts.buyer_player,
        ctx.accounts.seller_player.as_deref_mut().map(|a| &mut **a),
        &ctx.accounts.buyer_token.to_account_info(),
        &ctx.accounts.buyer.to_account_info(),
        false,
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.world_vault.to_account_info(),
        &ctx.accounts.claims_vault.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        AcquireArgs { max_price, new_price, deposit, by_agent: false },
    )?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    Ok(())
}

// ---------------------------------------------------------------- acquire (agent)

#[derive(Accounts)]
#[instruction(index: u8)]
pub struct AgentAcquire<'info> {
    /// AI runner hot key. Pays only rent; token spend comes from the permit vault.
    #[account(mut)]
    pub agent: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [SEED_PERMIT, permit.owner.as_ref(), agent.key().as_ref()], bump = permit.bump, has_one = agent)]
    pub permit: Box<Account<'info, AgentPermit>>,
    #[account(mut, seeds = [SEED_PERMIT_VAULT, permit.key().as_ref()], bump = permit.vault_bump)]
    pub permit_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        init_if_needed, payer = agent, space = 8 + Territory::INIT_SPACE,
        seeds = [SEED_TERRITORY, world.key().as_ref(), &[index]], bump
    )]
    pub territory: Box<Account<'info, Territory>>,
    #[account(
        init_if_needed, payer = agent, space = 8 + Player::INIT_SPACE,
        seeds = [SEED_PLAYER, permit.owner.as_ref()], bump
    )]
    pub owner_player: Box<Account<'info, Player>>,
    #[account(mut)]
    pub seller_player: Option<Box<Account<'info, Player>>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn agent_acquire(
    ctx: Context<AgentAcquire>,
    index: u8,
    max_price: u64,
    new_price: u64,
    deposit: u64,
) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    require!((index as usize) < TERRITORIES, RecursiaError::BadTerritory);
    let slot = Clock::get()?.slot;
    let world_key = ctx.accounts.world.key();
    let owner = ctx.accounts.permit.owner;
    require!(max_price <= ctx.accounts.permit.max_price, RecursiaError::PermitLimit);
    ensure_territory(&mut ctx.accounts.territory, world_key, index, ctx.bumps.territory)?;
    ensure_player(&mut ctx.accounts.owner_player, owner, ctx.bumps.owner_player)?;
    if let Some(sp) = ctx.accounts.seller_player.as_ref() {
        require_keys_neq!(sp.key(), ctx.accounts.owner_player.key(), RecursiaError::DuplicateAccounts);
        let expected = Pubkey::create_program_address(
            &[SEED_PLAYER, sp.owner.as_ref(), &[sp.bump]],
            ctx.program_id,
        )
        .map_err(|_| RecursiaError::Mismatch)?;
        require_keys_eq!(sp.key(), expected, RecursiaError::Mismatch);
    }
    let config = Config::clone(&ctx.accounts.config);
    let spent = acquire_core(
        &config,
        &mut ctx.accounts.world,
        world_key,
        &mut ctx.accounts.territory,
        owner,
        &mut ctx.accounts.owner_player,
        ctx.accounts.seller_player.as_deref_mut().map(|a| &mut **a),
        &ctx.accounts.permit_vault.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        true,
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.world_vault.to_account_info(),
        &ctx.accounts.claims_vault.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        AcquireArgs { max_price, new_price, deposit, by_agent: true },
    )?;
    // limits enforced on-chain; exceeding reverts the whole tx
    charge_permit(&mut ctx.accounts.permit, &config, &world_key, PERMIT_ACQUIRE, spent, slot)?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    Ok(())
}

// ---------------------------------------------------------------- holder ops

#[derive(Accounts)]
pub struct HolderOp<'info> {
    #[account(mut)]
    pub holder: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut, seeds = [SEED_TERRITORY, world.key().as_ref(), &[territory.index]], bump = territory.bump,
        constraint = territory.holder == holder.key() @ RecursiaError::NotHolder
    )]
    pub territory: Box<Account<'info, Territory>>,
    #[account(mut, seeds = [SEED_PLAYER, holder.key().as_ref()], bump = player.bump)]
    pub player: Box<Account<'info, Player>>,
    #[account(mut, token::mint = mint, token::authority = holder)]
    pub holder_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

fn accrue_or_fail(ctx: &mut Context<HolderOp>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let p = ctx.accounts.config.params;
    if let TaxOutcome::Foreclose = accrue_tax(&mut ctx.accounts.world, &mut ctx.accounts.territory, &p, slot)? {
        return err!(RecursiaError::DepositTooSmall);
    }
    Ok(())
}

pub fn set_price(mut ctx: Context<HolderOp>, new_price: u64) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    accrue_or_fail(&mut ctx)?;
    let slot = Clock::get()?.slot;
    let p = ctx.accounts.config.params;
    let t = &mut ctx.accounts.territory;
    require!(
        slot >= t.last_price_change_slot.saturating_add(PRICE_CHANGE_COOLDOWN_SLOTS),
        RecursiaError::Cooldown
    );
    require!(new_price >= p.min_price && new_price <= MAX_PRICE, RecursiaError::BadPrice);
    require!(t.deposit >= math::epoch_tax(new_price, p.harberger_bps)?, RecursiaError::DepositTooSmall);
    t.price = new_price;
    t.last_price_change_slot = slot;
    Ok(())
}

pub fn top_up(mut ctx: Context<HolderOp>, amount: u64) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    require!(amount > 0, RecursiaError::DepositTooSmall);
    accrue_or_fail(&mut ctx)?;
    user_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.holder_token.to_account_info(),
        &ctx.accounts.world_vault.to_account_info(),
        &ctx.accounts.holder.to_account_info(),
        amount,
    )?;
    ctx.accounts.territory.deposit = math::add(ctx.accounts.territory.deposit, amount)?;
    ctx.accounts.world.deposits = math::add(ctx.accounts.world.deposits, amount)?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    Ok(())
}

pub fn withdraw_deposit(mut ctx: Context<HolderOp>, amount: u64) -> Result<()> {
    require_top_level()?;
    accrue_or_fail(&mut ctx)?;
    let p = ctx.accounts.config.params;
    let t = &mut ctx.accounts.territory;
    let left = math::sub(t.deposit, amount)?;
    require!(left >= math::epoch_tax(t.price, p.harberger_bps)?, RecursiaError::DepositTooSmall);
    t.deposit = left;
    ctx.accounts.world.deposits = math::sub(ctx.accounts.world.deposits, amount)?;
    ctx.accounts.player.claimable = math::add(ctx.accounts.player.claimable, amount)?;
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

/// Move rewards credited to the territory (emission + host tax from child
/// universes) into the holder's withdrawable balance.
pub fn collect(mut ctx: Context<HolderOp>) -> Result<()> {
    require_top_level()?;
    accrue_or_fail(&mut ctx)?;
    let idx = ctx.accounts.territory.index as usize;
    let amount = ctx.accounts.world.territory_pending[idx];
    require!(amount > 0, RecursiaError::NothingToClaim);
    ctx.accounts.world.territory_pending[idx] = 0;
    ctx.accounts.world.rewards_reserved = math::sub(ctx.accounts.world.rewards_reserved, amount)?;
    let pl = &mut ctx.accounts.player;
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

// ---------------------------------------------------------------- plant

#[derive(Accounts)]
pub struct Plant<'info> {
    pub holder: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(
        mut, seeds = [SEED_TERRITORY, world.key().as_ref(), &[territory.index]], bump = territory.bump,
        constraint = territory.holder == holder.key() @ RecursiaError::NotHolder
    )]
    pub territory: Box<Account<'info, Territory>>,
    #[account(mut, token::mint = mint, token::authority = holder)]
    pub holder_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

fn plant_effects(world: &mut World, territory: &mut Territory, config: &mut Config, pattern: u64) -> Result<()> {
    let slot = Clock::get()?.slot;
    let p = config.params;
    if let TaxOutcome::Foreclose = accrue_tax(world, territory, &p, slot)? {
        return err!(RecursiaError::DepositTooSmall);
    }
    // checklist #56: strict per-territory cooldown, state written before CPI
    require!(world.tick_count >= territory.next_plant_tick, RecursiaError::Cooldown);
    territory.next_plant_tick = world.tick_count.saturating_add(PLANT_COOLDOWN_TICKS);
    let snapshot = Config::clone(config);
    roll_world_epoch(world, &snapshot);
    let idx = territory.index;
    sim::write_block(&mut world.grid, idx, pattern);
    world.territory_alive[idx as usize] = block_count(&world.grid, idx as usize);
    record_burn(world, config, p.plant_cost)
}

pub fn plant(ctx: Context<Plant>, pattern: u64) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    let cost = ctx.accounts.config.params.plant_cost;
    plant_effects(&mut ctx.accounts.world, &mut ctx.accounts.territory, &mut ctx.accounts.config, pattern)?;
    user_burn(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.holder_token.to_account_info(),
        &ctx.accounts.holder.to_account_info(),
        cost,
    )?;
    emit!(Planted { world: ctx.accounts.world.key(), index: ctx.accounts.territory.index, pattern, by_agent: false });
    Ok(())
}

#[derive(Accounts)]
pub struct AgentPlant<'info> {
    pub agent: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut)]
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [SEED_PERMIT, permit.owner.as_ref(), agent.key().as_ref()], bump = permit.bump, has_one = agent)]
    pub permit: Box<Account<'info, AgentPermit>>,
    #[account(mut, seeds = [SEED_PERMIT_VAULT, permit.key().as_ref()], bump = permit.vault_bump)]
    pub permit_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(
        mut, seeds = [SEED_TERRITORY, world.key().as_ref(), &[territory.index]], bump = territory.bump,
        constraint = territory.holder == permit.owner @ RecursiaError::NotHolder
    )]
    pub territory: Box<Account<'info, Territory>>,
    pub token_program: Program<'info, Token>,
}

pub fn agent_plant(ctx: Context<AgentPlant>, pattern: u64) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    let slot = Clock::get()?.slot;
    let cost = ctx.accounts.config.params.plant_cost;
    let world_key = ctx.accounts.world.key();
    let snapshot = Config::clone(&ctx.accounts.config);
    charge_permit(&mut ctx.accounts.permit, &snapshot, &world_key, PERMIT_PLANT, cost, slot)?;
    plant_effects(&mut ctx.accounts.world, &mut ctx.accounts.territory, &mut ctx.accounts.config, pattern)?;
    let bump = ctx.accounts.config.bump;
    vault_burn(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.permit_vault.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        bump,
        cost,
    )?;
    emit!(Planted { world: world_key, index: ctx.accounts.territory.index, pattern, by_agent: true });
    Ok(())
}

// ---------------------------------------------------------------- settle (crank)

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_TERRITORY, world.key().as_ref(), &[territory.index]], bump = territory.bump)]
    pub territory: Box<Account<'info, Territory>>,
    #[account(mut, seeds = [SEED_PLAYER, territory.holder.as_ref()], bump = holder_player.bump)]
    pub holder_player: Box<Account<'info, Player>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Permissionless: collect Harberger tax; foreclose if the deposit ran out.
pub fn settle(ctx: Context<Settle>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let p = ctx.accounts.config.params;
    require!(ctx.accounts.territory.is_held(), RecursiaError::NotHolder);
    let world_key = ctx.accounts.world.key();
    if let TaxOutcome::Foreclose = accrue_tax(&mut ctx.accounts.world, &mut ctx.accounts.territory, &p, slot)? {
        let old = ctx.accounts.territory.holder;
        let bump = ctx.accounts.config.bump;
        release_territory(
            &mut ctx.accounts.world,
            &mut ctx.accounts.territory,
            &mut ctx.accounts.holder_player,
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.mint.to_account_info(),
            &ctx.accounts.world_vault.to_account_info(),
            &ctx.accounts.claims_vault.to_account_info(),
            &ctx.accounts.config.to_account_info(),
            bump,
            slot,
        )?;
        emit!(Foreclosed { world: world_key, index: ctx.accounts.territory.index, holder: old });
    }
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    Ok(())
}

// ---------------------------------------------------------------- withdraw

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [SEED_PLAYER, owner.key().as_ref()], bump = player.bump, has_one = owner)]
    pub player: Box<Account<'info, Player>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    /// Destination must be owned by the player themself.
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Pull payment. Works even while paused (funds are never trapped by pause).
pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require_top_level()?;
    require!(amount > 0, RecursiaError::NothingToClaim);
    let pl = &mut ctx.accounts.player;
    pl.claimable = math::sub(pl.claimable, amount).map_err(|_| RecursiaError::NothingToClaim)?;
    let bump = ctx.accounts.config.bump;
    vault_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.claims_vault.to_account_info(),
        &ctx.accounts.owner_token.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        bump,
        amount,
    )
}

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT};
use anchor_spl::token::{self, Burn, TransferChecked};

use crate::constants::*;
use crate::errors::RecursiaError;
use crate::math;
use crate::sim;
use crate::state::*;

/// Player-facing value-moving instructions must be top level (no CPI). This
/// blocks "wrap the game in a malicious program" and same-tx sandwich
/// composition (checklist #8/#42).
pub fn require_top_level() -> Result<()> {
    require!(
        get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT,
        RecursiaError::CpiForbidden
    );
    Ok(())
}

pub fn require_active(config: &Config) -> Result<()> {
    require!(config.genesis_done, RecursiaError::GenesisPending);
    require!(!config.paused, RecursiaError::Paused);
    Ok(())
}

/// Transfer out of any program vault (authority = config PDA).
pub fn vault_transfer<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    config: &AccountInfo<'info>,
    config_bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let bump = [config_bump];
    let seeds: &[&[u8]] = &[SEED_CONFIG, &bump];
    token::transfer_checked(
        CpiContext::new_with_signer(
            token_program.clone(),
            TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: config.clone(),
            },
            &[seeds],
        ),
        amount,
        DECIMALS,
    )
}

/// Transfer signed by a user wallet.
pub fn user_transfer<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::transfer_checked(
        CpiContext::new(
            token_program.clone(),
            TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: authority.clone(),
            },
        ),
        amount,
        DECIMALS,
    )
}

pub fn vault_burn<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    config: &AccountInfo<'info>,
    config_bump: u8,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let bump = [config_bump];
    let seeds: &[&[u8]] = &[SEED_CONFIG, &bump];
    token::burn(
        CpiContext::new_with_signer(
            token_program.clone(),
            Burn { mint: mint.clone(), from: from.clone(), authority: config.clone() },
            &[seeds],
        ),
        amount,
    )
}

pub fn user_burn<'info>(
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::burn(
        CpiContext::new(
            token_program.clone(),
            Burn { mint: mint.clone(), from: from.clone(), authority: authority.clone() },
        ),
        amount,
    )
}

/// Vault solvency invariant (checklist #49/#53): the SPL balance of a world
/// vault must always cover all of its sub-ledgers.
pub fn world_ledger_total(world: &World) -> Result<u64> {
    let a = math::add(world.energy, world.rewards_reserved)?;
    let b = math::add(world.deposits, world.architect_accrued)?;
    math::add(a, b)
}

pub fn assert_world_solvent(world: &World, vault_amount: u64) -> Result<()> {
    require!(
        vault_amount >= world_ledger_total(world)?,
        RecursiaError::InvariantViolated
    );
    Ok(())
}

/// Roll the world's epoch window forward lazily. O(1), no loops over worlds.
pub fn roll_world_epoch(world: &mut World, config: &Config) {
    if world.epoch_id >= config.cur_epoch {
        return;
    }
    if world.epoch_id + 1 == config.cur_epoch {
        world.prev_epoch_id = world.epoch_id;
        world.burn_prev = world.burn_cur;
        world.scores_prev = world.scores_cur;
        world.prev_claimed = false;
    } else {
        // skipped at least one full epoch: the old window is unclaimable
        world.prev_epoch_id = config.cur_epoch.saturating_sub(1);
        world.burn_prev = 0;
        world.scores_prev = [0; TERRITORIES];
        world.prev_claimed = true;
    }
    world.epoch_id = config.cur_epoch;
    world.burn_cur = 0;
    world.scores_cur = [0; TERRITORIES];
}

/// Record a burn attributed to a world (counts toward epoch emission share).
pub fn record_burn(world: &mut World, config: &mut Config, amount: u64) -> Result<()> {
    world.burn_cur = math::add(world.burn_cur, amount)?;
    world.total_burned = math::add(world.total_burned, amount)?;
    config.cur_total_burn = math::add(config.cur_total_burn, amount)?;
    config.total_burned = math::add(config.total_burned, amount)?;
    Ok(())
}

pub enum TaxOutcome {
    Paid,
    Foreclose,
}

/// Accrue Harberger tax from the territory deposit into the world.
/// Returns `Foreclose` if the deposit could not cover it (deposit is then 0).
pub fn accrue_tax(
    world: &mut World,
    territory: &mut Territory,
    params: &Params,
    slot: u64,
) -> Result<TaxOutcome> {
    if !territory.is_held() {
        return Ok(TaxOutcome::Paid);
    }
    let elapsed = slot.saturating_sub(territory.last_tax_slot);
    let due = math::harberger_due(territory.price, params.harberger_bps, elapsed, params.epoch_slots)?;
    let paid = due.min(territory.deposit);
    territory.deposit = math::sub(territory.deposit, paid)?;
    world.deposits = math::sub(world.deposits, paid)?;
    let fee = if world.has_architect() {
        math::bps_floor(paid, world.architect_fee_bps as u64)?
    } else {
        0
    };
    world.architect_accrued = math::add(world.architect_accrued, fee)?;
    world.energy = math::add(world.energy, math::sub(paid, fee)?)?;
    territory.last_tax_slot = slot;
    if due > paid || territory.deposit == 0 {
        Ok(TaxOutcome::Foreclose)
    } else {
        Ok(TaxOutcome::Paid)
    }
}

/// Everything that must happen when a territory loses its holder: pending
/// rewards + leftover deposit are credited to the old holder (pull-payment via
/// the claims vault, so a hostile holder can't DoS the transfer), rebellion
/// vote is withdrawn, ownership bitmap cleared.
#[allow(clippy::too_many_arguments)]
pub fn release_territory<'info>(
    world: &mut World,
    territory: &mut Territory,
    old_holder: &mut Player,
    token_program: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    world_vault: &AccountInfo<'info>,
    claims_vault: &AccountInfo<'info>,
    config_info: &AccountInfo<'info>,
    config_bump: u8,
    slot: u64,
) -> Result<()> {
    require_keys_eq!(old_holder.owner, territory.holder, RecursiaError::Mismatch);
    let idx = territory.index as usize;
    let pending = world.territory_pending[idx];
    let deposit = territory.deposit;
    world.territory_pending[idx] = 0;
    world.rewards_reserved = math::sub(world.rewards_reserved, pending)?;
    world.deposits = math::sub(world.deposits, deposit)?;
    territory.deposit = 0;
    let out = math::add(pending, deposit)?;
    vault_transfer(token_program, mint, world_vault, claims_vault, config_info, config_bump, out)?;
    old_holder.claimable = math::add(old_holder.claimable, out)?;
    old_holder.total_earned = math::add(old_holder.total_earned, pending)?;
    old_holder.territories = old_holder.territories.saturating_sub(1);

    if territory.voted_rebellion != 0
        && territory.voted_rebellion == world.rebellion_id
        && world.rebellion_active(slot)
    {
        world.rebellion_votes = world.rebellion_votes.saturating_sub(1);
    }
    territory.voted_rebellion = 0;
    world.owned_mask &= !(1u64 << idx);
    territory.holder = Pubkey::default();
    territory.agent_managed = false;
    territory.price = 0;
    Ok(())
}

pub fn owned_array(mask: u64) -> [bool; TERRITORIES] {
    let mut o = [false; TERRITORIES];
    for (i, v) in o.iter_mut().enumerate() {
        *v = (mask >> i) & 1 == 1;
    }
    o
}

pub fn validate_rule(birth: u16, survive: u16) -> Result<()> {
    require!(birth & !sim::RULE_MASK == 0, RecursiaError::InvalidRule);
    require!(survive & !sim::RULE_MASK == 0, RecursiaError::InvalidRule);
    // B0 rules strobe the whole torus; disallowed. Empty birth = dead world.
    require!(birth & 1 == 0 && birth != 0, RecursiaError::InvalidRule);
    Ok(())
}

pub fn validate_name(name: &[u8; 32]) -> Result<()> {
    require!(name[0] != 0, RecursiaError::BadName);
    let len = name.iter().position(|&b| b == 0).unwrap_or(32);
    require!(core::str::from_utf8(&name[..len]).is_ok(), RecursiaError::BadName);
    // no control characters / invisible formatting chars (checklist #76)
    let s = core::str::from_utf8(&name[..len]).map_err(|_| RecursiaError::BadName)?;
    require!(
        s.chars().all(|c| !c.is_control() && !is_invisible(c)),
        RecursiaError::BadName
    );
    require!(name[len..].iter().all(|&b| b == 0), RecursiaError::BadName);
    Ok(())
}

fn is_invisible(c: char) -> bool {
    matches!(c as u32,
        0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x2069 | 0xFEFF | 0xE0000..=0xE007F)
}

/// Charge an agent permit (checklist #75: limits live in the contract).
pub fn charge_permit(
    permit: &mut AgentPermit,
    config: &Config,
    world: &Pubkey,
    scope_bit: u8,
    amount: u64,
    slot: u64,
) -> Result<()> {
    require!(slot < permit.expiry_slot, RecursiaError::PermitExpired);
    require!(permit.scope & scope_bit != 0, RecursiaError::PermitScope);
    require!(
        permit.allowed_world == Pubkey::default() || permit.allowed_world == *world,
        RecursiaError::PermitScope
    );
    if permit.spend_epoch != config.cur_epoch {
        permit.spend_epoch = config.cur_epoch;
        permit.spent = 0;
    }
    let spent = math::add(permit.spent, amount)?;
    require!(spent <= permit.max_spend_per_epoch, RecursiaError::PermitLimit);
    permit.spent = spent;
    Ok(())
}

pub fn block_count(grid: &sim::Grid, idx: usize) -> u16 {
    let tx = idx % 8;
    let ty = idx / 8;
    let mut c = 0u16;
    for r in 0..8 {
        c += ((grid[ty * 8 + r] >> (tx * 8)) & 0xFF).count_ones() as u16;
    }
    c
}

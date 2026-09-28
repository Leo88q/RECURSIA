//! Quantum SWAP in neutral worlds: players exchange outcomes.
//!
//!  1. `swap_offer`   — holder of block A offers holder of block B a SWAP with
//!     probability `w`. Pays a premium (escrowed) + an offer fee (= plant_cost:
//!     4/5 is a player spend — studio share + reward pool, 1/5 escrowed as the resolver bounty).
//!  2. `swap_accept`  — holder of B accepts; the VRF seed is fixed NOW (salted
//!     with the latest slot hash, so nobody could have requested it earlier).
//!  3. `swap_resolve` — permissionless after the target slot, once ORAO has
//!     answered the seed. roll = H("recursia:swap", entropy(VRF), swap) → with probability w the two blocks
//!     exchange contents (all life inside moves). Premium → acceptor (paid for
//!     taking the risk, whatever the outcome). Once accepted the swap is
//!     BINDING on the blocks, not on the people: if a block changes hands in
//!     the meantime the new holder inherits the pending swap (it is public
//!     state). A "void if holder changed" rule would let the losing side read
//!     the target hash and void the bet by buying its own block from an alt.
//!  4. `swap_cancel`  — offerer before acceptance, anyone after expiry.
//!
//! No hidden information is involved (everything is public), so there is no
//! withholding problem: once the target hash exists anyone can settle — the
//! winning side or a keeper always will.

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

/// Probability roll for a swap (32 bits mod 10 000).
pub fn swap_roll(entropy: &[u8; 32], swap: &Pubkey) -> u32 {
    let r = anchor_lang::solana_program::hash::hashv(&[b"recursia:swap", entropy, swap.as_ref()]).to_bytes();
    u32::from_le_bytes([r[0], r[1], r[2], r[3]]) % 10_000
}

// ---------------------------------------------------------------- offer

#[derive(Accounts)]
#[instruction(index_a: u8, index_b: u8)]
pub struct SwapOffer<'info> {
    #[account(mut)]
    pub offerer: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        seeds = [SEED_TERRITORY, world.key().as_ref(), &[index_a]], bump = territory_a.bump,
        constraint = territory_a.holder == offerer.key() @ RecursiaError::NotHolder
    )]
    pub territory_a: Box<Account<'info, Territory>>,
    #[account(seeds = [SEED_TERRITORY, world.key().as_ref(), &[index_b]], bump = territory_b.bump)]
    pub territory_b: Box<Account<'info, Territory>>,
    #[account(
        init, payer = offerer, space = 8 + QuantumSwap::INIT_SPACE,
        seeds = [SEED_SWAP, world.key().as_ref(), &[index_a], &[index_b]], bump
    )]
    pub swap: Box<Account<'info, QuantumSwap>>,
    /// Refunds (void / cancel) are pull-payments to this Player account.
    #[account(
        init_if_needed, payer = offerer, space = 8 + Player::INIT_SPACE,
        seeds = [SEED_PLAYER, offerer.key().as_ref()], bump
    )]
    pub offerer_player: Box<Account<'info, Player>>,
    #[account(mut, token::mint = mint, token::authority = offerer)]
    pub offerer_token: Box<Account<'info, TokenAccount>>,
    /// Studio treasury (SKR): `protocol_bps` of every player spend.
    #[account(mut, seeds = [SEED_TREASURY], bump = config.treasury_bump)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    /// Player reward pool (SKR). Receives the non-studio part of every spend.
    #[account(mut, seeds = [SEED_REWARD_POOL], bump = config.reward_pool_bump)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn swap_offer(ctx: Context<SwapOffer>, index_a: u8, index_b: u8, weight_bps: u16, premium: u64) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    let slot = Clock::get()?.slot;
    let p = ctx.accounts.config.params;
    let offerer = ctx.accounts.offerer.key();
    let world_key = ctx.accounts.world.key();

    // ---- checks
    require!(ctx.accounts.world.neutral && ctx.accounts.world.is_quantum(), RecursiaError::NotNeutral);
    require!(index_a != index_b, RecursiaError::DuplicateAccounts);
    require!(weight_bps > 0 && weight_bps as u64 <= BPS, RecursiaError::InvalidWeight);
    let acceptor = ctx.accounts.territory_b.holder;
    require!(acceptor != Pubkey::default(), RecursiaError::NotHolder);
    require_keys_neq!(acceptor, offerer, RecursiaError::SelfSwap);
    let fee = p.plant_cost;
    let bounty = fee / SWAP_BOUNTY_DIV;
    let (studio, to_pool) = math::split_spend(math::sub(fee, bounty)?, p.protocol_bps)?;
    let escrow = math::add(premium, bounty)?;

    // ---- effects
    {
        let pl = &mut ctx.accounts.offerer_player;
        if pl.owner == Pubkey::default() {
            pl.version = ACCOUNT_VERSION;
            pl.bump = ctx.bumps.offerer_player;
            pl.owner = offerer;
        }
    }
    {
        let snapshot = Config::clone(&ctx.accounts.config);
        roll_world_epoch(&mut ctx.accounts.world, &snapshot);
        record_sink(&mut ctx.accounts.world, &mut ctx.accounts.config, to_pool)?;
        let w = &mut ctx.accounts.world;
        w.quantum_escrow = math::add(w.quantum_escrow, escrow)?;
    }
    let s = &mut ctx.accounts.swap;
    s.version = ACCOUNT_VERSION;
    s.bump = ctx.bumps.swap;
    s.world = world_key;
    s.offerer = offerer;
    s.acceptor = acceptor;
    s.index_a = index_a;
    s.index_b = index_b;
    s.weight_bps = weight_bps;
    s.premium = premium;
    s.bounty = bounty;
    s.created_slot = slot;
    s.expiry_slot = slot.checked_add(SWAP_OFFER_TTL_SLOTS).ok_or(RecursiaError::MathOverflow)?;

    // ---- interactions
    let tp = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();
    let from = ctx.accounts.offerer_token.to_account_info();
    let auth = ctx.accounts.offerer.to_account_info();
    user_spend(
        &tp, &mint, &from, &auth,
        &ctx.accounts.treasury.to_account_info(), &ctx.accounts.reward_pool.to_account_info(),
        studio, to_pool,
    )?;
    user_transfer(&tp, &mint, &from, &ctx.accounts.world_vault.to_account_info(), &auth, escrow)?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    emit!(SwapOffered { world: world_key, offerer, acceptor, index_a, index_b, weight_bps, premium });
    Ok(())
}

// ---------------------------------------------------------------- accept

#[derive(Accounts)]
pub struct SwapAccept<'info> {
    #[account(mut)]
    pub acceptor: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    pub world: Box<Account<'info, World>>,
    #[account(
        mut, seeds = [SEED_SWAP, world.key().as_ref(), &[swap.index_a], &[swap.index_b]], bump = swap.bump,
        has_one = world, has_one = acceptor
    )]
    pub swap: Box<Account<'info, QuantumSwap>>,
    pub territory_a: Box<Account<'info, Territory>>,
    pub territory_b: Box<Account<'info, Territory>>,
    /// Premium is paid as a pull-payment to this Player account.
    #[account(
        init_if_needed, payer = acceptor, space = 8 + Player::INIT_SPACE,
        seeds = [SEED_PLAYER, acceptor.key().as_ref()], bump
    )]
    pub acceptor_player: Box<Account<'info, Player>>,
    /// CHECK: address-pinned SlotHashes sysvar; only its newest entry is read
    /// (it salts the VRF seed so randomness can't be requested before the position exists).
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID @ RecursiaError::SlotHashes)]
    pub slot_hashes: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn swap_accept(ctx: Context<SwapAccept>) -> Result<()> {
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    let slot = Clock::get()?.slot;
    let s = &ctx.accounts.swap;
    require!(!s.accepted, RecursiaError::SwapAccepted);
    require!(slot <= s.expiry_slot, RecursiaError::SwapExpired);
    check_territory_pda(&ctx.accounts.territory_a, &s.world, ctx.program_id)?;
    check_territory_pda(&ctx.accounts.territory_b, &s.world, ctx.program_id)?;
    require!(ctx.accounts.territory_a.index == s.index_a && ctx.accounts.territory_b.index == s.index_b, RecursiaError::Mismatch);
    // Block A's current holder must be the one who offered (a new holder never agreed).
    require_keys_eq!(ctx.accounts.territory_a.holder, s.offerer, RecursiaError::NotHolder);
    require_keys_eq!(ctx.accounts.territory_b.holder, ctx.accounts.acceptor.key(), RecursiaError::NotHolder);

    let acceptor = ctx.accounts.acceptor.key();
    {
        let pl = &mut ctx.accounts.acceptor_player;
        if pl.owner == Pubkey::default() {
            pl.version = ACCOUNT_VERSION;
            pl.bump = ctx.bumps.acceptor_player;
            pl.owner = acceptor;
        }
    }
    let target = slot.checked_add(QUANTUM_DELAY_SLOTS).ok_or(RecursiaError::MathOverflow)?;
    let recent = {
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        quantum::latest_slot_hash(&data).ok_or(RecursiaError::SlotHashes)?
    };
    let swap_key = ctx.accounts.swap.key();
    let s = &mut ctx.accounts.swap;
    s.accepted = true;
    s.target_slot = target;
    s.vrf_seed = quantum::vrf_seed_swap(&swap_key.to_bytes(), &recent, slot);
    emit!(SwapAccepted { world: s.world, index_a: s.index_a, index_b: s.index_b, target_slot: target });
    Ok(())
}

// ---------------------------------------------------------------- resolve (crank)

#[derive(Accounts)]
pub struct SwapResolve<'info> {
    pub resolver: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut, seeds = [SEED_SWAP, world.key().as_ref(), &[swap.index_a], &[swap.index_b]], bump = swap.bump,
        has_one = world, has_one = offerer
    )]
    pub swap: Box<Account<'info, QuantumSwap>>,
    /// CHECK: receives the swap account's rent on close; pinned by `has_one = offerer`.
    #[account(mut)]
    pub offerer: UncheckedAccount<'info>,
    #[account(mut)]
    pub acceptor_player: Box<Account<'info, Player>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint)]
    pub resolver_token: Box<Account<'info, TokenAccount>>,
    /// CHECK: ORAO VRF randomness account. Validated in the handler: address ==
    /// ORAO PDA of the seed fixed when the position was opened, owner == ORAO,
    /// state == Fulfilled with that seed (`quantum::orao_fulfilled`).
    pub vrf_request: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Works while paused: it settles positions that were already agreed.
pub fn swap_resolve(ctx: Context<SwapResolve>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let s = QuantumSwap::clone(&ctx.accounts.swap);
    let swap_key = ctx.accounts.swap.key();
    let world_key = ctx.accounts.world.key();

    // ---- checks
    require!(s.accepted, RecursiaError::SwapNotAccepted);
    require!(slot > s.target_slot, RecursiaError::NotMeasurable);
    check_player_pda(&ctx.accounts.acceptor_player, &s.acceptor, ctx.program_id)?;
    let entropy = quantum::entropy_from_vrf(&read_vrf(&ctx.accounts.vrf_request, &s.vrf_seed)?);

    // ---- effects
    let swapped = swap_roll(&entropy, &swap_key) < s.weight_bps as u32;
    {
        let w = &mut ctx.accounts.world;
        if swapped {
            sim::swap_blocks(&mut w.grid, s.index_a, s.index_b);
            w.territory_alive[s.index_a as usize] = block_count(&w.grid, s.index_a as usize);
            w.territory_alive[s.index_b as usize] = block_count(&w.grid, s.index_b as usize);
        }
        w.quantum_escrow = math::sub(w.quantum_escrow, math::add(s.premium, s.bounty)?)?;
    }
    {
        let pl = &mut ctx.accounts.acceptor_player;
        pl.claimable = math::add(pl.claimable, s.premium)?;
        pl.total_earned = math::add(pl.total_earned, s.premium)?;
    }

    // ---- interactions
    let bump = ctx.accounts.config.bump;
    let tp = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();
    let vault = ctx.accounts.world_vault.to_account_info();
    let cfg = ctx.accounts.config.to_account_info();
    vault_transfer(&tp, &mint, &vault, &ctx.accounts.claims_vault.to_account_info(), &cfg, bump, s.premium)?;
    vault_transfer(&tp, &mint, &vault, &ctx.accounts.resolver_token.to_account_info(), &cfg, bump, s.bounty)?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    ctx.accounts.swap.close(ctx.accounts.offerer.to_account_info())?;
    emit!(SwapResolved { world: world_key, index_a: s.index_a, index_b: s.index_b, swapped, entropy, bounty: s.bounty });
    Ok(())
}

// ---------------------------------------------------------------- cancel

#[derive(Accounts)]
pub struct SwapCancel<'info> {
    pub caller: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub world: Box<Account<'info, World>>,
    #[account(mut, seeds = [SEED_WORLD_VAULT, world.key().as_ref()], bump = world.vault_bump)]
    pub world_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut, seeds = [SEED_SWAP, world.key().as_ref(), &[swap.index_a], &[swap.index_b]], bump = swap.bump,
        has_one = world, has_one = offerer, close = offerer
    )]
    pub swap: Box<Account<'info, QuantumSwap>>,
    /// CHECK: receives the swap account's rent; pinned by `has_one = offerer`.
    #[account(mut)]
    pub offerer: UncheckedAccount<'info>,
    #[account(mut)]
    pub offerer_player: Box<Account<'info, Player>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint)]
    pub caller_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Offerer: any time before acceptance. Anyone: after expiry (bounty).
/// Allowed while paused (it only returns funds).
pub fn swap_cancel(ctx: Context<SwapCancel>) -> Result<()> {
    let slot = Clock::get()?.slot;
    let s = QuantumSwap::clone(&ctx.accounts.swap);
    require!(!s.accepted, RecursiaError::SwapAccepted);
    let by_offerer = ctx.accounts.caller.key() == s.offerer;
    require!(by_offerer || slot > s.expiry_slot, RecursiaError::SwapOpen);
    check_player_pda(&ctx.accounts.offerer_player, &s.offerer, ctx.program_id)?;
    {
        let w = &mut ctx.accounts.world;
        w.quantum_escrow = math::sub(w.quantum_escrow, math::add(s.premium, s.bounty)?)?;
        let pl = &mut ctx.accounts.offerer_player;
        pl.claimable = math::add(pl.claimable, s.premium)?;
    }
    let bump = ctx.accounts.config.bump;
    let tp = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();
    let vault = ctx.accounts.world_vault.to_account_info();
    let cfg = ctx.accounts.config.to_account_info();
    vault_transfer(&tp, &mint, &vault, &ctx.accounts.claims_vault.to_account_info(), &cfg, bump, s.premium)?;
    vault_transfer(&tp, &mint, &vault, &ctx.accounts.caller_token.to_account_info(), &cfg, bump, s.bounty)?;
    ctx.accounts.world_vault.reload()?;
    assert_world_solvent(&ctx.accounts.world, ctx.accounts.world_vault.amount)?;
    emit!(SwapCancelled { world: s.world, index_a: s.index_a, index_b: s.index_b });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cross-implementation vector (TS: `swapRoll` in packages/sdk/src/quantum.ts).
    #[test]
    fn swap_roll_matches_ts() {
        let mut e = [0u8; 32];
        let mut s = [0u8; 32];
        for i in 0..32 {
            e[i] = i as u8;
            s[i] = 255 - i as u8;
        }
        assert_eq!(swap_roll(&e, &Pubkey::new_from_array(s)), 7480);
        assert_eq!(swap_roll(&[0u8; 32], &Pubkey::new_from_array([0u8; 32])), 6933);
    }
}

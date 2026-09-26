use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::RecursiaError;

/// Tunable economy parameters. Changes only through `propose` → timelock →
/// `execute`, and every field is range-checked against hard constants.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct Params {
    pub timelock_secs: i64,
    pub world_create_fee: u64,
    pub module_register_fee: u64,
    /// Share of creation/registration fees that is burned (rest → treasury).
    pub fee_burn_bps: u16,
    pub tick_cost: u64,
    pub tick_interval_slots: u64,
    pub gens_per_tick: u8,
    pub cranker_bps: u16,
    pub protocol_bps: u16,
    pub host_bps: u16,
    pub epoch_slots: u64,
    pub emission_rate_bps: u16,
    pub rebate_cap_bps: u16,
    pub harberger_bps: u16,
    pub min_price: u64,
    pub plant_cost: u64,
}

impl Params {
    pub fn default_mainnet() -> Self {
        Params {
            timelock_secs: MIN_TIMELOCK_SECS,
            world_create_fee: 1_000 * ONE,
            module_register_fee: 5_000 * ONE,
            fee_burn_bps: 5_000,
            tick_cost: 10 * ONE,
            tick_interval_slots: 150,
            gens_per_tick: 4,
            cranker_bps: 200,
            protocol_bps: 1_000,
            host_bps: 1_500,
            epoch_slots: 216_000,
            emission_rate_bps: 50,
            rebate_cap_bps: 9_000,
            harberger_bps: 50,
            min_price: 10 * ONE,
            plant_cost: 5 * ONE,
        }
    }

    pub fn validate(&self) -> Result<()> {
        let ok = self.timelock_secs >= MIN_TIMELOCK_SECS
            && self.timelock_secs <= MAX_TIMELOCK_SECS
            && self.world_create_fee > 0
            && self.world_create_fee <= MAX_PRICE
            && self.module_register_fee > 0
            && self.module_register_fee <= MAX_PRICE
            && (self.fee_burn_bps as u64) <= BPS
            && self.tick_cost >= 1_000 // must be large enough that fee splits are non-zero
            && self.tick_cost <= MAX_PRICE
            && self.tick_interval_slots >= MIN_TICK_INTERVAL
            && self.gens_per_tick >= 1
            && self.gens_per_tick <= MAX_GENS_PER_TICK
            // burn floor: cranker + protocol + host + max royalty ≤ 100% − MIN_BURN
            && (self.cranker_bps as u64
                + self.protocol_bps as u64
                + self.host_bps as u64
                + MAX_ROYALTY_BPS as u64)
                <= BPS - MIN_TICK_BURN_BPS
            && self.epoch_slots >= MIN_EPOCH_SLOTS
            && self.epoch_slots >= self.tick_interval_slots
            && (self.emission_rate_bps as u64) <= MAX_EMISSION_RATE_BPS
            && (self.rebate_cap_bps as u64) <= MAX_REBATE_BPS
            && self.harberger_bps >= 1
            && (self.harberger_bps as u64) <= MAX_HARBERGER_BPS
            && self.min_price >= ONE / 100
            && self.min_price <= MAX_PRICE
            && self.plant_cost > 0
            && self.plant_cost <= MAX_PRICE;
        require!(ok, RecursiaError::InvalidParams);
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum PendingAction {
    None,
    SetParams(Params),
    SetAdmin(Pubkey),
    /// `recipient` is an SPL token account for the RCR mint.
    TreasurySpend { amount: u64, recipient: Pubkey },
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub version: u8,
    pub bump: u8,
    pub mint_bump: u8,
    pub treasury_bump: u8,
    pub reward_pool_bump: u8,
    pub claims_bump: u8,
    /// Expected to be a Squads multisig vault (≥3-of-5), see SECURITY.md.
    pub admin: Pubkey,
    pub mint: Pubkey,
    pub genesis_done: bool,
    pub paused: bool,
    pub params: Params,
    pub pending: PendingAction,
    pub pending_eta: i64,
    pub pending_nonce: u64,
    pub root_worlds: u64,
    pub total_worlds: u64,
    pub modules: u64,
    // --- global epoch accounting (lazy, O(1)) ---
    pub cur_epoch: u64,
    pub epoch_start_slot: u64,
    pub cur_total_burn: u64,
    pub prev_total_burn: u64,
    pub prev_emission: u64,
    pub prev_claimed: u64,
    // --- lifetime stats / invariants ---
    pub total_burned: u64,
    pub total_emitted: u64,
}

#[account]
#[derive(InitSpace)]
pub struct World {
    pub version: u8,
    pub bump: u8,
    pub vault_bump: u8,
    pub depth: u8,
    /// Parent world (Pubkey::default() for root universes).
    pub parent: Pubkey,
    pub parent_territory: u8,
    pub index: u64,
    /// Pubkey::default() once liberated by a rebellion.
    pub architect: Pubkey,
    pub architect_fee_bps: u16,
    pub module: Pubkey,
    pub birth: u16,
    pub survive: u16,
    pub name: [u8; 32],
    pub grid: [u64; GRID],
    pub generation: u64,
    pub tick_count: u64,
    pub last_tick_slot: u64,
    pub created_slot: u64,
    // --- vault sub-ledgers; vault.amount >= energy + rewards_reserved + deposits + architect_accrued
    pub energy: u64,
    pub rewards_reserved: u64,
    pub deposits: u64,
    pub architect_accrued: u64,
    pub territory_alive: [u16; TERRITORIES],
    /// Rewards credited to a territory (host tax + emission) not yet collected.
    pub territory_pending: [u64; TERRITORIES],
    /// Bit i set = territory i has a holder.
    pub owned_mask: u64,
    // --- epoch scoring ---
    pub epoch_id: u64,
    pub burn_cur: u64,
    pub scores_cur: [u32; TERRITORIES],
    pub prev_epoch_id: u64,
    pub burn_prev: u64,
    pub scores_prev: [u32; TERRITORIES],
    pub prev_claimed: bool,
    // --- recursion mechanics ---
    pub resonance: u16,
    pub child_count: u16,
    // --- rebellion ---
    pub rebellion_id: u32,
    pub rebellion_votes: u8,
    pub rebellion_deadline: u64,
    pub last_rebellion_slot: u64,
    pub liberated: bool,
    pub total_burned: u64,
    // --- quantum layer (copied from the module at creation) ---
    pub q_birth: u16,
    pub q_survive: u16,
    pub q_amp: u8,
    /// Seed material of the last quantum tick (public, for replay/verification).
    pub entropy: [u8; 32],
    /// Superposition stakes held in the world vault (part of the solvency ledger).
    pub quantum_escrow: u64,
    pub superpositions: u16,
}

impl World {
    pub fn is_quantum(&self) -> bool {
        self.q_amp > 0 && (self.q_birth | self.q_survive) != 0
    }
    pub fn has_architect(&self) -> bool {
        self.architect != Pubkey::default()
    }
    pub fn is_root(&self) -> bool {
        self.parent == Pubkey::default()
    }
    pub fn rebellion_active(&self, slot: u64) -> bool {
        self.rebellion_id > 0 && slot <= self.rebellion_deadline && !self.liberated
    }
}

#[account]
#[derive(InitSpace)]
pub struct Territory {
    pub version: u8,
    pub bump: u8,
    pub world: Pubkey,
    pub index: u8,
    /// Pubkey::default() when unowned.
    pub holder: Pubkey,
    pub price: u64,
    pub deposit: u64,
    pub last_tax_slot: u64,
    pub last_price_change_slot: u64,
    /// tick_count at which the next plant becomes possible.
    pub next_plant_tick: u64,
    pub acquired_slot: u64,
    pub voted_rebellion: u32,
    pub agent_managed: bool,
    /// Child universe hosted by this territory (Pubkey::default() if none).
    pub child_world: Pubkey,
}

impl Territory {
    pub fn is_held(&self) -> bool {
        self.holder != Pubkey::default()
    }
}

#[account]
#[derive(InitSpace)]
pub struct Player {
    pub version: u8,
    pub bump: u8,
    pub owner: Pubkey,
    /// Tokens withdrawable from the global claims vault.
    pub claimable: u64,
    pub total_earned: u64,
    pub territories: u32,
}

#[account]
#[derive(InitSpace)]
pub struct PhysicsModule {
    pub version: u8,
    pub bump: u8,
    pub id: u64,
    pub author: Pubkey,
    pub birth: u16,
    pub survive: u16,
    pub royalty_bps: u16,
    pub name: [u8; 32],
    pub accrued: u64,
    pub total_earned: u64,
    pub worlds_using: u32,
    /// Quantum extension: counts that fire with probability 2^-q_amp.
    pub q_birth: u16,
    pub q_survive: u16,
    pub q_amp: u8,
}

#[account]
#[derive(InitSpace)]
pub struct AgentPermit {
    pub version: u8,
    pub bump: u8,
    pub vault_bump: u8,
    pub owner: Pubkey,
    /// Hot key used by the AI runner. It can ONLY spend from the permit
    /// vault, within the limits below; it can never withdraw.
    pub agent: Pubkey,
    pub scope: u8,
    /// Pubkey::default() = any world.
    pub allowed_world: Pubkey,
    pub max_spend_per_epoch: u64,
    pub max_price: u64,
    pub spent: u64,
    pub spend_epoch: u64,
    pub expiry_slot: u64,
    pub created_slot: u64,
}

/// A territory planted "in superposition": a hidden commitment to two
/// patterns that collapses into one after an unbiasable measurement.
#[account]
#[derive(InitSpace)]
pub struct Superposition {
    pub version: u8,
    pub bump: u8,
    pub owner: Pubkey,
    pub world: Pubkey,
    pub index: u8,
    /// Entangled partner (different world) or Pubkey::default().
    pub world2: Pubkey,
    pub index2: u8,
    pub commitment: [u8; 32],
    pub commit_slot: u64,
    /// Slot whose hash will be the measurement entropy (fixed at commit / re-arm).
    pub target_slot: u64,
    pub observed: bool,
    pub observed_slot: u64,
    pub entropy: [u8; 32],
    pub reveal_deadline: u64,
    /// Remaining stake in the world vault (also counted in world.quantum_escrow).
    pub stake: u64,
    pub rearms: u8,
}

impl Superposition {
    pub fn is_entangled(&self) -> bool {
        self.world2 != Pubkey::default()
    }
}

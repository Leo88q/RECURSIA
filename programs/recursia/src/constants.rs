//! Immutable protocol constants.  Anything here can only change through a
//! program upgrade (which itself is multisig + timelock gated, see SECURITY.md).

pub const GRID: usize = 64;
pub const TERRITORY_SIDE: usize = 8;
pub const TERRITORIES: usize = 64; // (64/8)^2

/// Max nesting depth of universes (root = 0).
pub const MAX_DEPTH: u8 = 7;

// ---------------- token ----------------
pub const DECIMALS: u8 = 6;
pub const ONE: u64 = 1_000_000; // 10^DECIMALS
/// Fixed total supply: 1,000,000,000 RCR. Minted once at genesis, then the
/// mint authority is revoked forever (checklist #11).
pub const TOTAL_SUPPLY: u64 = 1_000_000_000 * ONE;
/// 45% of supply seeds the emission pool; the remainder goes to the
/// genesis-distribution multisig (liquidity, team vesting, ecosystem grants).
pub const REWARD_POOL_BPS: u64 = 4_500;
/// 10% seeds the protocol treasury (timelocked spend only).
pub const TREASURY_BPS: u64 = 1_000;

pub const BPS: u64 = 10_000;

// ---------------- hard safety bounds on governance ----------------
/// Timelock can never be set below 48h (checklist #20/#82 — Drift lesson).
pub const MIN_TIMELOCK_SECS: i64 = 48 * 60 * 60;
pub const MAX_TIMELOCK_SECS: i64 = 30 * 24 * 60 * 60;
/// Burn share of every tick can never go below 30%.
pub const MIN_TICK_BURN_BPS: u64 = 3_000;
pub const MAX_ROYALTY_BPS: u16 = 500;
pub const MAX_ARCHITECT_FEE_BPS: u16 = 3_000;
/// Emission rebate for a world can never exceed what it actually burned
/// => self-farming is always net-negative (checklist #48/#58).
pub const MAX_REBATE_BPS: u64 = 10_000;
pub const MAX_EMISSION_RATE_BPS: u64 = 200; // ≤2% of pool per epoch
pub const MAX_HARBERGER_BPS: u64 = 500; // ≤5% of price per epoch
pub const MAX_GENS_PER_TICK: u8 = 8;
pub const MIN_EPOCH_SLOTS: u64 = 9_000; // ~1h
pub const MIN_TICK_INTERVAL: u64 = 10;
/// Upper bound on any self-assessed price to keep u128 math far from overflow.
pub const MAX_PRICE: u64 = 1_000_000_000 * ONE;
/// Per-plant cooldown in ticks (anti dup-spam, checklist #56).
pub const PLANT_COOLDOWN_TICKS: u64 = 1;
/// A territory price can change at most once per this many slots.
pub const PRICE_CHANGE_COOLDOWN_SLOTS: u64 = 150;

// ---------------- rebellion / breach ----------------
pub const REBELLION_THRESHOLD_BPS: u64 = 6_667;
pub const REBELLION_MIN_VOTES: u8 = 8;
pub const REBELLION_COOLDOWN_SLOTS: u64 = 216_000;
pub const BREACH_POPULATION: u32 = 400;
pub const BREACH_RESONANCE: u16 = 64;

// ---------------- AI agents ----------------
pub const PERMIT_PLANT: u8 = 1 << 0;
pub const PERMIT_ACQUIRE: u8 = 1 << 1;
pub const PERMIT_ALL: u8 = PERMIT_PLANT | PERMIT_ACQUIRE;
pub const MAX_PERMIT_SLOTS: u64 = 216_000 * 30; // permits expire in ≤ ~30 days

// ---------------- seeds ----------------
pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_MINT: &[u8] = b"mint";
pub const SEED_TREASURY: &[u8] = b"treasury";
pub const SEED_REWARD_POOL: &[u8] = b"reward_pool";
pub const SEED_CLAIMS: &[u8] = b"claims";
pub const SEED_WORLD: &[u8] = b"world";
pub const SEED_WORLD_VAULT: &[u8] = b"world_vault";
pub const SEED_TERRITORY: &[u8] = b"territory";
pub const SEED_PLAYER: &[u8] = b"player";
pub const SEED_MODULE: &[u8] = b"module";
pub const SEED_PERMIT: &[u8] = b"permit";
pub const SEED_PERMIT_VAULT: &[u8] = b"permit_vault";

pub const ACCOUNT_VERSION: u8 = 1;

// ---------------------------------------------------------------- quantum layer
/// Seed for superposition accounts: [SEED_SUPERPOSITION, world, [index]].
pub const SEED_SUPERPOSITION: &[u8] = b"superposition";
/// Max quantum amplitude exponent: a quantum rule fires with p = 2^-amp.
pub const MAX_Q_AMP: u8 = 3;
/// Slots between commit and the scheduled "measurement" slot whose hash is used.
pub const QUANTUM_DELAY_SLOTS: u64 = 32;
/// After observation the owner has this long to reveal (≈ 2.4 h).
pub const QUANTUM_REVEAL_SLOTS: u64 = 21_600;
/// Stake locked per superposed territory = plant_cost × this.
pub const QUANTUM_STAKE_MULT: u64 = 4;
/// Observer / decoherence bounty = stake / this.
pub const QUANTUM_BOUNTY_DIV: u64 = 20;
/// Part of the stake burned when an expired measurement must be re-armed
/// (punishes an owner who hopes nobody observes an unfavourable outcome).
pub const QUANTUM_REARM_BURN_BPS: u64 = 2_500;
/// Probability (x/256) that a collapsing pattern also tunnels into a neighbour block.
pub const TUNNEL_CHANCE_256: u8 = 16;
/// SlotHashes sysvar keeps at most this many recent entries.
pub const SLOT_HASHES_MAX: usize = 512;

// ---------------------------------------------------------------- neutral worlds / quantum swap
pub const SEED_SWAP: &[u8] = b"swap";
/// Offer fee = plant_cost: 1/SWAP_BOUNTY_DIV goes to whoever resolves/cancels, rest burned.
pub const SWAP_BOUNTY_DIV: u64 = 5;
/// An unaccepted offer expires after this many slots (then anyone may cancel it).
pub const SWAP_OFFER_TTL_SLOTS: u64 = 21_600;

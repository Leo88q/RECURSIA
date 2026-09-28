//! Immutable protocol constants.  Anything here can only change through a
//! program upgrade (which itself is multisig + timelock gated, see SECURITY.md).

pub const GRID: usize = 64;
pub const TERRITORY_SIDE: usize = 8;
pub const TERRITORIES: usize = 64; // (64/8)^2

/// Max nesting depth of universes (root = 0).
pub const MAX_DEPTH: u8 = 7;

// ---------------- token ----------------
/// The game currency is SKR — the native token of the Solana Mobile ecosystem
/// (classic SPL Token program, 6 decimals, freeze authority = none).  RECURSIA
/// never mints or burns it: every player spend is split between the studio
/// treasury and the player reward pool (see `common::user_spend`).
pub const DECIMALS: u8 = 6;
pub const ONE: u64 = 1_000_000; // 10^DECIMALS
/// Official SKR mint.  Mainnet builds (`--features mainnet`) refuse any other
/// mint in `initialize`: counterfeit "SKR" mints exist (checklist #11/#39).
pub const SKR_MINT: anchor_lang::prelude::Pubkey =
    anchor_lang::solana_program::pubkey!("SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3");

pub const BPS: u64 = 10_000;

// ---------------- hard safety bounds on governance ----------------
/// Timelock can never be set below 48h (checklist #20/#82 — Drift lesson).
pub const MIN_TIMELOCK_SECS: i64 = 48 * 60 * 60;
pub const MAX_TIMELOCK_SECS: i64 = 30 * 24 * 60 * 60;
/// Share of every tick that flows back to the player reward pool can never
/// go below 30% (the part that used to be burned in the RCR design).
pub const MIN_TICK_POOL_BPS: u64 = 3_000;
/// Studio share of any player spend can never exceed 25%.
pub const MAX_PROTOCOL_BPS: u64 = 2_500;
pub const MAX_ROYALTY_BPS: u16 = 500;
pub const MAX_ARCHITECT_FEE_BPS: u16 = 3_000;
/// Emission rebate for a world can never exceed what it actually paid into the pool
/// => self-farming is always net-negative (checklist #48/#58).
pub const MAX_REBATE_BPS: u64 = 10_000;
pub const MAX_EMISSION_RATE_BPS: u64 = 2_000; // ≤20% of pool per epoch
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

// ---------------- sponsor pool ----------------
/// Share of the sponsor pool paid out per epoch (by live cells, not by spend).
pub const SPONSOR_RATE_BPS: u64 = 1_000;
/// A world's sponsor reward can never exceed this share of its OWN pool
/// contribution in the epoch: a world that did not play gets nothing, so
/// empty sybil worlds cannot drain sponsor money (#48/#58).
pub const SPONSOR_CAP_BPS: u64 = 10_000;

// ---------------- seasons ----------------
/// Season length in epochs (≈ 1 week).
pub const SEASON_EPOCHS: u64 = 7;
/// Share of every studio inflow into the treasury that is swept into the
/// season prize pool at each `advance_epoch` (25% of 20% = 5% of all spend).
pub const SEASON_SHARE_BPS: u64 = 2_500;
/// A prize can never exceed this share of the winner's own season points
/// (SKR collected from life rewards): buying points always costs more than
/// the prize they can win (anti leaderboard farming).
pub const SEASON_PRIZE_CAP_BPS: u64 = 2_500;
pub const SEASON_TOP: usize = 10;
/// Prize split of the season pool by rank (sums to 100%).
pub const SEASON_RANK_BPS: [u64; SEASON_TOP] = [3_000, 2_000, 1_500, 1_000, 800, 600, 400, 300, 200, 200];

/// Efficiency share: this part of every epoch's emission is split by live-cell
/// score on owned territories across ALL worlds (not by own spend), so better
/// gardeners win money from worse ones — the skill redistribution that lets a
/// real fraction of players end up net positive.
pub const EFFICIENCY_SHARE_BPS: u64 = 3_000;
/// Per-world cap of the efficiency share: ≤ 200% of its own pool contribution
/// (a world that paid nothing gets nothing; bounds any single world's take).
pub const EFFICIENCY_CAP_BPS: u64 = 20_000;

/// Season tournaments: opt-in entry fee, 10% rake to the studio, the pot goes
/// to the top 30% of entrants by season points (linear weights).
pub const TOURNAMENT_RAKE_BPS: u64 = 1_000;
pub const TOURNAMENT_PAID_BPS: u64 = 3_000;
/// Entry-fee tiers in units of `params.plant_cost` (350 SKR by default →
/// 700 SKR and 7 000 SKR).
pub const TOURNAMENT_TIERS: [u64; 2] = [2, 20];
pub const TOURNAMENT_MAX_PLAYERS: u32 = 40;
/// = ceil(TOURNAMENT_MAX_PLAYERS × 30%)
pub const TOURNAMENT_TOP: usize = 12;
/// Joining is open only during the first epoch of a season (no late sniping).
pub const TOURNAMENT_JOIN_EPOCHS: u64 = 1;

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
pub const SEED_TREASURY: &[u8] = b"treasury";
pub const SEED_REWARD_POOL: &[u8] = b"reward_pool";
pub const SEED_CLAIMS: &[u8] = b"claims";
pub const SEED_SPONSOR_POOL: &[u8] = b"sponsor_pool";
pub const SEED_SEASON_POOL: &[u8] = b"season_pool";
pub const SEED_SEASON: &[u8] = b"season";
pub const SEED_TOURNAMENT: &[u8] = b"tournament";
pub const SEED_TOURNAMENT_ENTRY: &[u8] = b"entry";
pub const SEED_TOURNAMENT_POOL: &[u8] = b"tournament_pool";
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
/// Part of the stake sent to the reward pool when an expired measurement must
/// be re-armed (punishes an owner who hopes nobody observes a bad outcome).
pub const QUANTUM_REARM_PENALTY_BPS: u64 = 2_500;
/// Probability (x/256) that a collapsing pattern also tunnels into a neighbour block.
pub const TUNNEL_CHANCE_256: u8 = 16;
/// SlotHashes sysvar keeps at most this many recent entries.
pub const SLOT_HASHES_MAX: usize = 512;

// ---------------------------------------------------------------- neutral worlds / quantum swap
pub const SEED_SWAP: &[u8] = b"swap";
/// Offer fee = plant_cost: 1/SWAP_BOUNTY_DIV goes to whoever resolves/cancels, rest is a player spend (studio share → treasury, remainder → reward pool).
pub const SWAP_BOUNTY_DIV: u64 = 5;
/// An unaccepted offer expires after this many slots (then anyone may cancel it).
pub const SWAP_OFFER_TTL_SLOTS: u64 = 21_600;

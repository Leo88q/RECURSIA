use anchor_lang::prelude::*;

#[error_code]
pub enum RecursiaError {
    #[msg("Arithmetic overflow/underflow")]
    MathOverflow,
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Genesis already executed")]
    GenesisDone,
    #[msg("Genesis not executed yet")]
    GenesisPending,
    #[msg("Parameter out of hard safety bounds")]
    InvalidParams,
    #[msg("Timelock has not elapsed")]
    TimelockActive,
    #[msg("No pending governance action")]
    NoPendingAction,
    #[msg("A governance action is already pending")]
    ActionAlreadyPending,
    #[msg("Unauthorized signer")]
    Unauthorized,
    #[msg("Instruction must be called at the top level of a transaction (no CPI)")]
    CpiForbidden,
    #[msg("Invalid rule mask")]
    InvalidRule,
    #[msg("Max universe depth reached")]
    MaxDepth,
    #[msg("Territory index out of range")]
    BadTerritory,
    #[msg("Territory is not owned by the signer")]
    NotHolder,
    #[msg("Territory already has a holder")]
    AlreadyHeld,
    #[msg("Price above caller's max (slippage guard)")]
    PriceSlippage,
    #[msg("Price out of range")]
    BadPrice,
    #[msg("Deposit too small")]
    DepositTooSmall,
    #[msg("Cooldown active")]
    Cooldown,
    #[msg("Too early to tick")]
    TickTooEarly,
    #[msg("World has not enough energy")]
    OutOfEnergy,
    #[msg("Host territory is dead: universe is dormant")]
    Dormant,
    #[msg("Epoch not finished")]
    EpochNotOver,
    #[msg("Nothing to claim")]
    NothingToClaim,
    #[msg("Claim window closed or wrong epoch")]
    ClaimWindow,
    #[msg("Account relationship mismatch")]
    Mismatch,
    #[msg("Duplicate accounts")]
    DuplicateAccounts,
    #[msg("Vault invariant violated")]
    InvariantViolated,
    #[msg("Rebellion not possible now")]
    RebellionUnavailable,
    #[msg("Already voted")]
    AlreadyVoted,
    #[msg("Rebellion threshold not met")]
    RebellionThreshold,
    #[msg("Not enough resonance for breach")]
    NoResonance,
    #[msg("Agent permit expired")]
    PermitExpired,
    #[msg("Agent permit does not allow this action")]
    PermitScope,
    #[msg("Agent spend limit exceeded for this epoch")]
    PermitLimit,
    #[msg("World has no architect")]
    NoArchitect,
    #[msg("Invalid name")]
    BadName,
    #[msg("Unsupported account version")]
    BadVersion,
}

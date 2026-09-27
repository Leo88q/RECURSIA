use anchor_lang::prelude::*;

#[error_code]
pub enum RecursiaError {
    #[msg("Arithmetic overflow/underflow")]
    MathOverflow,
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Mint is not SKR (wrong address, decimals or has a freeze authority)")]
    BadMint,
    #[msg("Amount must be positive")]
    ZeroAmount,
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
    #[msg("Measurement slot not reached yet")]
    NotMeasurable,
    #[msg("Superposition already observed")]
    AlreadyObserved,
    #[msg("Superposition not observed yet")]
    NotObserved,
    #[msg("Reveal window closed: the state decohered")]
    RevealWindowClosed,
    #[msg("Revealed state does not match the commitment")]
    CommitmentMismatch,
    #[msg("Only allowed in a neutral quantum world")]
    NotNeutral,
    #[msg("Swap already accepted")]
    SwapAccepted,
    #[msg("Swap not accepted yet")]
    SwapNotAccepted,
    #[msg("Swap offer expired")]
    SwapExpired,
    #[msg("Swap offer still open")]
    SwapOpen,
    #[msg("Cannot swap with yourself")]
    SelfSwap,
    #[msg("Superposition is still coherent")]
    StillCoherent,
    #[msg("Invalid amplitude / weight")]
    InvalidWeight,
    #[msg("SlotHashes sysvar unavailable or malformed")]
    SlotHashes,
    #[msg("No season points to submit")]
    NoSeasonPoints,
    #[msg("Season prize already paid or not won")]
    NoPrize,
    #[msg("Treasury amount not yet split with the season pool")]
    TreasuryLocked,
}

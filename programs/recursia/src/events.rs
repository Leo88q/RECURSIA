use anchor_lang::prelude::*;

// checklist #19: events only for economically meaningful state changes.

#[event]
pub struct WorldCreated {
    pub world: Pubkey,
    pub parent: Pubkey,
    pub parent_territory: u8,
    pub depth: u8,
    pub architect: Pubkey,
    pub module: Pubkey,
}

#[event]
pub struct Ticked {
    pub world: Pubkey,
    pub generation: u64,
    pub population: u32,
    pub to_pool: u64,
    pub host_tax: u64,
    pub royalty: u64,
    pub cranker: Pubkey,
}

#[event]
pub struct TerritoryAcquired {
    pub world: Pubkey,
    pub index: u8,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub price_paid: u64,
    pub new_price: u64,
    pub by_agent: bool,
}

#[event]
pub struct Foreclosed {
    pub world: Pubkey,
    pub index: u8,
    pub holder: Pubkey,
}

#[event]
pub struct Planted {
    pub world: Pubkey,
    pub index: u8,
    pub pattern: u64,
    pub by_agent: bool,
}

#[event]
pub struct EpochAdvanced {
    pub epoch: u64,
    pub total_sink: u64,
    pub emission: u64,
}

#[event]
pub struct EmissionClaimed {
    pub world: Pubkey,
    pub epoch: u64,
    pub amount: u64,
}

#[event]
pub struct Breach {
    pub child: Pubkey,
    pub host: Pubkey,
    pub territory: u8,
}

#[event]
pub struct Liberated {
    pub world: Pubkey,
    pub former_architect: Pubkey,
    pub votes: u8,
}

#[event]
pub struct GovernanceProposed {
    pub nonce: u64,
    pub eta: i64,
}

#[event]
pub struct GovernanceExecuted {
    pub nonce: u64,
}

#[event]
pub struct PauseChanged {
    pub paused: bool,
}

// ---------------------------------------------------------------- quantum layer

#[event]
pub struct Superposed {
    pub world: Pubkey,
    pub index: u8,
    pub owner: Pubkey,
    pub world2: Pubkey,
    pub index2: u8,
    pub target_slot: u64,
    pub stake: u64,
}

#[event]
pub struct Observed {
    pub world: Pubkey,
    pub index: u8,
    pub observer: Pubkey,
    pub measured_slot: u64,
    pub entropy: [u8; 32],
    pub bounty: u64,
}

#[event]
pub struct Rearmed {
    pub world: Pubkey,
    pub index: u8,
    pub new_target_slot: u64,
    pub penalty: u64,
}

#[event]
pub struct Collapsed {
    pub world: Pubkey,
    pub index: u8,
    pub branch_a: bool,
    pub pattern: u64,
    pub tunnel_to: Option<u8>,
    pub entangled_world: Pubkey,
    pub entangled_pattern: u64,
}

#[event]
pub struct Decohered {
    pub world: Pubkey,
    pub index: u8,
    pub penalty: u64,
    pub bounty: u64,
}

#[event]
pub struct SwapOffered {
    pub world: Pubkey,
    pub offerer: Pubkey,
    pub acceptor: Pubkey,
    pub index_a: u8,
    pub index_b: u8,
    pub weight_bps: u16,
    pub premium: u64,
}

#[event]
pub struct SwapAccepted {
    pub world: Pubkey,
    pub index_a: u8,
    pub index_b: u8,
    pub target_slot: u64,
}

#[event]
pub struct SwapResolved {
    pub world: Pubkey,
    pub index_a: u8,
    pub index_b: u8,
    /// Blocks exchanged.
    pub swapped: bool,
    pub entropy: [u8; 32],
    pub bounty: u64,
}

#[event]
pub struct SwapRearmed {
    pub world: Pubkey,
    pub index_a: u8,
    pub index_b: u8,
    pub new_target_slot: u64,
}

#[event]
pub struct SwapCancelled {
    pub world: Pubkey,
    pub index_a: u8,
    pub index_b: u8,
}

/// SKR added to the player reward pool from outside (studio top-ups, partners).
#[event]
pub struct RewardPoolFunded {
    pub funder: Pubkey,
    pub amount: u64,
}

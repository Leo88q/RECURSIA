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
    pub burned: u64,
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
    pub total_burn: u64,
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

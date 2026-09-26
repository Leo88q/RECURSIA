//! RECURSIA — nested cellular universes on Solana.
//!
//! Every world is a 64x64 Life-like cellular automaton computed fully
//! on-chain. Territory holders can spawn child universes inside their 8x8
//! block; child universes live only while their host block lives, pay a
//! host tax upward, and can "breach" back into the parent. See docs/.
#![allow(unexpected_cfgs)]
// Anchor 0.31 `#[program]` codegen calls AccountInfo::realloc (deprecated in
// newer solana-program); the warning originates in macro output, not our code.
#![allow(deprecated)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod math;
pub mod sim;
pub mod state;

use instructions::*;
use state::{Params, PendingAction};

declare_id!("2GrrTSyT4AG58XkEjtsV18dV8RPm6AZgQSjSxguCwCik");

#[program]
pub mod recursia {
    use super::*;

    // ---- governance
    pub fn initialize(ctx: Context<Initialize>, admin: Pubkey, params: Params) -> Result<()> {
        admin::initialize(ctx, admin, params)
    }
    pub fn genesis(ctx: Context<Genesis>) -> Result<()> {
        admin::genesis(ctx)
    }
    pub fn propose(ctx: Context<AdminOnly>, action: PendingAction) -> Result<()> {
        admin::propose(ctx, action)
    }
    pub fn cancel(ctx: Context<AdminOnly>) -> Result<()> {
        admin::cancel(ctx)
    }
    pub fn execute(ctx: Context<Execute>, expected_nonce: u64) -> Result<()> {
        admin::execute(ctx, expected_nonce)
    }
    pub fn set_pause(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        admin::set_pause(ctx, paused)
    }
    pub fn advance_epoch(ctx: Context<AdvanceEpoch>) -> Result<()> {
        admin::advance_epoch(ctx)
    }

    // ---- physics modules (developer marketplace)
    pub fn register_module(
        ctx: Context<RegisterModule>,
        birth: u16,
        survive: u16,
        royalty_bps: u16,
        name: [u8; 32],
    ) -> Result<()> {
        module::register_module(ctx, birth, survive, royalty_bps, name)
    }
    pub fn claim_module_royalties(ctx: Context<ClaimModuleRoyalties>) -> Result<()> {
        module::claim_module_royalties(ctx)
    }

    // ---- worlds
    pub fn create_root_world(
        ctx: Context<CreateRootWorld>,
        architect_fee_bps: u16,
        name: [u8; 32],
        initial_energy: u64,
    ) -> Result<()> {
        world::create_root_world(ctx, architect_fee_bps, name, initial_energy)
    }
    pub fn create_child_world(
        ctx: Context<CreateChildWorld>,
        architect_fee_bps: u16,
        name: [u8; 32],
        initial_energy: u64,
    ) -> Result<()> {
        world::create_child_world(ctx, architect_fee_bps, name, initial_energy)
    }
    pub fn fund_world(ctx: Context<FundWorld>, amount: u64) -> Result<()> {
        world::fund_world(ctx, amount)
    }
    pub fn tick(ctx: Context<Tick>) -> Result<()> {
        world::tick(ctx)
    }
    pub fn claim_world_epoch(ctx: Context<ClaimWorldEpoch>) -> Result<()> {
        world::claim_world_epoch(ctx)
    }
    pub fn breach(ctx: Context<DoBreach>) -> Result<()> {
        world::breach(ctx)
    }
    pub fn claim_architect(ctx: Context<ClaimArchitect>) -> Result<()> {
        world::claim_architect(ctx)
    }

    // ---- territories
    pub fn acquire(ctx: Context<Acquire>, index: u8, max_price: u64, new_price: u64, deposit: u64) -> Result<()> {
        territory::acquire(ctx, index, max_price, new_price, deposit)
    }
    pub fn set_price(ctx: Context<HolderOp>, new_price: u64) -> Result<()> {
        territory::set_price(ctx, new_price)
    }
    pub fn top_up(ctx: Context<HolderOp>, amount: u64) -> Result<()> {
        territory::top_up(ctx, amount)
    }
    pub fn withdraw_deposit(ctx: Context<HolderOp>, amount: u64) -> Result<()> {
        territory::withdraw_deposit(ctx, amount)
    }
    pub fn collect(ctx: Context<HolderOp>) -> Result<()> {
        territory::collect(ctx)
    }
    pub fn plant(ctx: Context<Plant>, pattern: u64) -> Result<()> {
        territory::plant(ctx, pattern)
    }
    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        territory::settle(ctx)
    }
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        territory::withdraw(ctx, amount)
    }

    // ---- rebellion
    pub fn start_rebellion(ctx: Context<RebellionVote>) -> Result<()> {
        rebellion::start_rebellion(ctx)
    }
    pub fn vote_rebellion(ctx: Context<RebellionVote>) -> Result<()> {
        rebellion::vote_rebellion(ctx)
    }
    pub fn execute_rebellion(ctx: Context<ExecuteRebellion>) -> Result<()> {
        rebellion::execute_rebellion(ctx)
    }

    // ---- AI agents
    #[allow(clippy::too_many_arguments)]
    pub fn create_permit(
        ctx: Context<CreatePermit>,
        agent: Pubkey,
        scope: u8,
        allowed_world: Pubkey,
        max_spend_per_epoch: u64,
        max_price: u64,
        duration_slots: u64,
    ) -> Result<()> {
        agent::create_permit(ctx, agent, scope, allowed_world, max_spend_per_epoch, max_price, duration_slots)
    }
    pub fn fund_permit(ctx: Context<PermitOwnerOp>, amount: u64) -> Result<()> {
        agent::fund_permit(ctx, amount)
    }
    pub fn withdraw_permit(ctx: Context<PermitOwnerOp>, amount: u64) -> Result<()> {
        agent::withdraw_permit(ctx, amount)
    }
    pub fn revoke_permit(ctx: Context<RevokePermit>) -> Result<()> {
        agent::revoke_permit(ctx)
    }
    pub fn agent_plant(ctx: Context<AgentPlant>, pattern: u64) -> Result<()> {
        territory::agent_plant(ctx, pattern)
    }
    pub fn agent_acquire(
        ctx: Context<AgentAcquire>,
        index: u8,
        max_price: u64,
        new_price: u64,
        deposit: u64,
    ) -> Result<()> {
        territory::agent_acquire(ctx, index, max_price, new_price, deposit)
    }
}

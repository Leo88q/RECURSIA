use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::RecursiaError;
use crate::instructions::common::*;
use crate::state::*;

/// AI inhabitants. A human owner delegates a *bounded* budget to an AI
/// runner's hot key. Every limit lives on-chain (checklist #71–#75):
///
/// * the agent key can only spend from its dedicated escrow vault,
/// * only on whitelisted actions (scope bitmask) and optionally one world,
/// * with a per-epoch spend cap and a max price per acquisition,
/// * permits expire, and only the owner can withdraw or revoke.
///
/// A compromised or prompt-injected agent can at worst burn its own budget
/// on legitimate game actions for the owner's benefit — never exfiltrate it.
#[derive(Accounts)]
#[instruction(agent: Pubkey)]
pub struct CreatePermit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init, payer = owner, space = 8 + AgentPermit::INIT_SPACE,
        seeds = [SEED_PERMIT, owner.key().as_ref(), agent.as_ref()], bump
    )]
    pub permit: Box<Account<'info, AgentPermit>>,
    #[account(
        init, payer = owner, seeds = [SEED_PERMIT_VAULT, permit.key().as_ref()], bump,
        token::mint = mint, token::authority = config
    )]
    pub permit_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

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
    require_top_level()?;
    require_active(&ctx.accounts.config)?;
    require!(agent != Pubkey::default() && agent != ctx.accounts.owner.key(), RecursiaError::Unauthorized);
    require!(scope != 0 && scope & !PERMIT_ALL == 0, RecursiaError::PermitScope);
    require!(duration_slots > 0 && duration_slots <= MAX_PERMIT_SLOTS, RecursiaError::InvalidParams);
    require!(max_price <= MAX_PRICE && max_spend_per_epoch <= MAX_PRICE, RecursiaError::InvalidParams);
    let slot = Clock::get()?.slot;
    let p = &mut ctx.accounts.permit;
    p.version = ACCOUNT_VERSION;
    p.bump = ctx.bumps.permit;
    p.vault_bump = ctx.bumps.permit_vault;
    p.owner = ctx.accounts.owner.key();
    p.agent = agent;
    p.scope = scope;
    p.allowed_world = allowed_world;
    p.max_spend_per_epoch = max_spend_per_epoch;
    p.max_price = max_price;
    p.spent = 0;
    p.spend_epoch = ctx.accounts.config.cur_epoch;
    p.expiry_slot = slot.saturating_add(duration_slots);
    p.created_slot = slot;
    Ok(())
}

#[derive(Accounts)]
pub struct PermitOwnerOp<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [SEED_PERMIT, owner.key().as_ref(), permit.agent.as_ref()], bump = permit.bump, has_one = owner)]
    pub permit: Box<Account<'info, AgentPermit>>,
    #[account(mut, seeds = [SEED_PERMIT_VAULT, permit.key().as_ref()], bump = permit.vault_bump)]
    pub permit_vault: Box<Account<'info, TokenAccount>>,
    /// Funds can only ever go back to the owner's own token account.
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn fund_permit(ctx: Context<PermitOwnerOp>, amount: u64) -> Result<()> {
    require_top_level()?;
    user_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.owner_token.to_account_info(),
        &ctx.accounts.permit_vault.to_account_info(),
        &ctx.accounts.owner.to_account_info(),
        amount,
    )
}

pub fn withdraw_permit(ctx: Context<PermitOwnerOp>, amount: u64) -> Result<()> {
    require_top_level()?;
    let bump = ctx.accounts.config.bump;
    vault_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.permit_vault.to_account_info(),
        &ctx.accounts.owner_token.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        bump,
        amount,
    )
}

#[derive(Accounts)]
pub struct RevokePermit<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    /// Anchor `close` zeroes data + discriminator: no revival (checklist #34),
    /// rent goes only to the owner (checklist #28).
    #[account(
        mut, close = owner,
        seeds = [SEED_PERMIT, owner.key().as_ref(), permit.agent.as_ref()], bump = permit.bump, has_one = owner
    )]
    pub permit: Box<Account<'info, AgentPermit>>,
    #[account(mut, seeds = [SEED_PERMIT_VAULT, permit.key().as_ref()], bump = permit.vault_bump)]
    pub permit_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn revoke_permit(ctx: Context<RevokePermit>) -> Result<()> {
    let bump = ctx.accounts.config.bump;
    let tp = ctx.accounts.token_program.to_account_info();
    let cfg = ctx.accounts.config.to_account_info();
    vault_transfer(
        &tp,
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.permit_vault.to_account_info(),
        &ctx.accounts.owner_token.to_account_info(),
        &cfg,
        bump,
        ctx.accounts.permit_vault.amount,
    )?;
    let b = [bump];
    let seeds: &[&[u8]] = &[SEED_CONFIG, &b];
    token::close_account(CpiContext::new_with_signer(
        tp,
        CloseAccount {
            account: ctx.accounts.permit_vault.to_account_info(),
            destination: ctx.accounts.owner.to_account_info(),
            authority: cfg,
        },
        &[seeds],
    ))?;
    require!(ctx.accounts.permit.owner != Pubkey::default(), RecursiaError::Mismatch);
    Ok(())
}

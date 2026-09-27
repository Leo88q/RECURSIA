//! Season tournaments: an opt-in, skill-ranked prize pool.
//!
//! * One tournament per (season, tier). Entry fee = `plant_cost × TOURNAMENT_TIERS[tier]`.
//!   10% rake → studio treasury (25% of which is swept into season prizes by
//!   `advance_epoch`), 90% → the tournament pool.
//! * Joining is open only during the first `TOURNAMENT_JOIN_EPOCHS` epoch(s)
//!   of the season, max `TOURNAMENT_MAX_PLAYERS` entrants, one entry per wallet
//!   (entry PDA `init`).
//! * Score = the player's season points (SKR collected from life, counted by
//!   the program). `tournament_submit` (permissionless) keeps the top list.
//! * After the season closes, `tournament_settle` fixes prizes for the top
//!   30% of entrants (linear weights); places without a positive score are
//!   not paid and their share returns to the reward pool. Sybil entries only
//!   add fees to the pot: each wallet pays the fee, the score is real play.
//! * `claim_tournament_prize` (permissionless) credits the winner's balance.
//! * Rent comes back: `close_tournament_entry` (owner, once settled — the entry
//!   is never read again and an old season can't be re-joined, so there is no
//!   revival) and `close_tournament` (anyone, once every prize is paid; the
//!   rent goes to the recorded `payer`, the first entrant).
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::RecursiaError;
use crate::events::*;
use crate::instructions::common::*;
use crate::instructions::season::leaderboard_insert;
use crate::math;
use crate::state::*;

#[derive(Accounts)]
#[instruction(season_id: u64, tier: u8)]
pub struct TournamentJoin<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(
        init_if_needed, payer = owner, space = 8 + Tournament::INIT_SPACE,
        seeds = [SEED_TOURNAMENT, &season_id.to_le_bytes(), &[tier]], bump
    )]
    pub tournament: Box<Account<'info, Tournament>>,
    #[account(
        init, payer = owner, space = 8 + TournamentEntry::INIT_SPACE,
        seeds = [SEED_TOURNAMENT_ENTRY, tournament.key().as_ref(), owner.key().as_ref()], bump
    )]
    pub entry: Box<Account<'info, TournamentEntry>>,
    #[account(
        init_if_needed, payer = owner, seeds = [SEED_TOURNAMENT_POOL], bump,
        token::mint = mint, token::authority = config, token::token_program = token_program
    )]
    pub tournament_pool: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = mint, token::authority = owner)]
    pub owner_token: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_TREASURY], bump = config.treasury_bump)]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn tournament_join(ctx: Context<TournamentJoin>, season_id: u64, tier: u8) -> Result<()> {
    let c = &ctx.accounts.config;
    require_active(c)?;
    require!((tier as usize) < TOURNAMENT_TIERS.len(), RecursiaError::BadTier);
    require!(
        season_id == c.season_id
            && c.cur_epoch < c.season_start_epoch.saturating_add(TOURNAMENT_JOIN_EPOCHS),
        RecursiaError::TournamentClosed
    );
    let t = &mut ctx.accounts.tournament;
    if t.version == 0 {
        t.version = 1;
        t.bump = ctx.bumps.tournament;
        t.season_id = season_id;
        t.tier = tier;
        t.payer = ctx.accounts.owner.key();
        t.entry_fee = c
            .params
            .plant_cost
            .checked_mul(TOURNAMENT_TIERS[tier as usize])
            .ok_or(RecursiaError::MathOverflow)?;
    }
    require!(t.players < TOURNAMENT_MAX_PLAYERS, RecursiaError::TournamentFull);
    let fee = t.entry_fee;
    let rake = math::bps_floor(fee, TOURNAMENT_RAKE_BPS)?;
    let pot = math::sub(fee, rake)?;
    // effects before interactions (#7)
    t.players += 1;
    t.pot = math::add(t.pot, pot)?;
    let e = &mut ctx.accounts.entry;
    e.version = 1;
    e.bump = ctx.bumps.entry;
    e.tournament = t.key();
    e.owner = ctx.accounts.owner.key();
    let tp = ctx.accounts.token_program.to_account_info();
    let mint = ctx.accounts.mint.to_account_info();
    let from = ctx.accounts.owner_token.to_account_info();
    let auth = ctx.accounts.owner.to_account_info();
    user_transfer(&tp, &mint, &from, &ctx.accounts.treasury.to_account_info(), &auth, rake)?;
    user_transfer(&tp, &mint, &from, &ctx.accounts.tournament_pool.to_account_info(), &auth, pot)?;
    emit!(TournamentJoined {
        tournament: ctx.accounts.tournament.key(),
        season: season_id,
        tier,
        player: ctx.accounts.owner.key(),
        fee,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(season_id: u64, tier: u8)]
pub struct TournamentSubmit<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_TOURNAMENT, &season_id.to_le_bytes(), &[tier]], bump = tournament.bump)]
    pub tournament: Box<Account<'info, Tournament>>,
    /// Entry of the player (owner + discriminator checked by Anchor; the
    /// program only creates entries at [SEED_TOURNAMENT_ENTRY, tournament, owner]).
    #[account(constraint = entry.tournament == tournament.key() @ RecursiaError::Mismatch)]
    pub entry: Box<Account<'info, TournamentEntry>>,
    #[account(constraint = player.owner == entry.owner @ RecursiaError::Mismatch)]
    pub player: Box<Account<'info, Player>>,
}

/// Permissionless: put an entrant's current season points on the standings.
pub fn tournament_submit(ctx: Context<TournamentSubmit>, _season_id: u64, _tier: u8) -> Result<()> {
    let c = &ctx.accounts.config;
    let t = &mut ctx.accounts.tournament;
    require!(t.season_id == c.season_id, RecursiaError::TournamentClosed);
    let p = &ctx.accounts.player;
    require!(p.season_id == t.season_id && p.season_points > 0, RecursiaError::NoSeasonPoints);
    leaderboard_insert(&mut t.top, SeasonEntry { player: p.owner, points: p.season_points });
    Ok(())
}

#[derive(Accounts)]
#[instruction(season_id: u64, tier: u8)]
pub struct TournamentSettle<'info> {
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [SEED_TOURNAMENT, &season_id.to_le_bytes(), &[tier]], bump = tournament.bump)]
    pub tournament: Box<Account<'info, Tournament>>,
    #[account(mut, seeds = [SEED_TOURNAMENT_POOL], bump)]
    pub tournament_pool: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_REWARD_POOL], bump = config.reward_pool_bump)]
    pub reward_pool: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Permissionless, after the season closed: fix the prizes. Allowed while
/// paused (settlement must never get stuck).
pub fn tournament_settle(ctx: Context<TournamentSettle>, _season_id: u64, _tier: u8) -> Result<()> {
    let t = &mut ctx.accounts.tournament;
    require!(ctx.accounts.config.season_id > t.season_id, RecursiaError::TournamentRunning);
    require!(!t.settled, RecursiaError::TournamentClosed);
    let filled = t.top.iter().filter(|e| e.player != Pubkey::default() && e.points > 0).count();
    let k = math::tournament_places(t.players).min(filled);
    let (prizes, rest) = math::tournament_prizes(t.pot, k)?;
    t.prizes = prizes;
    t.settled = true;
    t.pot = math::sub(t.pot, rest)?;
    let pot = t.pot;
    // the unplayed part is a pool inflow like any other (keeps the ledger
    // reward_pool == funded + total_sunk − total_emitted exact)
    record_pool_inflow(&mut ctx.accounts.config, rest)?;
    let bump = ctx.accounts.config.bump;
    vault_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.tournament_pool.to_account_info(),
        &ctx.accounts.reward_pool.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        bump,
        rest,
    )?;
    emit!(TournamentSettled { tournament: ctx.accounts.tournament.key(), winners: k as u8, pot, returned: rest });
    Ok(())
}

#[derive(Accounts)]
#[instruction(season_id: u64, tier: u8)]
pub struct ClaimTournamentPrize<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump, has_one = mint)]
    pub config: Box<Account<'info, Config>>,
    pub mint: Box<Account<'info, Mint>>,
    #[account(mut, seeds = [SEED_TOURNAMENT, &season_id.to_le_bytes(), &[tier]], bump = tournament.bump)]
    pub tournament: Box<Account<'info, Tournament>>,
    /// The winner's player account (checked against the standings below).
    #[account(mut)]
    pub player: Box<Account<'info, Player>>,
    #[account(mut, seeds = [SEED_TOURNAMENT_POOL], bump)]
    pub tournament_pool: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_CLAIMS], bump = config.claims_bump)]
    pub claims_vault: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

/// Permissionless: the prize can only ever go to the winner's own balance.
pub fn claim_tournament_prize(ctx: Context<ClaimTournamentPrize>, _season_id: u64, _tier: u8, rank: u8) -> Result<()> {
    let r = rank as usize;
    require!(r < TOURNAMENT_TOP, RecursiaError::NoPrize);
    let t = &mut ctx.accounts.tournament;
    require!(t.settled, RecursiaError::TournamentRunning);
    let e = t.top[r];
    require!(
        e.player != Pubkey::default() && e.player == ctx.accounts.player.owner,
        RecursiaError::NoPrize
    );
    require!(t.claimed & (1u16 << r) == 0, RecursiaError::NoPrize);
    let amount = t.prizes[r];
    require!(amount > 0, RecursiaError::NoPrize);
    t.claimed |= 1u16 << r;
    t.pot = math::sub(t.pot, amount)?;
    let pl = &mut ctx.accounts.player;
    pl.claimable = math::add(pl.claimable, amount)?;
    pl.total_earned = math::add(pl.total_earned, amount)?;
    let bump = ctx.accounts.config.bump;
    vault_transfer(
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.mint.to_account_info(),
        &ctx.accounts.tournament_pool.to_account_info(),
        &ctx.accounts.claims_vault.to_account_info(),
        &ctx.accounts.config.to_account_info(),
        bump,
        amount,
    )?;
    emit!(TournamentPrizePaid { tournament: ctx.accounts.tournament.key(), rank, player: e.player, amount });
    Ok(())
}

#[derive(Accounts)]
#[instruction(season_id: u64, tier: u8)]
pub struct CloseTournamentEntry<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: the tournament PDA (address fixed by the seeds). Either still
    /// open — then it must be a settled `Tournament` owned by this program —
    /// or already closed (only `close_tournament` can close it, after settlement).
    #[account(seeds = [SEED_TOURNAMENT, &season_id.to_le_bytes(), &[tier]], bump)]
    pub tournament: UncheckedAccount<'info>,
    #[account(
        mut, close = owner, has_one = owner,
        seeds = [SEED_TOURNAMENT_ENTRY, tournament.key().as_ref(), owner.key().as_ref()], bump = entry.bump,
        constraint = entry.tournament == tournament.key() @ RecursiaError::Mismatch
    )]
    pub entry: Box<Account<'info, TournamentEntry>>,
}

/// Owner reclaims the entry's rent once the tournament is settled.
/// Allowed while paused (it only returns the owner's own SOL).
pub fn close_tournament_entry(ctx: Context<CloseTournamentEntry>, _season_id: u64, _tier: u8) -> Result<()> {
    let ti = ctx.accounts.tournament.to_account_info();
    if *ti.owner != anchor_lang::system_program::ID {
        require_keys_eq!(*ti.owner, crate::ID, RecursiaError::Mismatch);
        let data = ti.try_borrow_data()?;
        let t = Tournament::try_deserialize(&mut &data[..])?;
        require!(t.settled, RecursiaError::TournamentRunning);
    }
    emit!(TournamentRentReturned { account: ctx.accounts.entry.key(), to: ctx.accounts.owner.key() });
    Ok(())
}

#[derive(Accounts)]
#[instruction(season_id: u64, tier: u8)]
pub struct CloseTournament<'info> {
    #[account(
        mut, close = payer, has_one = payer,
        seeds = [SEED_TOURNAMENT, &season_id.to_le_bytes(), &[tier]], bump = tournament.bump
    )]
    pub tournament: Box<Account<'info, Tournament>>,
    /// CHECK: receives the rent; must be the recorded payer (`has_one`).
    #[account(mut)]
    pub payer: UncheckedAccount<'info>,
}

/// Permissionless cleanup once the tournament is settled and every prize is
/// paid (pot == 0): the rent goes back to whoever paid it. Unclaimed prizes
/// block it, but claiming is permissionless too — prizes only ever go to the
/// winners' own balances.
pub fn close_tournament(ctx: Context<CloseTournament>, _season_id: u64, _tier: u8) -> Result<()> {
    let t = &ctx.accounts.tournament;
    require!(t.settled, RecursiaError::TournamentRunning);
    require!(t.pot == 0, RecursiaError::PrizesUnclaimed);
    emit!(TournamentRentReturned { account: t.key(), to: t.payer });
    Ok(())
}

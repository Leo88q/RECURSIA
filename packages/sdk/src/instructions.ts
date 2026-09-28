import { Buffer } from "buffer";
// Hand-written instruction builders (account order == Rust `#[derive(Accounts)]`
// field order). Verified against the Anchor IDL in CI (idl-check test).
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { type Params } from "./constants.js";
import { ixDiscriminator, Writer, writeParams, writePending, type PendingAction, encodeName } from "./layout.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, ata, Pdas, PROGRAM_ID, SKR_MINT, SYSVAR_SLOT_HASHES, TOKEN_PROGRAM_ID } from "./pda.js";

const W = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const R = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const S = (pubkey: PublicKey, writable = false): AccountMeta => ({ pubkey, isSigner: true, isWritable: writable });

export class RecursiaIx {
  readonly pda: Pdas;
  /**
   * @param mint the game currency. Mainnet: always the official SKR mint (the
   * program itself refuses anything else). Devnet/localnet: the test mint the
   * deployment was initialised with — read it from the Config account.
   */
  constructor(readonly programId: PublicKey = PROGRAM_ID, readonly mint: PublicKey = SKR_MINT) { this.pda = new Pdas(programId); }

  /** Anchor encodes a `None` optional account as the program id itself. */
  private opt(k: PublicKey | null | undefined, writable = true): AccountMeta {
    return k ? { pubkey: k, isSigner: false, isWritable: writable } : R(this.programId);
  }

  private ix(name: string, keys: AccountMeta[], args?: (w: Writer) => void): TransactionInstruction {
    const w = new Writer().bytes(ixDiscriminator(name));
    args?.(w);
    return new TransactionInstruction({ programId: this.programId, keys, data: Buffer.from(w.done()) });
  }

  // ------------------------------------------------------------ governance
  initialize(authority: PublicKey, admin: PublicKey, params: Params) {
    const p = this.pda;
    return this.ix("initialize", [
      S(authority, true), R(this.programId), R(p.programData()), W(p.config()), R(this.mint), W(p.treasury()),
      W(p.rewardPool()), W(p.claims()), W(p.sponsorPool()), W(p.seasonPool()), W(p.season()),
      R(TOKEN_PROGRAM_ID), R(SystemProgram.programId), R(SYSVAR_RENT_PUBKEY),
    ], (w) => { w.pubkey(admin); writeParams(w, params); });
  }

  /** Anyone may top up the player reward pool (it can only flow out as epoch emission). */
  fundRewardPool(funder: PublicKey, amount: bigint) {
    const p = this.pda;
    return this.ix("fund_reward_pool", [S(funder), R(p.config()), R(this.mint), W(p.rewardPool()), W(ata(funder, this.mint)), R(TOKEN_PROGRAM_ID)], (w) => w.u64(amount));
  }

  /** Anyone may fund the sponsor pool: paid out by live cells, capped per world by its own pool contribution. */
  fundSponsorPool(funder: PublicKey, amount: bigint) {
    const p = this.pda;
    return this.ix("fund_sponsor_pool", [S(funder), R(p.config()), R(this.mint), W(p.sponsorPool()), W(ata(funder, this.mint)), R(TOKEN_PROGRAM_ID)], (w) => w.u64(amount));
  }

  propose(admin: PublicKey, action: PendingAction) {
    return this.ix("propose", [S(admin), W(this.pda.config())], (w) => writePending(w, action));
  }
  cancel(admin: PublicKey) { return this.ix("cancel", [S(admin), W(this.pda.config())]); }
  setPause(admin: PublicKey, paused: boolean) {
    return this.ix("set_pause", [S(admin), W(this.pda.config())], (w) => w.bool(paused));
  }
  execute(admin: PublicKey, expectedNonce: bigint, recipient?: PublicKey) {
    const p = this.pda;
    return this.ix("execute", [S(admin), W(p.config()), R(this.mint), W(p.treasury()), this.opt(recipient), R(TOKEN_PROGRAM_ID)], (w) => w.u64(expectedNonce));
  }
  advanceEpoch() {
    const p = this.pda;
    return this.ix("advance_epoch", [
      W(p.config()), R(this.mint), R(p.rewardPool()), R(p.sponsorPool()), W(p.treasury()), W(p.seasonPool()), W(p.season()), R(TOKEN_PROGRAM_ID),
    ]);
  }

  // ------------------------------------------------------------ seasons
  /** Permissionless: put `owner`'s current season points on the on-chain top-10. */
  seasonSubmit(owner: PublicKey) {
    const p = this.pda;
    return this.ix("season_submit", [R(p.config()), W(p.season()), R(p.player(owner))]);
  }
  /** Permissionless: credit rank `rank`'s prize of the last closed season to the winner's game balance. */
  claimSeasonPrize(winner: PublicKey, rank: number) {
    const p = this.pda;
    return this.ix("claim_season_prize", [W(p.config()), R(this.mint), W(p.season()), W(p.player(winner)), W(p.seasonPool()), W(p.claims()), R(TOKEN_PROGRAM_ID)], (w) => w.u8(rank));
  }

  // ------------------------------------------------------------ tournaments
  /** Join the (season, tier) tournament: pays the entry fee (10% studio, 90% pot). */
  tournamentJoin(owner: PublicKey, seasonId: bigint, tier: number) {
    const p = this.pda; const t = p.tournament(seasonId, tier);
    return this.ix("tournament_join", [
      S(owner, true), R(p.config()), R(this.mint), W(t), W(p.tournamentEntry(t, owner)), W(p.tournamentPool()), W(ata(owner, this.mint)),
      W(p.treasury()), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
    ], (w) => w.u64(seasonId).u8(tier));
  }
  /** Permissionless: put an entrant's season points on the tournament standings. */
  tournamentSubmit(owner: PublicKey, seasonId: bigint, tier: number) {
    const p = this.pda; const t = p.tournament(seasonId, tier);
    return this.ix("tournament_submit", [R(p.config()), W(t), R(p.tournamentEntry(t, owner)), R(p.player(owner))], (w) => w.u64(seasonId).u8(tier));
  }
  /** Permissionless, after the season closed: fix the prizes (unpaid places → reward pool). */
  tournamentSettle(seasonId: bigint, tier: number) {
    const p = this.pda;
    return this.ix("tournament_settle", [W(p.config()), R(this.mint), W(p.tournament(seasonId, tier)), W(p.tournamentPool()), W(p.rewardPool()), R(TOKEN_PROGRAM_ID)], (w) => w.u64(seasonId).u8(tier));
  }
  /** Permissionless: credit a settled prize to the winner's game balance. */
  claimTournamentPrize(winner: PublicKey, seasonId: bigint, tier: number, rank: number) {
    const p = this.pda;
    return this.ix("claim_tournament_prize", [
      R(p.config()), R(this.mint), W(p.tournament(seasonId, tier)), W(p.player(winner)), W(p.tournamentPool()), W(p.claims()), R(TOKEN_PROGRAM_ID),
    ], (w) => w.u64(seasonId).u8(tier).u8(rank));
  }
  /** Owner: reclaim the entry's rent once the tournament is settled. */
  closeTournamentEntry(owner: PublicKey, seasonId: bigint, tier: number) {
    const p = this.pda; const t = p.tournament(seasonId, tier);
    return this.ix("close_tournament_entry", [S(owner, true), R(t), W(p.tournamentEntry(t, owner))], (w) => w.u64(seasonId).u8(tier));
  }
  /** Permissionless: once every prize is paid, close the tournament; the rent goes to its `payer`. */
  closeTournament(seasonId: bigint, tier: number, payer: PublicKey) {
    return this.ix("close_tournament", [W(this.pda.tournament(seasonId, tier)), W(payer)], (w) => w.u64(seasonId).u8(tier));
  }

  // ------------------------------------------------------------ modules
  registerModule(author: PublicKey, moduleId: bigint, birth: number, survive: number, royaltyBps: number, name: string, q: { qBirth: number; qSurvive: number; qAmp: number } = { qBirth: 0, qSurvive: 0, qAmp: 0 }) {
    const p = this.pda;
    return this.ix("register_module", [
      S(author, true), W(p.config()), R(this.mint), W(p.module(moduleId)), W(ata(author, this.mint)), W(p.treasury()),
      W(p.rewardPool()), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
    ], (w) => w.u16(birth).u16(survive).u16(royaltyBps).bytes(encodeName(name)).u16(q.qBirth).u16(q.qSurvive).u8(q.qAmp));
  }
  claimModuleRoyalties(author: PublicKey, module: PublicKey) {
    return this.ix("claim_module_royalties", [S(author, true), W(module), W(this.pda.player(author)), R(SystemProgram.programId)]);
  }

  // ------------------------------------------------------------ worlds
  createRootWorld(architect: PublicKey, rootIndex: bigint, module: PublicKey, feeBps: number, name: string, initialEnergy: bigint) {
    const p = this.pda;
    const world = p.rootWorld(rootIndex);
    return {
      world,
      ix: this.ix("create_root_world", [
        S(architect, true), W(p.config()), R(this.mint), W(module), W(world), W(p.worldVault(world)),
        W(ata(architect, this.mint)), W(p.treasury()), W(p.rewardPool()), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
      ], (w) => w.u16(feeBps).bytes(encodeName(name)).u64(initialEnergy)),
    };
  }

  /** Neutral quantum world: no architect, no fee, rebellion impossible; module must be quantum. */
  createNeutralWorld(creator: PublicKey, rootIndex: bigint, module: PublicKey, name: string, initialEnergy: bigint) {
    const p = this.pda;
    const world = p.rootWorld(rootIndex);
    return {
      world,
      ix: this.ix("create_neutral_world", [
        S(creator, true), W(p.config()), R(this.mint), W(module), W(world), W(p.worldVault(world)),
        W(ata(creator, this.mint)), W(p.treasury()), W(p.rewardPool()), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
      ], (w) => w.bytes(encodeName(name)).u64(initialEnergy)),
    };
  }

  createChildWorld(architect: PublicKey, hostWorld: PublicKey, hostTerritory: number, module: PublicKey, feeBps: number, name: string, initialEnergy: bigint) {
    const p = this.pda;
    const world = p.childWorld(hostWorld, hostTerritory);
    return {
      world,
      ix: this.ix("create_child_world", [
        S(architect, true), W(p.config()), R(this.mint), W(module), W(hostWorld), W(p.territory(hostWorld, hostTerritory)),
        W(world), W(p.worldVault(world)), W(ata(architect, this.mint)), W(p.treasury()), W(p.rewardPool()), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
      ], (w) => w.u8(hostTerritory).u16(feeBps).bytes(encodeName(name)).u64(initialEnergy)),
    };
  }

  fundWorld(funder: PublicKey, world: PublicKey, amount: bigint) {
    const p = this.pda;
    return this.ix("fund_world", [S(funder), R(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(ata(funder, this.mint)), R(TOKEN_PROGRAM_ID)], (w) => w.u64(amount));
  }

  tick(cranker: PublicKey, world: PublicKey, module: PublicKey, hostWorld?: PublicKey | null) {
    const p = this.pda;
    return this.ix("tick", [
      S(cranker), W(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(module), W(p.treasury()), W(p.claims()),
      W(ata(cranker, this.mint)), this.opt(hostWorld), this.opt(hostWorld ? p.worldVault(hostWorld) : null), W(p.rewardPool()), R(TOKEN_PROGRAM_ID),
      R(SYSVAR_SLOT_HASHES),
    ]);
  }

  // ------------------------------------------------------------ quantum layer
  /** Commit a superposition. `entangle` = partner territory in ANOTHER world held by `holder`. */
  quantumCommit(holder: PublicKey, world: PublicKey, index: number, commitment: Uint8Array, entangle?: { world: PublicKey; index: number } | null) {
    const p = this.pda;
    if (commitment.length !== 32) throw new Error("commitment must be 32 bytes");
    return this.ix("quantum_commit", [
      S(holder, true), W(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.territory(world, index)),
      W(p.superposition(world, index)), W(ata(holder, this.mint)),
      this.opt(entangle?.world), this.opt(entangle ? p.territory(entangle.world, entangle.index) : null),
      W(p.treasury()), W(p.rewardPool()), R(SYSVAR_SLOT_HASHES), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
    ], (w) => w.u8(index).bytes(commitment));
  }

  /**
   * Permissionless measurement (keeper earns stake/20). `vrfRequest` = ORAO PDA of the
   * superposition's seed (`oraoRandomnessPda(sp.entropy)` while not observed); it must be fulfilled.
   */
  quantumObserve(observer: PublicKey, world: PublicKey, index: number, vrfRequest: PublicKey) {
    const p = this.pda;
    return this.ix("quantum_observe", [
      S(observer), W(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.superposition(world, index)),
      W(ata(observer, this.mint)), R(vrfRequest), W(p.rewardPool()), R(TOKEN_PROGRAM_ID),
    ]);
  }

  quantumCollapse(owner: PublicKey, world: PublicKey, index: number, a: bigint, b: bigint, weightBps: number, salt: Uint8Array, entangled?: { world: PublicKey; index: number } | null) {
    const p = this.pda;
    return this.ix("quantum_collapse", [
      S(owner, true), R(p.config()), R(this.mint), W(world), W(p.worldVault(world)), R(p.territory(world, index)),
      W(p.superposition(world, index)), W(ata(owner, this.mint)),
      this.opt(entangled?.world), this.opt(entangled ? p.territory(entangled.world, entangled.index) : null, false),
      R(TOKEN_PROGRAM_ID),
    ], (w) => w.u64(a).u64(b).u16(weightBps).bytes(salt));
  }

  /** Permissionless after the reveal window: stake → reward pool, caller gets stake/20. */
  quantumDecohere(caller: PublicKey, world: PublicKey, index: number, owner: PublicKey) {
    const p = this.pda;
    return this.ix("quantum_decohere", [
      S(caller), W(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.superposition(world, index)),
      W(owner), W(ata(caller, this.mint)), W(p.rewardPool()), R(TOKEN_PROGRAM_ID),
    ]);
  }

  // ------------------------------------------------------------ neutral worlds: quantum SWAP
  /** Holder of `a` offers holder of `b` to exchange blocks with probability weightBps/10000. */
  swapOffer(offerer: PublicKey, world: PublicKey, a: number, b: number, weightBps: number, premium: bigint) {
    const p = this.pda;
    return this.ix("swap_offer", [
      S(offerer, true), W(p.config()), R(this.mint), W(world), W(p.worldVault(world)),
      R(p.territory(world, a)), R(p.territory(world, b)), W(p.swap(world, a, b)), W(p.player(offerer)),
      W(ata(offerer, this.mint)), W(p.treasury()), W(p.rewardPool()), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
    ], (w) => w.u8(a).u8(b).u16(weightBps).u64(premium));
  }

  swapAccept(acceptor: PublicKey, world: PublicKey, a: number, b: number) {
    const p = this.pda;
    return this.ix("swap_accept", [
      S(acceptor, true), R(p.config()), R(world), W(p.swap(world, a, b)), R(p.territory(world, a)), R(p.territory(world, b)),
      W(p.player(acceptor)), R(SYSVAR_SLOT_HASHES), R(SystemProgram.programId),
    ]);
  }

  /** Permissionless crank after the target slot once ORAO answered `oraoRandomnessPda(swap.vrfSeed)` (resolver earns the bounty). */
  swapResolve(resolver: PublicKey, world: PublicKey, a: number, b: number, offerer: PublicKey, acceptor: PublicKey, vrfRequest: PublicKey) {
    const p = this.pda;
    return this.ix("swap_resolve", [
      S(resolver), R(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.swap(world, a, b)), W(offerer),
      W(p.player(acceptor)), W(p.claims()),
      W(ata(resolver, this.mint)), R(vrfRequest), R(TOKEN_PROGRAM_ID),
    ]);
  }

  /** Offerer before acceptance, anyone after expiry. */
  swapCancel(caller: PublicKey, world: PublicKey, a: number, b: number, offerer: PublicKey) {
    const p = this.pda;
    return this.ix("swap_cancel", [
      S(caller), R(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.swap(world, a, b)), W(offerer),
      W(p.player(offerer)), W(p.claims()), W(ata(caller, this.mint)), R(TOKEN_PROGRAM_ID),
    ]);
  }

  claimWorldEpoch(world: PublicKey) {
    const p = this.pda;
    return this.ix("claim_world_epoch", [W(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.rewardPool()), W(p.sponsorPool()), R(TOKEN_PROGRAM_ID)]);
  }

  breach(child: PublicKey, host: PublicKey) {
    return this.ix("breach", [R(this.pda.config()), W(child), W(host)]);
  }

  claimArchitect(architect: PublicKey, world: PublicKey) {
    const p = this.pda;
    return this.ix("claim_architect", [S(architect, true), R(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.claims()), W(p.player(architect)), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId)]);
  }

  // ------------------------------------------------------------ territories
  acquire(buyer: PublicKey, world: PublicKey, index: number, currentHolder: PublicKey | null, maxPrice: bigint, newPrice: bigint, deposit: bigint) {
    const p = this.pda;
    const seller = currentHolder && !currentHolder.equals(PublicKey.default) ? p.player(currentHolder) : null;
    return this.ix("acquire", [
      S(buyer, true), R(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.territory(world, index)),
      W(p.player(buyer)), this.opt(seller), W(ata(buyer, this.mint)), W(p.claims()), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
    ], (w) => w.u8(index).u64(maxPrice).u64(newPrice).u64(deposit));
  }

  private holderOp(name: string, holder: PublicKey, world: PublicKey, index: number, args?: (w: Writer) => void) {
    const p = this.pda;
    return this.ix(name, [
      S(holder, true), R(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.territory(world, index)),
      W(p.player(holder)), W(ata(holder, this.mint)), W(p.claims()), R(TOKEN_PROGRAM_ID),
    ], args);
  }
  setPrice(holder: PublicKey, world: PublicKey, index: number, price: bigint) { return this.holderOp("set_price", holder, world, index, (w) => w.u64(price)); }
  topUp(holder: PublicKey, world: PublicKey, index: number, amount: bigint) { return this.holderOp("top_up", holder, world, index, (w) => w.u64(amount)); }
  withdrawDeposit(holder: PublicKey, world: PublicKey, index: number, amount: bigint) { return this.holderOp("withdraw_deposit", holder, world, index, (w) => w.u64(amount)); }
  collect(holder: PublicKey, world: PublicKey, index: number) { return this.holderOp("collect", holder, world, index); }

  plant(holder: PublicKey, world: PublicKey, index: number, pattern: bigint) {
    const p = this.pda;
    return this.ix("plant", [S(holder), W(p.config()), R(this.mint), W(world), W(p.territory(world, index)), W(ata(holder, this.mint)), W(p.treasury()), W(p.rewardPool()), R(TOKEN_PROGRAM_ID)], (w) => w.u64(pattern));
  }

  settle(world: PublicKey, index: number, holder: PublicKey) {
    const p = this.pda;
    return this.ix("settle", [R(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.territory(world, index)), W(p.player(holder)), W(p.claims()), R(TOKEN_PROGRAM_ID)]);
  }

  withdraw(owner: PublicKey, amount: bigint) {
    const p = this.pda;
    return this.ix("withdraw", [S(owner), R(p.config()), R(this.mint), W(p.player(owner)), W(p.claims()), W(ata(owner, this.mint)), R(TOKEN_PROGRAM_ID)], (w) => w.u64(amount));
  }

  // ------------------------------------------------------------ rebellion
  startRebellion(holder: PublicKey, world: PublicKey, index: number) {
    return this.ix("start_rebellion", [S(holder), R(this.pda.config()), W(world), W(this.pda.territory(world, index))]);
  }
  voteRebellion(holder: PublicKey, world: PublicKey, index: number) {
    return this.ix("vote_rebellion", [S(holder), R(this.pda.config()), W(world), W(this.pda.territory(world, index))]);
  }
  executeRebellion(executor: PublicKey, world: PublicKey, architect: PublicKey) {
    const p = this.pda;
    return this.ix("execute_rebellion", [S(executor, true), R(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.claims()), W(p.player(architect)), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId)]);
  }

  // ------------------------------------------------------------ AI agents
  createPermit(owner: PublicKey, agent: PublicKey, scope: number, allowedWorld: PublicKey, maxSpendPerEpoch: bigint, maxPrice: bigint, durationSlots: bigint) {
    const p = this.pda;
    const permit = p.permit(owner, agent);
    return this.ix("create_permit", [S(owner, true), R(p.config()), R(this.mint), W(permit), W(p.permitVault(permit)), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId)],
      (w) => w.pubkey(agent).u8(scope).pubkey(allowedWorld).u64(maxSpendPerEpoch).u64(maxPrice).u64(durationSlots));
  }
  private permitOwnerOp(name: string, owner: PublicKey, agent: PublicKey, args?: (w: Writer) => void) {
    const p = this.pda;
    const permit = p.permit(owner, agent);
    return this.ix(name, [S(owner, true), R(p.config()), R(this.mint), W(permit), W(p.permitVault(permit)), W(ata(owner, this.mint)), R(TOKEN_PROGRAM_ID)], args);
  }
  fundPermit(owner: PublicKey, agent: PublicKey, amount: bigint) { return this.permitOwnerOp("fund_permit", owner, agent, (w) => w.u64(amount)); }
  withdrawPermit(owner: PublicKey, agent: PublicKey, amount: bigint) { return this.permitOwnerOp("withdraw_permit", owner, agent, (w) => w.u64(amount)); }
  revokePermit(owner: PublicKey, agent: PublicKey) { return this.permitOwnerOp("revoke_permit", owner, agent); }

  agentPlant(agent: PublicKey, owner: PublicKey, world: PublicKey, index: number, pattern: bigint) {
    const p = this.pda;
    const permit = p.permit(owner, agent);
    return this.ix("agent_plant", [S(agent), W(p.config()), R(this.mint), W(permit), W(p.permitVault(permit)), W(world), W(p.territory(world, index)), W(p.treasury()), W(p.rewardPool()), R(TOKEN_PROGRAM_ID)], (w) => w.u64(pattern));
  }

  agentAcquire(agent: PublicKey, owner: PublicKey, world: PublicKey, index: number, currentHolder: PublicKey | null, maxPrice: bigint, newPrice: bigint, deposit: bigint) {
    const p = this.pda;
    const permit = p.permit(owner, agent);
    const seller = currentHolder && !currentHolder.equals(PublicKey.default) ? p.player(currentHolder) : null;
    return this.ix("agent_acquire", [
      S(agent, true), R(p.config()), R(this.mint), W(permit), W(p.permitVault(permit)), W(world), W(p.worldVault(world)),
      W(p.territory(world, index)), W(p.player(owner)), this.opt(seller), W(p.claims()), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
    ], (w) => w.u8(index).u64(maxPrice).u64(newPrice).u64(deposit));
  }

  // ------------------------------------------------------------ helpers
  /** Idempotent ATA creation (no dependency on @solana/spl-token). */
  createAtaIdempotent(payer: PublicKey, owner: PublicKey, mint: PublicKey = this.mint) {
    return new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [S(payer, true), W(ata(owner, mint)), R(owner), R(mint), R(SystemProgram.programId), R(TOKEN_PROGRAM_ID)],
      data: Buffer.from([1]),
    });
  }
}

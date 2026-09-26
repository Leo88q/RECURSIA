// Hand-written instruction builders (account order == Rust `#[derive(Accounts)]`
// field order). Verified against the Anchor IDL in CI (idl-check test).
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, TransactionInstruction, type AccountMeta } from "@solana/web3.js";
import { type Params } from "./constants.js";
import { ixDiscriminator, Writer, writeParams, writePending, type PendingAction, encodeName } from "./layout.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, ata, Pdas, PROGRAM_ID, TOKEN_PROGRAM_ID } from "./pda.js";

const W = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: true });
const R = (pubkey: PublicKey): AccountMeta => ({ pubkey, isSigner: false, isWritable: false });
const S = (pubkey: PublicKey, writable = false): AccountMeta => ({ pubkey, isSigner: true, isWritable: writable });

export class RecursiaIx {
  readonly pda: Pdas;
  constructor(readonly programId: PublicKey = PROGRAM_ID) { this.pda = new Pdas(programId); }

  /** Anchor encodes a `None` optional account as the program id itself. */
  private opt(k: PublicKey | null | undefined, writable = true): AccountMeta {
    return k ? { pubkey: k, isSigner: false, isWritable: writable } : R(this.programId);
  }

  private ix(name: string, keys: AccountMeta[], args?: (w: Writer) => void): TransactionInstruction {
    const w = new Writer().bytes(ixDiscriminator(name));
    args?.(w);
    return new TransactionInstruction({ programId: this.programId, keys, data: Buffer.from(w.done()) });
  }

  private get mint() { return this.pda.mint(); }

  // ------------------------------------------------------------ governance
  initialize(authority: PublicKey, admin: PublicKey, params: Params) {
    const p = this.pda;
    return this.ix("initialize", [
      S(authority, true), R(this.programId), R(p.programData()), W(p.config()), W(p.mint()), W(p.treasury()),
      W(p.rewardPool()), W(p.claims()), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId), R(SYSVAR_RENT_PUBKEY),
    ], (w) => { w.pubkey(admin); writeParams(w, params); });
  }

  genesis(admin: PublicKey, distribution: PublicKey) {
    const p = this.pda;
    return this.ix("genesis", [S(admin), W(p.config()), W(p.mint()), W(p.treasury()), W(p.rewardPool()), W(distribution), R(TOKEN_PROGRAM_ID)]);
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
  advanceEpoch() { return this.ix("advance_epoch", [W(this.pda.config()), R(this.pda.rewardPool())]); }

  // ------------------------------------------------------------ modules
  registerModule(author: PublicKey, moduleId: bigint, birth: number, survive: number, royaltyBps: number, name: string) {
    const p = this.pda;
    return this.ix("register_module", [
      S(author, true), W(p.config()), W(this.mint), W(p.module(moduleId)), W(ata(author, this.mint)), W(p.treasury()),
      R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
    ], (w) => w.u16(birth).u16(survive).u16(royaltyBps).bytes(encodeName(name)));
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
        S(architect, true), W(p.config()), W(this.mint), W(module), W(world), W(p.worldVault(world)),
        W(ata(architect, this.mint)), W(p.treasury()), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
      ], (w) => w.u16(feeBps).bytes(encodeName(name)).u64(initialEnergy)),
    };
  }

  createChildWorld(architect: PublicKey, hostWorld: PublicKey, hostTerritory: number, module: PublicKey, feeBps: number, name: string, initialEnergy: bigint) {
    const p = this.pda;
    const world = p.childWorld(hostWorld, hostTerritory);
    return {
      world,
      ix: this.ix("create_child_world", [
        S(architect, true), W(p.config()), W(this.mint), W(module), W(hostWorld), W(p.territory(hostWorld, hostTerritory)),
        W(world), W(p.worldVault(world)), W(ata(architect, this.mint)), W(p.treasury()), R(TOKEN_PROGRAM_ID), R(SystemProgram.programId),
      ], (w) => w.u16(feeBps).bytes(encodeName(name)).u64(initialEnergy)),
    };
  }

  fundWorld(funder: PublicKey, world: PublicKey, amount: bigint) {
    const p = this.pda;
    return this.ix("fund_world", [S(funder), R(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(ata(funder, this.mint)), R(TOKEN_PROGRAM_ID)], (w) => w.u64(amount));
  }

  tick(cranker: PublicKey, world: PublicKey, module: PublicKey, hostWorld?: PublicKey | null) {
    const p = this.pda;
    return this.ix("tick", [
      S(cranker), W(p.config()), W(this.mint), W(world), W(p.worldVault(world)), W(module), W(p.treasury()), W(p.claims()),
      W(ata(cranker, this.mint)), this.opt(hostWorld), this.opt(hostWorld ? p.worldVault(hostWorld) : null), R(TOKEN_PROGRAM_ID),
    ]);
  }

  claimWorldEpoch(world: PublicKey) {
    const p = this.pda;
    return this.ix("claim_world_epoch", [W(p.config()), R(this.mint), W(world), W(p.worldVault(world)), W(p.rewardPool()), R(TOKEN_PROGRAM_ID)]);
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
    return this.ix("plant", [S(holder), W(p.config()), W(this.mint), W(world), W(p.territory(world, index)), W(ata(holder, this.mint)), R(TOKEN_PROGRAM_ID)], (w) => w.u64(pattern));
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
    return this.ix("agent_plant", [S(agent), W(p.config()), W(this.mint), W(permit), W(p.permitVault(permit)), W(world), W(p.territory(world, index)), R(TOKEN_PROGRAM_ID)], (w) => w.u64(pattern));
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

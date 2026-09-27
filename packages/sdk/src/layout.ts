// Borsh (de)serialization for RECURSIA accounts & instruction args.
// Field order MUST match programs/recursia/src/state.rs exactly.
// Integrity: discriminators are verified on decode (type-confusion guard, #35).
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { GRID, TERRITORIES, type Params } from "./constants.js";
import { decodeName, encodeName } from "./names.js";
export { decodeName, encodeName };

export const accountDiscriminator = (name: string) => sha256(new TextEncoder().encode(`account:${name}`)).slice(0, 8);
export const ixDiscriminator = (name: string) => sha256(new TextEncoder().encode(`global:${name}`)).slice(0, 8);

export class Reader {
  off = 0;
  private dv: DataView;
  constructor(readonly buf: Uint8Array) { this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); }
  u8() { return this.dv.getUint8(this.off++); }
  bool() { const v = this.u8(); if (v > 1) throw new Error("bad bool"); return v === 1; }
  u16() { const v = this.dv.getUint16(this.off, true); this.off += 2; return v; }
  u32() { const v = this.dv.getUint32(this.off, true); this.off += 4; return v; }
  u64() { const v = this.dv.getBigUint64(this.off, true); this.off += 8; return v; }
  i64() { const v = this.dv.getBigInt64(this.off, true); this.off += 8; return v; }
  pubkey() { const v = new PublicKey(this.buf.slice(this.off, this.off + 32)); this.off += 32; return v; }
  bytes(n: number) { const v = this.buf.slice(this.off, this.off + n); this.off += n; return v; }
}

export class Writer {
  private parts: number[] = [];
  u8(v: number) { this.parts.push(v & 0xff); return this; }
  bool(v: boolean) { return this.u8(v ? 1 : 0); }
  u16(v: number) { this.parts.push(v & 0xff, (v >> 8) & 0xff); return this; }
  u64(v: bigint | number) { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); this.parts.push(...b); return this; }
  i64(v: bigint | number) { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(v), true); this.parts.push(...b); return this; }
  pubkey(k: PublicKey) { this.parts.push(...k.toBytes()); return this; }
  bytes(b: Uint8Array) { this.parts.push(...b); return this; }
  done() { return Uint8Array.from(this.parts); }
}

export function writeParams(w: Writer, p: Params) {
  w.i64(p.timelockSecs).u64(p.worldCreateFee).u64(p.moduleRegisterFee).u16(p.feeBurnBps)
    .u64(p.tickCost).u64(p.tickIntervalSlots).u8(p.gensPerTick).u16(p.crankerBps).u16(p.protocolBps)
    .u16(p.hostBps).u64(p.epochSlots).u16(p.emissionRateBps).u16(p.rebateCapBps).u16(p.harbergerBps)
    .u64(p.minPrice).u64(p.plantCost);
}

export function readParams(r: Reader): Params {
  return {
    timelockSecs: r.i64(), worldCreateFee: r.u64(), moduleRegisterFee: r.u64(), feeBurnBps: r.u16(),
    tickCost: r.u64(), tickIntervalSlots: r.u64(), gensPerTick: r.u8(), crankerBps: r.u16(), protocolBps: r.u16(),
    hostBps: r.u16(), epochSlots: r.u64(), emissionRateBps: r.u16(), rebateCapBps: r.u16(), harbergerBps: r.u16(),
    minPrice: r.u64(), plantCost: r.u64(),
  };
}

export type PendingAction =
  | { kind: "None" }
  | { kind: "SetParams"; params: Params }
  | { kind: "SetAdmin"; admin: PublicKey }
  | { kind: "TreasurySpend"; amount: bigint; recipient: PublicKey };

export function writePending(w: Writer, a: PendingAction) {
  switch (a.kind) {
    case "None": w.u8(0); break;
    case "SetParams": w.u8(1); writeParams(w, a.params); break;
    case "SetAdmin": w.u8(2).pubkey(a.admin); break;
    case "TreasurySpend": w.u8(3).u64(a.amount).pubkey(a.recipient); break;
  }
}

function readPending(r: Reader): PendingAction {
  const tag = r.u8();
  switch (tag) {
    case 0: return { kind: "None" };
    case 1: return { kind: "SetParams", params: readParams(r) };
    case 2: return { kind: "SetAdmin", admin: r.pubkey() };
    case 3: return { kind: "TreasurySpend", amount: r.u64(), recipient: r.pubkey() };
    default: throw new Error("bad PendingAction tag");
  }
}

function checkDisc(data: Uint8Array, name: string): Reader {
  const d = accountDiscriminator(name);
  for (let i = 0; i < 8; i++) if (data[i] !== d[i]) throw new Error(`not a ${name} account`);
  const r = new Reader(data);
  r.off = 8;
  return r;
}

export interface ConfigAccount {
  version: number; bump: number; admin: PublicKey; mint: PublicKey; genesisDone: boolean; paused: boolean;
  params: Params; pending: PendingAction; pendingEta: bigint; pendingNonce: bigint;
  rootWorlds: bigint; totalWorlds: bigint; modules: bigint; curEpoch: bigint; epochStartSlot: bigint;
  curTotalBurn: bigint; prevTotalBurn: bigint; prevEmission: bigint; prevClaimed: bigint;
  totalBurned: bigint; totalEmitted: bigint;
}

export function decodeConfig(data: Uint8Array): ConfigAccount {
  const r = checkDisc(data, "Config");
  const version = r.u8(), bump = r.u8();
  r.u8(); r.u8(); r.u8(); r.u8();
  return {
    version, bump, admin: r.pubkey(), mint: r.pubkey(), genesisDone: r.bool(), paused: r.bool(),
    params: readParams(r), pending: readPending(r), pendingEta: r.i64(), pendingNonce: r.u64(),
    rootWorlds: r.u64(), totalWorlds: r.u64(), modules: r.u64(), curEpoch: r.u64(), epochStartSlot: r.u64(),
    curTotalBurn: r.u64(), prevTotalBurn: r.u64(), prevEmission: r.u64(), prevClaimed: r.u64(),
    totalBurned: r.u64(), totalEmitted: r.u64(),
  };
}

export interface WorldAccount {
  version: number; bump: number; vaultBump: number; depth: number; parent: PublicKey; parentTerritory: number;
  index: bigint; architect: PublicKey; architectFeeBps: number; module: PublicKey; birth: number; survive: number;
  name: string; grid: BigUint64Array; generation: bigint; tickCount: bigint; lastTickSlot: bigint; createdSlot: bigint;
  energy: bigint; rewardsReserved: bigint; deposits: bigint; architectAccrued: bigint;
  territoryAlive: number[]; territoryPending: bigint[]; ownedMask: bigint;
  epochId: bigint; burnCur: bigint; scoresCur: number[]; prevEpochId: bigint; burnPrev: bigint; scoresPrev: number[];
  prevClaimed: boolean; resonance: number; childCount: number; rebellionId: number; rebellionVotes: number;
  rebellionDeadline: bigint; lastRebellionSlot: bigint; liberated: boolean; totalBurned: bigint;
  qBirth: number; qSurvive: number; qAmp: number; entropy: Uint8Array; quantumEscrow: bigint; superpositions: number;
  /** Neutral quantum world: no architect, SWAP market enabled. */
  neutral: boolean;
}

export function decodeWorld(data: Uint8Array): WorldAccount {
  const r = checkDisc(data, "World");
  const arr = <T>(n: number, f: () => T) => Array.from({ length: n }, f);
  const w: Partial<WorldAccount> = {};
  w.version = r.u8(); w.bump = r.u8(); w.vaultBump = r.u8(); w.depth = r.u8();
  w.parent = r.pubkey(); w.parentTerritory = r.u8(); w.index = r.u64();
  w.architect = r.pubkey(); w.architectFeeBps = r.u16(); w.module = r.pubkey();
  w.birth = r.u16(); w.survive = r.u16(); w.name = decodeName(r.bytes(32));
  const g = new BigUint64Array(GRID); for (let i = 0; i < GRID; i++) g[i] = r.u64(); w.grid = g;
  w.generation = r.u64(); w.tickCount = r.u64(); w.lastTickSlot = r.u64(); w.createdSlot = r.u64();
  w.energy = r.u64(); w.rewardsReserved = r.u64(); w.deposits = r.u64(); w.architectAccrued = r.u64();
  w.territoryAlive = arr(TERRITORIES, () => r.u16());
  w.territoryPending = arr(TERRITORIES, () => r.u64());
  w.ownedMask = r.u64();
  w.epochId = r.u64(); w.burnCur = r.u64(); w.scoresCur = arr(TERRITORIES, () => r.u32());
  w.prevEpochId = r.u64(); w.burnPrev = r.u64(); w.scoresPrev = arr(TERRITORIES, () => r.u32());
  w.prevClaimed = r.bool(); w.resonance = r.u16(); w.childCount = r.u16();
  w.rebellionId = r.u32(); w.rebellionVotes = r.u8(); w.rebellionDeadline = r.u64(); w.lastRebellionSlot = r.u64();
  w.liberated = r.bool(); w.totalBurned = r.u64();
  w.qBirth = r.u16(); w.qSurvive = r.u16(); w.qAmp = r.u8(); w.entropy = r.bytes(32); w.quantumEscrow = r.u64(); w.superpositions = r.u16();
  w.neutral = r.bool();
  return w as WorldAccount;
}

export interface TerritoryAccount {
  world: PublicKey; index: number; holder: PublicKey; price: bigint; deposit: bigint; lastTaxSlot: bigint;
  lastPriceChangeSlot: bigint; nextPlantTick: bigint; acquiredSlot: bigint; votedRebellion: number;
  agentManaged: boolean; childWorld: PublicKey; bump: number;
}

export function decodeTerritory(data: Uint8Array): TerritoryAccount {
  const r = checkDisc(data, "Territory");
  r.u8(); const bump = r.u8();
  return {
    bump, world: r.pubkey(), index: r.u8(), holder: r.pubkey(), price: r.u64(), deposit: r.u64(), lastTaxSlot: r.u64(),
    lastPriceChangeSlot: r.u64(), nextPlantTick: r.u64(), acquiredSlot: r.u64(), votedRebellion: r.u32(),
    agentManaged: r.bool(), childWorld: r.pubkey(),
  };
}

export interface PlayerAccount { owner: PublicKey; claimable: bigint; totalEarned: bigint; territories: number }
export function decodePlayer(data: Uint8Array): PlayerAccount {
  const r = checkDisc(data, "Player");
  r.u8(); r.u8();
  return { owner: r.pubkey(), claimable: r.u64(), totalEarned: r.u64(), territories: r.u32() };
}

export interface ModuleAccount { id: bigint; author: PublicKey; birth: number; survive: number; royaltyBps: number; name: string; accrued: bigint; totalEarned: bigint; worldsUsing: number; qBirth: number; qSurvive: number; qAmp: number }
export function decodeModule(data: Uint8Array): ModuleAccount {
  const r = checkDisc(data, "PhysicsModule");
  r.u8(); r.u8();
  return { id: r.u64(), author: r.pubkey(), birth: r.u16(), survive: r.u16(), royaltyBps: r.u16(), name: decodeName(r.bytes(32)), accrued: r.u64(), totalEarned: r.u64(), worldsUsing: r.u32(), qBirth: r.u16(), qSurvive: r.u16(), qAmp: r.u8() };
}

export interface PermitAccount { owner: PublicKey; agent: PublicKey; scope: number; allowedWorld: PublicKey; maxSpendPerEpoch: bigint; maxPrice: bigint; spent: bigint; spendEpoch: bigint; expirySlot: bigint; createdSlot: bigint }
export function decodePermit(data: Uint8Array): PermitAccount {
  const r = checkDisc(data, "AgentPermit");
  r.u8(); r.u8(); r.u8();
  return { owner: r.pubkey(), agent: r.pubkey(), scope: r.u8(), allowedWorld: r.pubkey(), maxSpendPerEpoch: r.u64(), maxPrice: r.u64(), spent: r.u64(), spendEpoch: r.u64(), expirySlot: r.u64(), createdSlot: r.u64() };
}

/** Byte size of World per InitSpace (used by tests to catch layout drift). */
export const WORLD_SPACE = 8 + 4 + 32 + 1 + 8 + 32 + 2 + 32 + 2 + 2 + 32 + GRID * 8 + 8 * 4 + 8 * 4 + TERRITORIES * 2 + TERRITORIES * 8 + 8 + 8 + 8 + TERRITORIES * 4 + 8 + 8 + TERRITORIES * 4 + 1 + 2 + 2 + 4 + 1 + 8 + 8 + 1 + 8
  + 2 + 2 + 1 + 32 + 8 + 2 + 1;

export interface SuperpositionAccount {
  owner: PublicKey; world: PublicKey; index: number; world2: PublicKey; index2: number; commitment: Uint8Array;
  commitSlot: bigint; targetSlot: bigint; observed: boolean; observedSlot: bigint; entropy: Uint8Array;
  revealDeadline: bigint; stake: bigint; rearms: number;
}
export function decodeSuperposition(data: Uint8Array): SuperpositionAccount {
  const r = checkDisc(data, "Superposition");
  r.u8(); r.u8();
  return {
    owner: r.pubkey(), world: r.pubkey(), index: r.u8(), world2: r.pubkey(), index2: r.u8(), commitment: r.bytes(32),
    commitSlot: r.u64(), targetSlot: r.u64(), observed: r.bool(), observedSlot: r.u64(), entropy: r.bytes(32),
    revealDeadline: r.u64(), stake: r.u64(), rearms: r.u8(),
  };
}

export interface SwapAccount {
  world: PublicKey; offerer: PublicKey; acceptor: PublicKey; indexA: number; indexB: number; weightBps: number;
  premium: bigint; bounty: bigint; createdSlot: bigint; expirySlot: bigint; accepted: boolean; targetSlot: bigint; rearms: number;
}
export function decodeSwap(data: Uint8Array): SwapAccount {
  const r = checkDisc(data, "QuantumSwap");
  r.u8(); r.u8();
  return {
    world: r.pubkey(), offerer: r.pubkey(), acceptor: r.pubkey(), indexA: r.u8(), indexB: r.u8(), weightBps: r.u16(),
    premium: r.u64(), bounty: r.u64(), createdSlot: r.u64(), expirySlot: r.u64(), accepted: r.bool(), targetSlot: r.u64(), rearms: r.u8(),
  };
}

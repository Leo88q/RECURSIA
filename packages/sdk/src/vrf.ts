// ORAO VRF glue — mirror of the VRF part of programs/recursia/src/quantum.rs.
// The program only READS ORAO accounts; anyone (player, keeper, client) may create
// the request for a seed: the answer depends only on the seed, not on who asks or when.
import { Buffer } from "buffer";
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

export const ORAO_VRF_ID = new PublicKey("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");
export const ORAO_RANDOMNESS_SEED = new TextEncoder().encode("orao-vrf-randomness-request");
export const ORAO_CONFIG_SEED = new TextEncoder().encode("orao-vrf-network-configuration");
/** sha256("account:RandomnessV2")[..8] */
export const ORAO_RANDOMNESS_V2_DISC = Uint8Array.from([139, 239, 184, 215, 227, 86, 191, 226]);
/** sha256("global:request_v2")[..8] */
const REQUEST_V2_IX = Uint8Array.from([38, 151, 209, 6, 195, 102, 28, 217]);

const enc = new TextEncoder();
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const u64le = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };

export function oraoRandomnessPda(seed: Uint8Array, vrf = ORAO_VRF_ID): PublicKey {
  return PublicKey.findProgramAddressSync([ORAO_RANDOMNESS_SEED, seed], vrf)[0];
}
export function oraoNetworkState(vrf = ORAO_VRF_ID): PublicKey {
  return PublicKey.findProgramAddressSync([ORAO_CONFIG_SEED], vrf)[0];
}
/** Treasury from ORAO NetworkState: [8 disc][authority 32][treasury 32][fee u64]… */
export function oraoTreasury(networkStateData: Uint8Array): PublicKey {
  if (networkStateData.length < 72) throw new Error("ORAO network state too short");
  return new PublicKey(networkStateData.subarray(40, 72));
}
export function oraoRequestFee(networkStateData: Uint8Array): bigint {
  return new DataView(networkStateData.buffer, networkStateData.byteOffset).getBigUint64(72, true);
}
/** ORAO `request_v2(seed)` — creates the randomness request PDA (payer pays the SOL fee + rent). */
export function oraoRequestIx(payer: PublicKey, seed: Uint8Array, treasury: PublicKey, vrf = ORAO_VRF_ID): TransactionInstruction {
  if (seed.length !== 32) throw new Error("VRF seed must be 32 bytes");
  return new TransactionInstruction({
    programId: vrf,
    data: Buffer.from(cat(REQUEST_V2_IX, seed)),
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: oraoNetworkState(vrf), isSigner: false, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
      { pubkey: oraoRandomnessPda(seed, vrf), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

export type OraoState = { state: "missing" } | { state: "pending" } | { state: "fulfilled"; randomness: Uint8Array } | { state: "invalid" };
/** Same checks as the program's `quantum::orao_fulfilled` (plus owner, which the program checks separately). */
export function oraoState(account: { owner: PublicKey; data: Uint8Array } | null, seed: Uint8Array, vrf = ORAO_VRF_ID): OraoState {
  if (!account) return { state: "missing" };
  const d = account.data;
  if (!account.owner.equals(vrf) || d.length < 73 || !ORAO_RANDOMNESS_V2_DISC.every((b, i) => d[i] === b)) return { state: "invalid" };
  if (!seed.every((b, i) => d[41 + i] === b)) return { state: "invalid" };
  if (d[8] === 0) return { state: "pending" };
  if (d[8] !== 1 || d.length < 137) return { state: "invalid" };
  const randomness = d.slice(73, 137);
  return randomness.every((b) => b === 0) ? { state: "invalid" } : { state: "fulfilled", randomness };
}

/** Test/sandbox helper: bytes of a FULFILLED RandomnessV2 account (allocated at PENDING size like ORAO does). */
export function oraoFulfilledAccountData(seed: Uint8Array, randomness: Uint8Array, client = new Uint8Array(32)): Uint8Array {
  const d = new Uint8Array(8 + 1 + 32 + 32 + 4 + 96 * 7);
  d.set(ORAO_RANDOMNESS_V2_DISC, 0); d[8] = 1; d.set(client, 9); d.set(seed, 41); d.set(randomness.subarray(0, 64), 73);
  return d;
}

export const vrfSeedSuperposition = (world: Uint8Array, index: number, commitment: Uint8Array, recentSlotHash: Uint8Array) =>
  sha256(cat(enc.encode("recursia/vrf/psi/v1"), world, Uint8Array.of(index), commitment, recentSlotHash));
export const vrfSeedSwap = (swap: Uint8Array, recentSlotHash: Uint8Array, acceptSlot: bigint) =>
  sha256(cat(enc.encode("recursia/vrf/swap/v1"), swap, recentSlotHash, u64le(acceptSlot)));
export const entropyFromVrf = (randomness: Uint8Array) => sha256(cat(enc.encode("recursia/vrf/entropy/v1"), randomness));

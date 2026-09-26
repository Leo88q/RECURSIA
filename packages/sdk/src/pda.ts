import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey("2GrrTSyT4AG58XkEjtsV18dV8RPm6AZgQSjSxguCwCik");
export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const BPF_UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

const enc = (s: string) => new TextEncoder().encode(s);
const u64le = (n: bigint | number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(n), true); return b; };

export class Pdas {
  constructor(readonly programId: PublicKey = PROGRAM_ID) {}
  private f(seeds: Uint8Array[]) { return PublicKey.findProgramAddressSync(seeds, this.programId)[0]; }
  config() { return this.f([enc("config")]); }
  mint() { return this.f([enc("mint")]); }
  treasury() { return this.f([enc("treasury")]); }
  rewardPool() { return this.f([enc("reward_pool")]); }
  claims() { return this.f([enc("claims")]); }
  rootWorld(index: bigint | number) { return this.f([enc("world"), PublicKey.default.toBytes(), u64le(index)]); }
  childWorld(host: PublicKey, territory: number) { return this.f([enc("world"), host.toBytes(), u64le(territory)]); }
  worldVault(world: PublicKey) { return this.f([enc("world_vault"), world.toBytes()]); }
  territory(world: PublicKey, idx: number) { return this.f([enc("territory"), world.toBytes(), Uint8Array.of(idx)]); }
  player(owner: PublicKey) { return this.f([enc("player"), owner.toBytes()]); }
  module(id: bigint | number) { return this.f([enc("module"), u64le(id)]); }
  permit(owner: PublicKey, agent: PublicKey) { return this.f([enc("permit"), owner.toBytes(), agent.toBytes()]); }
  permitVault(permit: PublicKey) { return this.f([enc("permit_vault"), permit.toBytes()]); }
  programData() { return PublicKey.findProgramAddressSync([this.programId.toBytes()], BPF_UPGRADEABLE_LOADER)[0]; }
}

export function ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
}

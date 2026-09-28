// Adapts on-chain accounts to the shared MWorld view model, so the canvas and
// forecast code are identical in sandbox and live mode.
import { PublicKey } from "@solana/web3.js";
import { TERRITORIES, type MWorld, type TerritoryAccount, type WorldAccount } from "@recursia/sdk";

export function toModel(key: PublicKey, w: WorldAccount, terr: Map<number, TerritoryAccount>): MWorld {
  const def = PublicKey.default;
  return {
    id: key.toBase58(), name: w.name, parent: w.parent.equals(def) ? null : w.parent.toBase58(), parentTerritory: w.parentTerritory,
    depth: w.depth, architect: w.architect.equals(def) ? null : w.architect.toBase58(), architectFeeBps: w.architectFeeBps,
    module: 0, birth: w.birth, survive: w.survive, grid: w.grid, generation: Number(w.generation), tickCount: Number(w.tickCount),
    lastTickSlot: Number(w.lastTickSlot), energy: w.energy, rewardsReserved: w.rewardsReserved, deposits: w.deposits,
    architectAccrued: w.architectAccrued, vault: 0n, alive: w.territoryAlive, pending: w.territoryPending,
    territories: Array.from({ length: TERRITORIES }, (_, i) => {
      const t = terr.get(i);
      const held = t && !t.holder.equals(def);
      return {
        holder: held ? t!.holder.toBase58() : null, price: t?.price ?? 0n, deposit: t?.deposit ?? 0n, lastTaxSlot: Number(t?.lastTaxSlot ?? 0n),
        lastPriceChange: Number(t?.lastPriceChangeSlot ?? 0n), nextPlantTick: Number(t?.nextPlantTick ?? 0n), acquiredSlot: Number(t?.acquiredSlot ?? 0n),
        votedRebellion: t?.votedRebellion ?? 0, agent: t?.agentManaged ?? false, childWorld: t && !t.childWorld.equals(def) ? t.childWorld.toBase58() : null,
      };
    }),
    epochId: Number(w.epochId), sinkCur: w.sinkCur, scoresCur: w.scoresCur, prevEpochId: Number(w.prevEpochId), sinkPrev: w.sinkPrev,
    scoresPrev: w.scoresPrev, prevClaimed: w.prevClaimed, resonance: w.resonance, children: [], rebellionId: w.rebellionId,
    rebellionVotes: w.rebellionVotes, rebellionDeadline: Number(w.rebellionDeadline), lastRebellionSlot: Number(w.lastRebellionSlot),
    liberated: w.liberated, totalSunk: w.totalSunk, history: [],
    key: key.toBytes(), qBirth: w.qBirth, qSurvive: w.qSurvive, qAmp: w.qAmp,
    entropy: w.entropy.some((b) => b !== 0) ? w.entropy : null, quantumEscrow: w.quantumEscrow, superpositions: w.superpositions,
    neutral: w.neutral, scoreOwnedCur: w.scoreOwnedCur, scoreOwnedPrev: w.scoreOwnedPrev,
  };
}

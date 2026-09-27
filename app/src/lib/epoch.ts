/**
 * Mirror of on-chain `roll_world_epoch` + the `claim_world_epoch` preconditions
 * (programs/recursia/src/instructions/{common,world}.rs): can this world's
 * previous-epoch emission be claimed right now? Used only to enable the button —
 * the program remains the authority.
 */
export interface EpochWindow { epochId: bigint; prevEpochId: bigint; prevClaimed: boolean; sinkCur: bigint; sinkPrev: bigint }

export function worldEpochClaimable(w: EpochWindow, curEpoch: bigint): boolean {
  if (w.epochId >= curEpoch) return !w.prevClaimed && w.prevEpochId + 1n === curEpoch && w.sinkPrev > 0n;
  // roll: exactly one epoch behind → current window becomes "prev"; further behind → window forfeited
  if (w.epochId + 1n === curEpoch) return w.sinkCur > 0n;
  return false;
}

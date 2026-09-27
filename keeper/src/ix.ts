import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { oraoRequestIx, type RecursiaIx } from "@recursia/sdk";
import type { Action } from "./plan.js";

/** Map a planned action to the SDK instruction builder (no I/O). */
export function toInstruction(rx: RecursiaIx, cranker: PublicKey, a: Action): TransactionInstruction {
  switch (a.kind) {
    case "advance_epoch": return rx.advanceEpoch();
    case "claim_world_epoch": return rx.claimWorldEpoch(a.world);
    case "claim_season_prize": return rx.claimSeasonPrize(a.winner, a.rank);
    case "tournament_settle": return rx.tournamentSettle(a.seasonId, a.tier);
    case "claim_tournament_prize": return rx.claimTournamentPrize(a.winner, a.seasonId, a.tier, a.rank);
    case "settle": return rx.settle(a.world, a.index, a.holder);
    case "breach": return rx.breach(a.child, a.host);
    case "tick": return rx.tick(cranker, a.world, a.module, a.host);
    case "vrf_request": return oraoRequestIx(cranker, a.seed, a.treasury);
    case "quantum_observe": return rx.quantumObserve(cranker, a.world, a.index, a.vrf);
    case "quantum_decohere": return rx.quantumDecohere(cranker, a.world, a.index, a.owner);
    case "swap_resolve": return rx.swapResolve(cranker, a.world, a.a, a.b, a.offerer, a.acceptor, a.vrf);
    case "swap_cancel": return rx.swapCancel(cranker, a.world, a.a, a.b, a.offerer);
  }
}

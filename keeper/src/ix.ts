import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { RecursiaIx } from "@recursia/sdk";
import type { Action } from "./plan.js";

/** Map a planned action to the SDK instruction builder (no I/O). */
export function toInstruction(rx: RecursiaIx, cranker: PublicKey, a: Action): TransactionInstruction {
  switch (a.kind) {
    case "advance_epoch": return rx.advanceEpoch();
    case "claim_world_epoch": return rx.claimWorldEpoch(a.world);
    case "settle": return rx.settle(a.world, a.index, a.holder);
    case "breach": return rx.breach(a.child, a.host);
    case "tick": return rx.tick(cranker, a.world, a.module, a.host);
    case "quantum_observe": return rx.quantumObserve(cranker, a.world, a.index);
    case "quantum_decohere": return rx.quantumDecohere(cranker, a.world, a.index, a.owner);
    case "swap_resolve": return rx.swapResolve(cranker, a.world, a.a, a.b, a.offerer, a.acceptor);
    case "swap_cancel": return rx.swapCancel(cranker, a.world, a.a, a.b, a.offerer);
  }
}

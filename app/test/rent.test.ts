import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { PROGRAM_ID, RecursiaIx } from "@recursia/sdk";
import { reclaimableEntries } from "../src/chain/WalletPanel";

describe("tournament rent refund", () => {
  it("offers entries of settled or already-closed tournaments, never of running ones", () => {
    const rx = new RecursiaIx(PROGRAM_ID, Keypair.generate().publicKey);
    const T = (seasonId: bigint, tier: number, settled: boolean) => ({ key: rx.pda.tournament(seasonId, tier), acc: { seasonId, tier, settled } });
    const data = { tournaments: [T(2n, 0, true), T(3n, 0, false)] };
    const entries = new Set([
      rx.pda.tournament(2n, 0).toBase58(), // settled → yes
      rx.pda.tournament(3n, 0).toBase58(), // running → no
      rx.pda.tournament(1n, 1).toBase58(), // account already closed → recovered from the PDA
      Keypair.generate().publicKey.toBase58(), // unknown → ignored
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- only the fields the helper reads
    const got = reclaimableEntries({ rx, config: { seasonId: 3n } as any, data: data as any }, entries);
    expect(got).toEqual([{ seasonId: 2n, tier: 0 }, { seasonId: 1n, tier: 1 }]);
  });
});

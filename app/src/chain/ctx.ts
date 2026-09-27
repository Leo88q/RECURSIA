import type { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { ConfigAccount, MWorld, RecursiaIx, WorldAccount } from "@recursia/sdk";
import type { Keyed, MyData, ProgramData, WorldDetail } from "./data";
import type { TxRequest, TxResult } from "./tx";

/** Everything a live-mode panel needs, passed down explicitly (no hidden globals). */
export interface ChainCtx {
  rx: RecursiaIx;
  connection: Connection;
  programId: PublicKey;
  config: ConfigAccount;
  data: ProgramData;
  my: MyData;
  me: PublicKey | null;
  cur: Keyed<WorldAccount> | null;
  model: MWorld | null;
  detail: WorldDetail;
  slot: number;
  run: (r: TxRequest) => Promise<TxResult>;
  /** Prepends idempotent ATA creation when the wallet has no SKR account yet. */
  withAta: (ixs: TransactionInstruction[]) => TransactionInstruction[];
  openWorld: (key: string, cell?: number) => void;
  selectCell: (i: number | null) => void;
}

/** Why an action can't be sent right now (null = ok). Shared guard texts. */
export function blocked(c: ChainCtx, opts: { spend?: bigint; paused?: boolean } = {}): string | null {
  if (!c.me) return "Подключите кошелёк";
  if ((opts.paused ?? true) && c.config.paused) return "Протокол на паузе (вывод средств доступен)";
  if (c.my.sol !== null && c.my.sol < 10_000) return "Нужно немного SOL на комиссию сети";
  if (opts.spend !== undefined && opts.spend > 0n && (c.my.rcr ?? 0n) < opts.spend) return "Недостаточно SKR на кошельке";
  return null;
}

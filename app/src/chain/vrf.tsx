// ORAO VRF in the client: shows the oracle state for a position and offers the
// next step — request randomness (anyone may; the answer depends only on the seed),
// wait while ORAO answers, or measure once fulfilled.
import { useEffect, useState, type ReactNode } from "react";
import type { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { oraoNetworkState, oraoRandomnessPda, oraoRequestFee, oraoRequestIx, oraoState, oraoTreasury, ORAO_VRF_ID, type OraoState } from "@recursia/sdk";
import type { ChainCtx } from "./ctx";

export type Vrf = { state: OraoState["state"] | "loading"; seed: Uint8Array; pda: PublicKey; treasury: PublicKey | null; feeLamports: bigint | null };

export function useVrf(connection: Connection, seed: Uint8Array | null): Vrf | null {
  const [v, setV] = useState<Vrf | null>(null);
  const hex = seed ? Array.from(seed, (b) => b.toString(16).padStart(2, "0")).join("") : "";
  useEffect(() => {
    if (!seed) { setV(null); return; }
    const pda = oraoRandomnessPda(seed);
    let stop = false; let timer: ReturnType<typeof setTimeout> | undefined;
    setV({ state: "loading", seed, pda, treasury: null, feeLamports: null });
    const load = async () => {
      try {
        const [req, ns] = await connection.getMultipleAccountsInfo([pda, oraoNetworkState()], "confirmed");
        if (stop) return;
        const state = oraoState(req ? { owner: req.owner, data: req.data } : null, seed).state;
        const okNs = ns && ns.owner.equals(ORAO_VRF_ID) && ns.data.length >= 80;
        setV({ state, seed, pda, treasury: okNs ? oraoTreasury(ns.data) : null, feeLamports: okNs ? oraoRequestFee(ns.data) : null });
        if (state !== "fulfilled") timer = setTimeout(load, 3_000); // ORAO answers within seconds
      } catch { if (!stop) timer = setTimeout(load, 5_000); }
    };
    void load();
    return () => { stop = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the seed bytes
  }, [connection, hex]);
  return v;
}

const sol = (l: bigint) => `${(Number(l) / 1e9).toFixed(4)} SOL`;

/** Button row for a VRF-gated measurement. `measure(vrf)` builds the program instruction(s). */
export function VrfAction({ c, v, label, title, lines, measure }: {
  c: ChainCtx; v: Vrf | null; label: ReactNode; title: string; lines: string[];
  measure: (vrf: PublicKey) => TransactionInstruction[];
}) {
  if (!v || v.state === "loading") return <button className="btn" disabled>Проверяем оракул…</button>;
  if (v.state === "fulfilled") return <button className="btn" disabled={!c.me} onClick={() => c.run({ title, lines, ixs: measure(v.pda) })}>{label}</button>;
  if (v.state === "pending") return <button className="btn" disabled title="Оракул ORAO VRF подписывает ответ">Оракул отвечает…</button>;
  if (v.state === "invalid") return <div className="field-hint">Аккаунт запроса VRF повреждён — сообщите команде</div>;
  // missing: anyone may create the request — the result is fixed by the seed, not by who asks or when
  return (
    <button className="btn" disabled={!c.me || !v.treasury} title={v.treasury ? "" : "Конфигурация ORAO недоступна"} onClick={() => c.run({
      title: "Запрос случайности (ORAO VRF)",
      lines: [
        "Исход уже зафиксирован сидом, выбранным при открытии позиции — запрос только просит оракул его подписать",
        `Комиссия оракула: ${v.feeLamports !== null ? sol(v.feeLamports) : "—"} + аренда аккаунта`,
        "Через несколько секунд можно будет измерить",
      ],
      ixs: [oraoRequestIx(c.me!, v.seed, v.treasury!)],
    })}>Запросить случайность</button>
  );
}


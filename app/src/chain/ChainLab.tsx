import { useMemo } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { probeLaw, ruleString } from "@recursia/sdk";
import { PhysicsLab, type LabModule } from "../lab";
import { rcr, shortAddr } from "../lib/format";
import { blocked, type ChainCtx } from "./ctx";

export function ChainLab({ c }: { c: ChainCtx }) {
  const p = c.config.params;
  const me = c.me;
  const vitality = useMemo(() => new Map(c.data.modules.map((m) => [m.acc.id, probeLaw(m.acc, 48, 2).vitality])), [c.data.modules]);
  const mods: LabModule[] = c.data.modules.map(({ acc }) => ({
    id: Number(acc.id), name: acc.name, author: shortAddr(acc.author.toBase58()),
    law: { birth: acc.birth, survive: acc.survive, qBirth: acc.qBirth, qSurvive: acc.qSurvive, qAmp: acc.qAmp, royaltyBps: acc.royaltyBps },
    worldsUsing: acc.worldsUsing, earned: acc.totalEarned, accrued: acc.accrued, vitality: vitality.get(acc.id) ?? 0, mine: !!me && acc.author.equals(me),
  }));
  return (
    <div className="chain-lab">
      <div className="row-wrap lab-bar"><a className="btn" href="#/chain">← К мирам</a><WalletMultiButton /></div>
      <PhysicsLab
        modules={mods} fee={p.moduleRegisterFee} feeBurnBps={p.feeBurnBps} fmt={(v) => rcr(v)}
        note="Транзакция симулируется и показывается перед подписью. Роялти неизменяемо после публикации."
        onPublish={async (law, name) => {
          const why = blocked(c, { spend: p.moduleRegisterFee });
          if (why) return why;
          // Only report success after the transaction is CONFIRMED on-chain.
          const r = await c.run({
            title: "Публикация закона физики",
            lines: [
              `«${name}»: ${ruleString(law.birth, law.survive, law.qBirth, law.qSurvive, law.qAmp)}`,
              `Роялти автора: ${law.royaltyBps / 100}% каждого тика миров с этой физикой (неизменяемо)`,
              `Сбор регистрации: ${rcr(p.moduleRegisterFee)} (${p.feeBurnBps / 100}% сжигается)`,
              `Модуль #${c.config.modules.toString()}`,
            ],
            ixs: [c.rx.registerModule(me!, c.config.modules, law.birth, law.survive, law.royaltyBps, name, law)],
            successText: `Закон «${name}» опубликован`,
          });
          return r.ok ? null : r.cancelled ? "Публикация отменена" : r.error;
        }}
        onClaim={(id) => { if (me) void c.run({ title: "Роялти автора", lines: ["Накопленные роялти → ваш баланс к выводу"], ixs: [c.rx.claimModuleRoyalties(me, c.rx.pda.module(BigInt(id)))] }); }}
      />
    </div>
  );
}

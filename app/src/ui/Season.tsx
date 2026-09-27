import { useState } from "react";
import { Art, Glyph } from "./Icon";

/** One leaderboard / prize row, already resolved to a display label. */
export interface SeasonRow { label: string; points: bigint; you: boolean }
export interface PrizeRow extends SeasonRow { prize: bigint; claimed: boolean }

export interface SeasonCardProps {
  seasonId: number;
  /** epochs until the season closes (0 = closes at the next epoch) */
  epochsLeft: number;
  /** season prize pool (null = still loading) */
  pool: bigint | null;
  top: SeasonRow[];
  myPoints: bigint;
  /** why "submit" is unavailable (null = available) */
  submitBlocked: string | null;
  onSubmit: () => void;
  last: { id: number; rows: PrizeRow[] } | null;
  onClaim: (rank: number) => void;
  claimBlocked: string | null;
  fmt: (v: bigint) => string;
}

/**
 * Weekly season: points = SKR you collected from life (rewards + host tax).
 * 25% of the studio's income becomes the prize fund; a prize is capped at 25%
 * of the winner's own points, so it amplifies real play and can't be farmed.
 */
export function SeasonCard(p: SeasonCardProps) {
  const inTop = p.top.some((r) => r.you);
  return (
    <div className="card season-card">
      <div className="card-title"><Glyph name="crown" size={18} className="gold" />Сезон {p.seasonId}</div>
      <dl className="kv small">
        <dt>Призовой фонд</dt><dd>{p.pool === null ? "…" : p.fmt(p.pool)}</dd>
        <dt>До конца</dt><dd>{p.epochsLeft <= 0 ? "закроется в эту эпоху" : `${p.epochsLeft} эп.`}</dd>
        <dt>Ваши очки</dt><dd>{p.fmt(p.myPoints)}</dd>
      </dl>
      <p className="muted small">Очки — SKR, которые вы собрали с живых клеток. Топ-10 делит фонд (30% / 20% / 15% / …), но приз не больше 25% ваших очков. Остаток переходит в следующий сезон.</p>
      {p.top.length > 0 ? (
        <ol className="leaderboard" aria-label="Таблица сезона">
          {p.top.map((r, i) => (
            <li key={i} className={r.you ? "you" : undefined}>
              <span className="rank">{i + 1}</span><span className="who">{r.label}</span><span className="pts">{p.fmt(r.points)}</span>
            </li>
          ))}
        </ol>
      ) : <div className="muted small">Таблица пуста: соберите награды с клеток и заявите очки.</div>}
      <button className="btn" disabled={!!p.submitBlocked} title={p.submitBlocked ?? undefined} onClick={p.onSubmit}>
        <Glyph name="flag" size={14} /> {inTop ? "Обновить очки в таблице" : "Заявить очки"}
      </button>
      {p.submitBlocked && <div className="field-hint">{p.submitBlocked}</div>}
      {p.last && p.last.rows.some((r) => r.prize > 0n) && (
        <>
          <div className="card-title sub"><Art name="coin" size={18} />Призы сезона {p.last.id}</div>
          <ol className="leaderboard" aria-label={`Призы сезона ${p.last.id}`}>
            {p.last.rows.map((r, i) => r.prize > 0n && (
              <li key={i} className={r.you ? "you" : undefined}>
                <span className="rank">{i + 1}</span><span className="who">{r.label}</span>
                {r.claimed
                  ? <span className="pts muted"><Glyph name="check" size={12} /> {p.fmt(r.prize)}</span>
                  : <button className="btn tiny" disabled={!!p.claimBlocked} onClick={() => p.onClaim(i)} title="Любой может отправить — приз зачисляется победителю">+{p.fmt(r.prize)}</button>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

/** Sponsor pool: anyone (studio, partners, fans) can fund rewards for living worlds. */
export function SponsorCard({ pool, fmt, onFund, blockedWhy, parse }: {
  pool: bigint | null; fmt: (v: bigint) => string; onFund: (amount: bigint) => void; blockedWhy: (amount: bigint | null) => string | null;
  parse: (s: string) => bigint | null;
}) {
  const [amt, setAmt] = useState("");
  const a = amt ? parse(amt) : null;
  const why = blockedWhy(a);
  return (
    <div className="card">
      <div className="card-title"><Glyph name="sprout" size={17} className="mint" />Спонсорский пул</div>
      <p className="muted small">Деньги спонсоров (студии, партнёров, фанатов) раздаются мирам пропорционально живым клеткам на занятых участках: 10% пула за эпоху, миру — не больше, чем он сам внёс за эпоху. Это единственный источник, из которого игроки могут выйти в плюс.</p>
      <dl className="kv small"><dt>В пуле</dt><dd>{pool === null ? "…" : fmt(pool)}</dd></dl>
      <label className="field inline">Сумма<input value={amt} inputMode="decimal" onChange={(e) => setAmt(e.target.value)} placeholder="SKR" /></label>
      <button className="btn" disabled={!!why} onClick={() => { if (a) { onFund(a); setAmt(""); } }}>Спонсировать</button>
      {amt && why && <div className="field-hint">{why}</div>}
    </div>
  );
}

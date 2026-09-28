import { Art, Glyph } from "./Icon";
import type { PrizeRow, SeasonRow } from "./Season";

export interface TierView {
  tier: number;
  fee: bigint;
  players: number;
  max: number;
  pot: bigint;
  joined: boolean;
  /** places that will be paid if the tournament ended now */
  paidPlaces: number;
  top: SeasonRow[];
  joinBlocked: string | null;
  submitBlocked: string | null;
}
export interface FinishedView {
  seasonId: number;
  tier: number;
  settled: boolean;
  pot: bigint;
  rows: PrizeRow[];
}
export interface TournamentCardProps {
  seasonId: number;
  joinOpen: boolean;
  tiers: TierView[];
  finished: FinishedView[];
  onJoin: (tier: number) => void;
  onSubmit: (tier: number) => void;
  onSettle: (seasonId: number, tier: number) => void;
  onClaim: (seasonId: number, tier: number, rank: number) => void;
  actionBlocked: string | null;
  fmt: (v: bigint) => string;
}

export const TIER_NAMES = ["Открытый", "Мастерский"];

/**
 * Season tournament: players pay an entry fee, the program ranks them by
 * season points (SKR actually collected from life), and the top 30% share
 * 90% of the entry fees. The other 10% is the studio's rake.
 */
export function TournamentCard(p: TournamentCardProps) {
  return (
    <div className="card tournament-card">
      <div className="card-title"><Glyph name="flag" size={17} className="gold" />Турниры сезона {p.seasonId}</div>
      <p className="muted small">
        Взнос → общий банк. Когда сезон закончится, лучшие 30% участников по очкам сезона делят 90% банка (1-е место получает больше всех, дальше меньше), 10% берёт студия.
        {p.joinOpen ? " Регистрация открыта только в первую эпоху сезона." : " Регистрация закрыта: она открыта только в первую эпоху сезона."}
      </p>
      {p.tiers.map((t) => (
        <div key={t.tier} className="tier" data-testid={`tier-${t.tier}`}>
          <div className="tier-head">
            <b>{TIER_NAMES[t.tier] ?? `Уровень ${t.tier}`}</b>
            <span className="muted small">взнос {p.fmt(t.fee)} · {t.players}/{t.max} игроков · банк {p.fmt(t.pot)} · призовых мест {t.paidPlaces}</span>
          </div>
          {t.top.length > 0 && (
            <ol className="leaderboard" aria-label={`Турнир: ${TIER_NAMES[t.tier] ?? t.tier}`}>
              {t.top.map((r, i) => (
                <li key={i} className={r.you ? "you" : undefined}>
                  <span className="rank">{i + 1}</span><span className="who">{r.label}</span><span className="pts">{p.fmt(r.points)}</span>
                </li>
              ))}
            </ol>
          )}
          {t.joined ? (
            <>
              <button className="btn" disabled={!!t.submitBlocked} title={t.submitBlocked ?? undefined} onClick={() => p.onSubmit(t.tier)}>
                <Glyph name="flag" size={14} /> Обновить мои очки
              </button>
              {t.submitBlocked && <div className="field-hint">{t.submitBlocked}</div>}
            </>
          ) : (
            <>
              <button className="btn primary" disabled={!!t.joinBlocked} title={t.joinBlocked ?? undefined} onClick={() => p.onJoin(t.tier)}>
                Участвовать · {p.fmt(t.fee)}
              </button>
              {t.joinBlocked && <div className="field-hint">{t.joinBlocked}</div>}
            </>
          )}
        </div>
      ))}
      {p.finished.map((f) => (
        <div key={`${f.seasonId}:${f.tier}`} className="tier finished">
          <div className="card-title sub"><Art name="coin" size={18} />Итоги: {TIER_NAMES[f.tier] ?? f.tier}, сезон {f.seasonId}</div>
          {!f.settled ? (
            <button className="btn" disabled={!!p.actionBlocked} onClick={() => p.onSettle(f.seasonId, f.tier)} title="Любой может подвести итоги: это просто фиксирует призы">
              Подвести итоги · банк {p.fmt(f.pot)}
            </button>
          ) : (
            <ol className="leaderboard" aria-label={`Призы турнира сезона ${f.seasonId}`}>
              {f.rows.map((r, i) => r.prize > 0n && (
                <li key={i} className={r.you ? "you" : undefined}>
                  <span className="rank">{i + 1}</span><span className="who">{r.label}</span>
                  {r.claimed
                    ? <span className="pts muted"><Glyph name="check" size={12} /> {p.fmt(r.prize)}</span>
                    : <button className="btn tiny" disabled={!!p.actionBlocked} onClick={() => p.onClaim(f.seasonId, f.tier, i)} title="Любой может отправить: приз зачисляется победителю">+{p.fmt(r.prize)}</button>}
                </li>
              ))}
            </ol>
          )}
        </div>
      ))}
    </div>
  );
}

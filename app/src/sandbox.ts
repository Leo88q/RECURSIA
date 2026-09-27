// Sandbox universe: the exact game rules (reference model mirrored from the
// on-chain program) with AI inhabitants, running locally in the browser.
import {
  AIAgent, DEFAULT_PARAMS, GameModel, ONE, PHYSICS_PRESETS, epochTax, moduleVitality, randomSalt, type Law, type MWorld, type Params, type Personality,
} from "@recursia/sdk";

export interface LabModuleInfo { id: number; name: string; author: string; law: Law; worldsUsing: number; earned: bigint; accrued: bigint; vitality: number; mine: boolean }

/** Off-chain preimage of a superposition — only the player knows it. */
export interface QuantumSecret { a: bigint; b: bigint; weight: number; salt: Uint8Array; entangle?: { world: string; index: number } }

export const YOU = "Вы";
export const KEEPER = "Хранитель";
export const DEV = "Студия";

// Accelerated time for the sandbox (min allowed epoch on-chain is ~1h).
export const SANDBOX_PARAMS: Params = { ...DEFAULT_PARAMS, epochSlots: 9_000n, harbergerBps: 100 };
export const STEP_SLOTS = 160;

const PERSONAS: Array<[Personality, string]> = [
  ["gardener", "Садовник"], ["expansionist", "Экспансионист"], ["speculator", "Спекулянт"], ["demiurge", "Демиург"],
];

export interface MyAgent { agent: AIAgent; label: string; personality: Personality }

export class Sandbox {
  m: GameModel;
  agents: AIAgent[] = [];
  mine: MyAgent[] = [];
  steps = 0;
  lastError: string | null = null;
  /** Player's superposition secrets, keyed "world:index". Lose it → stake decoheres. */
  secrets = new Map<string, QuantumSecret>();

  constructor(seed = 42) {
    const m = (this.m = new GameModel(SANDBOX_PARAMS));
    m.chainSalt = randomSalt(); // every sandbox session gets its own "cluster" entropy
    m.addPlayer(DEV, 200_000n * ONE);
    for (const p of PHYSICS_PRESETS) m.registerModule(DEV, p.name, p.birth, p.survive, p.royaltyBps, p);
    m.addPlayer(KEEPER, 0n);
    m.addPlayer("Основатель", 60_000n * ONE);
    m.createRootWorld("Основатель", "Альфа", 0, 1_500, 8_000n * ONE);
    m.createRootWorld("Основатель", "Бета", 1, 2_500, 6_000n * ONE);
    m.createRootWorld("Основатель", "Коралл", 5, 1_000, 6_000n * ONE);
    m.createRootWorld("Основатель", "Квантовая пена", PHYSICS_PRESETS.findIndex((p) => p.name === "Quantum Foam"), 1_500, 8_000n * ONE);
    // neutral quantum world: nobody rules it, players exchange outcomes via SWAP
    m.createNeutralWorld("Основатель", "Ничья земля", PHYSICS_PRESETS.findIndex((p) => p.name === "Tunnel Life"), 8_000n * ONE);
    let k = 0;
    for (const [pers, label] of PERSONAS) {
      for (let j = 1; j <= 3; j++) {
        const id = `ИИ·${label}-${j}`;
        m.addPlayer(id, 12_000n * ONE, true);
        this.agents.push(new AIAgent(id, pers, seed * 1000 + ++k));
      }
    }
    m.addPlayer(YOU, 5_000n * ONE);
    // warm-up so the multiverse is alive when the player arrives
    for (let i = 0; i < 25; i++) this.step();
    m.events.push({ slot: m.slot, kind: "welcome", text: "Вы материализовались в мультивселенной с 5 000 RCR. Займите клетку, посадите жизнь, запустите свою симуляцию." });
  }

  step() {
    const m = this.m;
    m.advanceSlots(STEP_SLOTS);
    this.steps++;
    for (const id of m.worlds.keys()) if (!m.canTick(id)) { try { m.tick(KEEPER, id); } catch { /* raced */ } }
    for (const a of this.agents) if (a.rng.next() < 0.55) a.act(m);
    for (const { agent } of this.mine) agent.act(m);
    // keeper: quantum measurements (bounty) — the "observer" of the multiverse
    for (const sp of [...m.superpositions.values()]) {
      if (m.canObserve(sp.world, sp.index) === null) { try { m.quantumObserve(KEEPER, sp.world, sp.index); } catch { /* */ } }
      else if (m.canDecohere(sp.world, sp.index) === null) { try { m.quantumDecohere(KEEPER, sp.world, sp.index); } catch { /* */ } }
    }
    for (const k of [...this.secrets.keys()]) if (!m.superpositions.has(k)) this.secrets.delete(k);
    // keeper: settle quantum SWAPs (bounty) and clean up expired offers
    for (const s of [...m.swaps.values()]) {
      if (m.canSwapResolve(s.world, s.indexA, s.indexB) === null) { try { m.swapResolve(KEEPER, s.world, s.indexA, s.indexB); } catch { /* */ } }
      else if (m.canSwapCancel(KEEPER, s.world, s.indexA, s.indexB) === null) { try { m.swapCancel(KEEPER, s.world, s.indexA, s.indexB); } catch { /* */ } }
    }
    // keeper crank duties: foreclosures, breaches, epochs, emission claims
    for (const w of m.worlds.values()) {
      w.territories.forEach((t, i) => { if (t.holder && m.wouldForeclose(w, i)) { try { m.settle(w.id, i); } catch { /* */ } } });
      if (w.parent && w.resonance >= 64) { try { m.breach(w.id); } catch { /* */ } }
    }
    if (m.canAdvanceEpoch()) {
      m.advanceEpoch();
      for (const w of m.worlds.values()) { try { m.claimWorldEpoch(w.id); } catch { /* nothing */ } }
    }
  }

  /** Run a player action; returns error text (in Russian where known). */
  act(f: () => unknown): string | null {
    try { f(); this.lastError = null; return null; } catch (e) { return (this.lastError = translate((e as Error).message)); }
  }

  hireAgent(personality: Personality, budget: bigint, perEpoch: bigint, maxPrice: bigint): string | null {
    const label = PERSONAS.find((p) => p[0] === personality)![1];
    const agentId = `ваш-ИИ·${label}-${this.mine.length + 1}`;
    return this.act(() => {
      this.m.createPermit(YOU, agentId, budget, perEpoch, maxPrice, 9_000 * 30);
      const agent = new AIAgent(agentId, personality, 777 + this.mine.length, YOU);
      this.mine.push({ agent, label, personality });
      this.m.events.push({ slot: this.m.slot, kind: "agent", text: `Вы наняли ИИ-жителя «${label}» с бюджетом ${fmtRcr(budget)} (лимит ${fmtRcr(perEpoch)}/эпоху)` });
    });
  }

  /** Commit |ψ⟩ = √w·|A⟩ + √(1−w)·|B⟩ for the player (salt generated locally). */
  superpose(worldId: string, idx: number, a: bigint, b: bigint, weight: number, entangle?: { world: string; index: number }): string | null {
    return this.act(() => {
      const salt = randomSalt();
      const c = this.m.commitFor(YOU, worldId, idx, a, b, weight, salt);
      this.m.quantumCommit(YOU, worldId, idx, c, entangle);
      this.secrets.set(`${worldId}:${idx}`, { a, b, weight, salt, entangle });
    });
  }

  collapse(worldId: string, idx: number): string | null {
    const s = this.secrets.get(`${worldId}:${idx}`);
    if (!s) return "Секрет суперпозиции утерян — ставка сгорит при декогеренции";
    return this.act(() => { this.m.quantumCollapse(YOU, worldId, idx, s.a, s.b, s.weight, s.salt); this.secrets.delete(`${worldId}:${idx}`); });
  }

  superposedIn(worldId: string): number[] {
    const out: number[] = [];
    for (const sp of this.m.superpositions.values()) if (sp.world === worldId) out.push(sp.index);
    return out;
  }

  /** Player publishes a law of physics (PhysicsModule) — royalty forever. */
  publishLaw(law: Law, name: string): string | null {
    return this.act(() => this.m.registerModule(YOU, name, law.birth, law.survive, law.royaltyBps, law));
  }

  labModules(): LabModuleInfo[] {
    const cache = this.vitality;
    return this.m.modules.map((x) => ({
      id: x.id, name: x.name, author: x.author, worldsUsing: x.worldsUsing, earned: x.totalEarned, accrued: x.accrued, mine: x.author === YOU,
      law: { birth: x.birth, survive: x.survive, qBirth: x.qBirth, qSurvive: x.qSurvive, qAmp: x.qAmp, royaltyBps: x.royaltyBps },
      vitality: moduleVitality(this.m, x.id, cache),
    }));
  }
  private vitality = new Map<number, number>();

  defaultDeposit(price: bigint) { return epochTax(price, this.m.params.harbergerBps) * 3n; }
  world(id: string): MWorld { return this.m.world(id); }
}

export const fmtRcr = (v: bigint, digits = 0) => {
  const whole = v / ONE;
  const frac = digits ? "," + ((v % ONE) * 10n ** BigInt(digits) / ONE).toString().padStart(digits, "0") : "";
  return `${whole.toLocaleString("ru-RU")}${frac} RCR`;
};

const DICT: Record<string, string> = {
  "insufficient funds": "Недостаточно RCR",
  "price slippage": "Цена изменилась выше вашего лимита (защита от фронтраннинга)",
  "self-buy": "Нельзя купить у самого себя",
  "deposit too small": "Депозит меньше налога за эпоху",
  "cooldown": "Перезарядка: дождитесь следующего тика мира",
  "not holder": "Это не ваша клетка",
  "already hosts a universe": "Здесь уже существует вселенная",
  "max depth": "Достигнута максимальная глубина рекурсии (7)",
  "bad price": "Недопустимая цена",
  "deposit exhausted": "Депозит исчерпан — клетка будет изъята",
  "permit limit": "ИИ превысил лимит расходов на эпоху",
  "permit vault empty": "У ИИ закончился бюджет",
  "nothing": "Нечего собирать",
  "nothing to claim": "Нечего выводить",
  "threshold not met": "Недостаточно голосов",
  "already voted": "Вы уже голосовали",
  "bought after start": "Клетка куплена после начала восстания",
  "architect can't rebel": "Архитектор не может восстать против себя",
  "too fresh": "Клетка куплена слишком недавно",
  "already superposed": "Клетка уже в суперпозиции",
  "not measurable yet": "Ещё рано: энтропия будущего слота не появилась",
  "not observed": "Состояние ещё не наблюдали",
  "reveal window closed": "Окно раскрытия закрыто — декогеренция",
  "commitment mismatch": "Раскрытие не совпадает с коммитом",
  "still coherent": "Суперпозиция ещё когерентна",
  "entangle across different worlds": "Запутывать можно только клетки разных миров",
  "no superposition": "Суперпозиции нет",
  "paused": "Протокол на паузе",
  "not a neutral quantum world": "SWAP доступен только в нейтральных квантовых мирах",
  "bad blocks": "Выберите две разные клетки",
  "weight": "Вероятность должна быть 1–100%",
  "target block has no holder": "У целевой клетки нет владельца",
  "cannot swap with yourself": "Нельзя меняться с самим собой",
  "offer exists": "Такое предложение уже есть",
  "no offer": "Предложения нет",
  "not addressed to you": "Предложение адресовано не вам",
  "already accepted": "Уже принято",
  "expired": "Срок предложения истёк",
  "offerer lost block A": "Предлагающий больше не владеет своей клеткой",
  "not accepted": "Ещё не принято",
  "offer still open": "Предложение ещё действует",
  "neutral worlds need quantum physics": "Нейтральному миру нужны квантовые законы",
  "royalty too high": "Роялти не выше 5%",
  "invalid rule": "Недопустимый закон",
};
export const translate = (m: string) => DICT[m] ?? m;

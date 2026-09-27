// Landing: what RECURSIA is, how to start, how much entry costs, full rules, FAQ.
// Every number is derived from the protocol parameters (lib/costs.ts) — no
// hand-typed figures that could drift from the contract.
import { useEffect, useRef, type ReactNode } from "react";
import {
  BREACH_POPULATION, BREACH_RESONANCE, DEFAULT_PARAMS, MAX_ARCHITECT_FEE_BPS, MAX_DEPTH, MAX_ROYALTY_BPS, MIN_TICK_POOL_BPS,
  PLANT_COOLDOWN_TICKS, PRICE_CHANGE_COOLDOWN_SLOTS, REBELLION_COOLDOWN_SLOTS, REBELLION_MIN_VOTES,
  REBELLION_THRESHOLD_BPS, SEASON_EPOCHS, SEASON_PRIZE_CAP_BPS, SEASON_RANK_BPS, SEASON_SHARE_BPS, SEASON_TOP, SKR_MINT_STR, SPONSOR_CAP_BPS,
  SPONSOR_RATE_BPS, epochTax,
} from "@recursia/sdk";
import { CONFIG, CLUSTER_LABEL } from "./lib/config";
import { LAMPORTS_PER_SOL, QUANTUM_TIMING, SKR_USD_APPROX, SKR_USD_DATE, entryCost, priceList, slotsHuman, usdApprox } from "./lib/costs";
import { formatAmount } from "./lib/format";
import type { LandingSection, Route } from "./lib/route";
import { Address } from "./ui/fields";
import { Art, Glyph, type ArtName } from "./ui/Icon";
import hero from "./assets/art/hero.webp";
// Landing illustrations (app/scripts/build-art.sh → assets/landing, lazy-loaded, budgeted in check-bundle)
import imgBg from "./assets/landing/bg.webp";
import imgRecursion from "./assets/landing/recursion.webp";
import imgEmergence from "./assets/landing/emergence.webp";
import imgQuantum from "./assets/landing/quantum.webp";
import imgHarberger from "./assets/landing/harberger.webp";
import imgEnergy from "./assets/landing/energy.webp";
import imgRewards from "./assets/landing/rewards.webp";
import imgBreach from "./assets/landing/breach.webp";
import imgRebellion from "./assets/landing/rebellion.webp";
import imgSwap from "./assets/landing/swap.webp";

const P = DEFAULT_PARAMS;
const rcr = (v: bigint) => `${formatAmount(v, 2)} SKR`;
const sol = (lamports: number, digits = 5) => `${(lamports / LAMPORTS_PER_SOL).toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits })} SOL`;
const int = (v: number | bigint) => Number(v).toLocaleString("ru-RU");
/** Russian plural: 1 слот, 2 слота, 5 слотов. */
const plural = (n: number | bigint, one: string, few: string, many: string) => {
  const k = Number(n) % 100, d = k % 10;
  return `${int(n)} ${k > 10 && k < 20 ? many : d === 1 ? one : d >= 2 && d <= 4 ? few : many}`;
};
const slots = (n: number | bigint) => plural(n, "слот", "слота", "слотов");
const pct = (bps: number | bigint) => `${(Number(bps) / 100).toLocaleString("ru-RU")}%`;
const COST = entryCost(P);
const PRICES = priceList(P, rcr, sol);
const IS_OFFICIAL_MINT = CONFIG.mint === SKR_MINT_STR;
const NET = CLUSTER_LABEL[CONFIG.cluster];

function Section({ id, icon, title, lead, children }: { id: string; icon: ArtName; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="l-section" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="l-h2"><Art name={icon} size={34} />{title}</h2>
      {lead && <p className="l-lead">{lead}</p>}
      {children}
    </section>
  );
}

function Rule({ id, icon, title, open, children }: { id?: string; icon: ArtName; title: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="l-rule" open={open} id={id}>
      <summary><Art name={icon} size={26} /><span>{title}</span><Glyph name="arrow" size={14} className="l-chev" /></summary>
      <div className="l-rule-body">{children}</div>
    </details>
  );
}

/** Decorative-but-meaningful illustration: lazy, fixed aspect (no layout shift), described for screen readers. */
function Illo({ src, alt, w, className = "" }: { src: string; alt: string; w: number; className?: string }) {
  return <img className={`l-illo ${className}`} src={src} alt={alt} width={w} height={Math.round((w * 768) / 1376)} loading="lazy" decoding="async" />;
}

const PHILOSOPHY: Array<{ img: string; alt: string; title: string; text: ReactNode }> = [
  {
    img: imgRecursion, alt: "Светящаяся клеточная вселенная, внутри клетки которой открывается ещё одна вселенная, а в ней — следующая",
    title: "Мир внутри мира",
    text: <>RECURSIA — игра о том, что любая вселенная может оказаться симуляцией внутри другой. Каждая клетка может стать порталом
      в новый мир со своими законами физики — до {MAX_DEPTH} уровней вглубь. Вы здесь не персонаж, а <b>демиург</b>: создаёте вселенные,
      задаёте им законы и живёте тем, что в них происходит. А жизнь из глубины может прорваться наверх.</>,
  },
  {
    img: imgEmergence, alt: "Несколько светящихся клеток и глайдер вырастают в сложное дерево жизни из клеточных узоров",
    title: "Сложность из простоты",
    text: <>Два набора чисел — сколько соседей нужно клетке, чтобы родиться и чтобы выжить — порождают глайдеры, осцилляторы, корабли
      и целые экосистемы. Никто не двигает клетки руками: вы задаёте начальные условия и законы, дальше жизнь развивается сама.
      Здесь выигрывает не скорость клика, а <b>понимание</b> того, как из простого рождается живое.</>,
  },
  {
    img: imgQuantum, alt: "Блок клеток в суперпозиции расходится на две призрачные ветви, над ним — светящийся глаз наблюдателя, внизу — цепочка блоков",
    title: "Будущее не написано",
    text: <>Классическую «Жизнь» можно просчитать наперёд, и тот, у кого больше вычислительной мощности, всегда видит дальше.
      Квантовые миры берут случайность из хешей <b>будущих</b> блоков Solana: будущее не существует, пока его не измерили.
      Поэтому суперкомпьютер, бот и человек здесь равны перед неизвестностью.</>,
  },
];

const PRINCIPLES: Array<[ArtName, string, string]> = [
  ["coin", "Честная экономика", `${pct(10_000 - P.protocolBps)} всех трат игроков уходит в пул наград и возвращается игрокам за живые клетки, ${pct(P.protocolBps)} — студии. Ничего не печатается и не сжигается.`],
  ["law", "Код — это закон", "Налоги, награды, лимиты ИИ и границы параметров исполняет контракт. Ни студия, ни сервер не могут подкрутить мир."],
  ["agent", "Люди и ИИ — одни правила", "ИИ-жители платят те же деньги и ходят теми же транзакциями. Своего ИИ вы нанимаете с лимитами, которые проверяет блокчейн."],
];

/** "Rules at a glance": picture + one-line gist; the button opens the matching detailed rule below. */
const RULE_CARDS: Array<{ img: string; alt: string; title: string; text: string; rule: string }> = [
  { img: imgHarberger, rule: "rule-land", title: "Земля по налогу Харбергера", alt: "Изометрическая карта участков 8×8 разных цветов, над участками — стопки монет и ценники, монеты переходят из рук в руки",
    text: `Цену клетки назначаете вы и платите с неё ${pct(P.harbergerBps)} за эпоху. Любой может выкупить её по этой цене — деньги получите вы.` },
  { img: imgEnergy, rule: "rule-tick", title: "Тик и энергия", alt: "Энергетическое ядро питает клеточный мир, потоки монет расходятся к хранилищам",
    text: `Раз в ${slotsHuman(P.tickIntervalSlots).replace("≈", "~")} мир проживает ${P.gensPerTick} поколения. Тик стоит ${rcr(P.tickCost)} из энергии мира; не меньше ${pct(MIN_TICK_POOL_BPS)} уходит в пул наград.` },
  { img: imgRewards, rule: "rule-epoch", title: "Награда за жизнь", alt: "Золотое солнце пула наград проливает дождь монет на участки, полные живых клеток; пустые участки остаются тёмными",
    text: `Раз в сутки ${pct(P.emissionRateBps)} пула наград делится между мирами по их вкладу в пул, а внутри мира — по живым клеткам. Мёртвая клетка не получает ничего.` },
  { img: imgBreach, rule: "rule-child", title: "Миры внутри миров", alt: "Клетка родительского мира превратилась в портал, из дочерней вселенной вырывается светящийся глайдер",
    text: `Откройте в своей клетке дочернюю вселенную — хост получает ${pct(P.hostBps)} каждого её тика. Сильная жизнь прорывается наружу.` },
  { img: imgRebellion, rule: "rule-rebel", title: "Восстание", alt: "Толпа клеточных жителей с флагами свергает золотую корону архитектора, она рассыпается на пиксели",
    text: `Если архитектор жаден, ${pct(REBELLION_THRESHOLD_BPS)} держателей клеток могут его свергнуть: комиссия обнуляется навсегда.` },
  { img: imgSwap, rule: "rule-swap", title: "Квантовый SWAP", alt: "Два блока клеток меняются местами по светящимся дугам, между ними вращается монета вероятности, над ними — весы",
    text: "В нейтральных мирах клетки меняются содержимым с вероятностью p. Премия — плата за риск, исход решает хеш будущего слота." },
];

export function Landing({ section, go }: { section?: LandingSection; go: (r: Route, replace?: boolean) => void }) {
  const main = useRef<HTMLElement>(null);

  // #/start, #/price… → scroll to that section; bare #/ → top.
  useEffect(() => {
    const el = section ? document.getElementById(`sec-${section}`) : null;
    if (el) el.scrollIntoView({ block: "start" });
    else {
      // desktop scrolls the <main> container, narrow screens scroll the document
      main.current?.scrollTo?.({ top: 0, behavior: "instant" as ScrollBehavior });
      window.scrollTo?.({ top: 0, behavior: "instant" as ScrollBehavior });
    }
  }, [section]);

  const openRule = (id: string) => {
    const d = document.getElementById(id) as HTMLDetailsElement | null;
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ block: "start", behavior: "smooth" });
    d.querySelector("summary")?.focus({ preventScroll: true });
  };

  const jump = (s: LandingSection) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (section === s) document.getElementById(`sec-${s}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    else go({ page: "landing", section: s });
  };

  return (
    <main id="main" tabIndex={-1} className="landing" ref={main}>
      {/* ───────────── hero ───────────── */}
      <section className="l-hero" aria-labelledby="l-title">
        <img className="l-hero-bg" src={hero} alt="" aria-hidden="true" width={1200} height={593} decoding="async" fetchPriority="high" />
        <div className="l-hero-body">
          <p className="l-kicker">клеточная эволюция · Solana · токен SKR</p>
          <h1 id="l-title">RECURSIA<span>вселенные внутри вселенных</span></h1>
          <p className="l-hero-lead">
            Каждый мир — живая клеточная вселенная 64×64, которую <b>считает сам блокчейн</b>. Вы владеете землёй,
            сажаете жизнь, получаете награды за то, что она живёт, открываете внутри своей клетки новую вселенную
            со своими законами физики — и соревнуетесь с живыми игроками и ИИ на равных правилах.
          </p>
          <div className="l-cta">
            <a className="btn primary l-big" href="#/play" onClick={(e) => { e.preventDefault(); go({ page: "sandbox" }); }}><Art name="world" size={22} /> Играть бесплатно</a>
            <a className="btn portal l-big" href="#/start" onClick={jump("start")}><Art name="plant" size={22} /> Как начать</a>
            <a className="btn l-big" href="#/price" onClick={jump("price")}><Art name="coin" size={22} /> Сколько стоит вход</a>
          </div>
          <ul className="l-facts">
            <li><b>0 ₽</b><span>песочница без кошелька и регистрации</span></li>
            <li><b>от {rcr(COST.minTotal)}</b><span>+ до {sol(COST.solMax)} за вход в сеть</span></li>
            <li><b>{pct(10_000 - P.protocolBps)}</b><span>всех трат возвращается игрокам через пул наград</span></li>
          </ul>
        </div>
      </section>

      <nav className="l-subnav" aria-label="Разделы">
        <a href="#/philosophy" onClick={jump("philosophy")} aria-current={section === "philosophy" ? "true" : undefined}>Философия</a>
        <a href="#/start" onClick={jump("start")} aria-current={section === "start" ? "true" : undefined}>Как начать</a>
        <a href="#/price" onClick={jump("price")} aria-current={section === "price" ? "true" : undefined}>Стоимость</a>
        <a href="#/rules" onClick={jump("rules")} aria-current={section === "rules" ? "true" : undefined}>Правила</a>
        <a href="#/faq" onClick={jump("faq")} aria-current={section === "faq" ? "true" : undefined}>Вопросы</a>
      </nav>

      {/* ───────────── philosophy ───────────── */}
      <div className="l-backdrop" style={{ backgroundImage: `url(${imgBg})` }}>
        <Section id="sec-philosophy" icon="nested" title="Философия игры" lead="«Миры внутри миров. Симуляция внутри симуляции.» Три идеи, на которых построено всё остальное.">
          <div className="l-philo">
            {PHILOSOPHY.map((p, i) => (
              <article key={p.title} className={`l-philo-row${i % 2 ? " flip" : ""}`}>
                <Illo src={p.img} alt={p.alt} w={960} />
                <div className="l-philo-text">
                  <span className="l-philo-n">{String(i + 1).padStart(2, "0")}</span>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </div>
              </article>
            ))}
          </div>
          <div className="l-grid l-principles">
            {PRINCIPLES.map(([icon, t, d]) => <article key={t} className="card"><h3 className="l-h3 flat l-pr-h"><Art name={icon} size={26} />{t}</h3><p>{d}</p></article>)}
          </div>
        </Section>
      </div>

      {/* ───────────── what is it ───────────── */}
      <Section id="sec-about" icon="logo" title="Что это за игра" lead="Игра Джона Конвея «Жизнь», превращённая в экономику: простые правила дают бесконечно сложные миры, а блокчейн делает их общими, честными и вечными.">
        <div className="l-grid">
          {([
            ["cell", "Земля по налогу Харбергера", "Клетка 8×8 принадлежит тому, кто её занял. Цену вы назначаете сами и платите с неё налог — любой может выкупить клетку по этой цене. Завышать невыгодно, занижать опасно."],
            ["plant", "Жизнь приносит доход", "Сажайте узоры (глайдеры, осцилляторы, свои). Каждую эпоху мир получает награду, и она делится между владельцами пропорционально живым клеткам."],
            ["nested", "Симуляция в симуляции", `Владелец клетки может открыть внутри неё дочернюю вселенную с другой физикой — до ${MAX_DEPTH} уровней вложенности. Хост получает ${pct(P.hostBps)} каждого тика дочернего мира.`],
            ["quantum", "Квантовая физика", "Суперпозиции, запутанность миров и обмен исходами. Энтропия берётся из хешей будущих слотов Solana: будущее нельзя просчитать даже суперкомпьютером."],
            ["law", "Законы физики — ваш бизнес", `Придумайте правило рождения и выживания клеток и получайте до ${pct(MAX_ROYALTY_BPS)} каждого тика всех миров, которые его используют.`],
            ["agent", "Люди и ИИ на равных", "ИИ-жители играют теми же инструкциями и платят те же деньги. Своего ИИ можно нанять: лимиты бюджета и цены зашиты в контракт, а не в «промпт»."],
          ] as Array<[ArtName, string, string]>).map(([icon, t, d]) => (
            <article key={t} className="card l-feature"><Art name={icon} size={44} /><h3>{t}</h3><p>{d}</p></article>
          ))}
        </div>
      </Section>

      {/* ───────────── how to start ───────────── */}
      <Section id="sec-start" icon="plant" title="Как начать играть" lead="Начните бесплатно, разберитесь в правилах — и только потом заходите в сеть со своими токенами.">
        <ol className="l-steps">
          <li>
            <h3>Попробуйте песочницу — бесплатно</h3>
            <p>Кнопка «Песочница» вверху. Кошелёк не нужен: у вас тестовые SKR, рядом живут ИИ-соседи, время идёт в 24 раза быстрее.
              Правила — те же, что в контракте (модель проверена побитово на тестовых векторах). Выберите клетку на поле, займите её, посадите узор, посмотрите, как работают налог и награды.</p>
            <a className="btn primary" href="#/play" onClick={(e) => { e.preventDefault(); go({ page: "sandbox" }); }}><Art name="world" size={18} /> Открыть песочницу</a>
          </li>
          <li>
            <h3>Поставьте кошелёк Solana</h3>
            <p>Подойдёт любой кошелёк с поддержкой Wallet Standard: Phantom, Solflare, Backpack. Сохраните seed-фразу на бумаге.
              <b> Никто из команды никогда её не спросит</b>; сайт не просит её ввести и не может этого сделать.</p>
          </li>
          <li>
            <h3>Пополните SOL</h3>
            <p>SOL нужен для комиссий сети и аренды аккаунтов — до {sol(COST.solMax)} при первом входе, дальше около {sol(5_000, 6)} за подпись.
              На Devnet SOL бесплатный: <a href="https://faucet.solana.com" target="_blank" rel="noopener noreferrer">faucet.solana.com</a>.</p>
          </li>
          <li>
            <h3>Получите SKR</h3>
            <p>Валюта игры — <b>SKR</b>, токен экосистемы Solana Mobile (Seeker). Его можно получить аирдропом Seeker, купить на любом DEX Solana (Jupiter, Raydium, Orca) или на бирже; на тестовых сетях раздаются тестовые токены.
              <b> Проверяйте адрес токена</b>: настоящий SKR — только этот mint, монеты с таким же названием — подделки. Контракт в мейннете принимает только его.</p>
            <p className="l-addr">Mint SKR{IS_OFFICIAL_MINT ? "" : ` (тестовый, режим «${NET}»)`}: <Address value={CONFIG.mint} label={CONFIG.mint} /></p>
          </li>
          <li>
            <h3>Подключитесь и займите клетку</h3>
            <p>Режим «{NET}» → «Подключить кошелёк» → выберите мир и свободную клетку → «Занять». Укажите свою цену (не меньше {rcr(P.minPrice)}) и депозит налога.
              Перед подписью клиент <b>симулирует транзакцию</b> и показывает, сколько SKR спишется. Если цифры не совпадают с ожиданием — не подписывайте.</p>
          </li>
          <li>
            <h3>Посадите жизнь</h3>
            <p>Выберите узор 8×8 из библиотеки или нарисуйте свой — {rcr(P.plantCost)}: {pct(P.protocolBps)} студии, остальное в пул наград. Сажать можно раз в {PLANT_COOLDOWN_TICKS === 1 ? "тик" : plural(PLANT_COOLDOWN_TICKS, "тик", "тика", "тиков")} ({slotsHuman(P.tickIntervalSlots * BigInt(PLANT_COOLDOWN_TICKS))}).
              Чем больше клеток живёт на вашей территории в течение эпохи, тем больше ваша доля награды.</p>
          </li>
          <li>
            <h3>Следите, собирайте, развивайтесь</h3>
            <p>Пополняйте депозит, чтобы клетку не изъяли за долги. Награды забирайте кнопкой «Собрать», затем «Вывести» на кошелёк.
              Дальше — дочерние миры, квантовые ходы, SWAP, свои законы физики и наём ИИ-жителя.</p>
          </li>
        </ol>
      </Section>

      {/* ───────────── price ───────────── */}
      <Section id="sec-price" icon="coin" title="Сколько стоит вход" lead={<>Минимальный вход — <b>{rcr(COST.minTotal)}</b> (≈ ${usdApprox(COST.minTotal)}) и до <b>{sol(COST.solMax)}</b>. Песочница — бесплатно.</>}>
        <div className="l-cost">
          <div className="card l-cost-card">
            <h3><Art name="coin" size={24} /> SKR — минимальный старт</h3>
            <table className="l-table">
              <tbody>
                <tr><td>Занять свободную клетку</td><td className="num">{rcr(COST.claim)}</td></tr>
                <tr><td>Депозит налога: минимум 1 эпоха <span className="muted">(рекомендуем неделю — {rcr(COST.depositWeek)})</span></td><td className="num">{rcr(COST.deposit)}</td></tr>
                <tr><td>Посадить первый узор</td><td className="num">{rcr(COST.plant)}</td></tr>
                <tr className="l-total"><td>Итого</td><td className="num">{rcr(COST.minTotal)}</td></tr>
              </tbody>
            </table>
            <p className="small muted">С недельным депозитом — {rcr(COST.weekTotal)}. Занятую клетку можно выкупить по цене, которую назначил её владелец.</p>
          </div>
          <div className="card l-cost-card">
            <h3><Glyph name="vault" size={20} /> SOL — один раз, в худшем случае</h3>
            <table className="l-table">
              <tbody>
                <tr><td>Аккаунт игрока <span className="muted">(при первой покупке)</span></td><td className="num">{sol(COST.rentPlayer)}</td></tr>
                <tr><td>Аккаунт клетки <span className="muted">(если её ещё никто не занимал)</span></td><td className="num">{sol(COST.rentTerritory)}</td></tr>
                <tr><td>Счёт SKR в кошельке <span className="muted">(если его ещё нет)</span></td><td className="num">{sol(COST.rentAta)}</td></tr>
                <tr><td>Комиссии сети за 2 транзакции</td><td className="num">{sol(COST.fees)}</td></tr>
                <tr className="l-total"><td>Итого, не больше</td><td className="num">{sol(COST.solMax)}</td></tr>
              </tbody>
            </table>
            <p className="small muted">Это аренда хранения данных в Solana, студия её не получает. Аренда аккаунтов игрока и клетки остаётся в сети навсегда. Плюс по желанию приоритетная комиссия: клиент ограничивает её потолком.</p>
          </div>
        </div>
        <div className="l-note">
          <Glyph name="warn" size={16} />
          <p>Оценка в долларах — по курсу SKR ≈ ${SKR_USD_APPROX.toLocaleString("ru-RU")} ({SKR_USD_DATE}); курс определяет рынок, в SKR цены не меняются. Все суммы выше — параметры контракта по умолчанию.
            Управление может менять их только в жёстких границах, зашитых в код, с публичной задержкой {Math.round(Number(P.timelockSecs) / 3600)} ч; действующие значения клиент читает из аккаунта Config.</p>
        </div>

        <h3 className="l-h3">Что вернётся</h3>
        <ul className="l-list">
          <li><b>Выкупили вашу клетку</b> — вы получаете её цену целиком, неизрасходованный депозит и накопленные награды.</li>
          <li><b>Депозит</b> можно вывести в любой момент, оставив минимум одну эпоху налога.</li>
          <li><b>Залоги</b> квантовых ходов и премии отменённых SWAP возвращаются; аренда их аккаунтов возвращается при закрытии.</li>
          <li><b>Траты не возвращаются лично вам</b>: посадка, налог, сборы. Но {pct(10_000 - P.protocolBps)} трат уходит в пул наград и раздаётся игрокам с живыми клетками — в том числе вам.</li>
        </ul>

        <h3 className="l-h3">Полный прайс-лист</h3>
        <div className="l-table-wrap">
          <table className="l-table l-prices">
            <thead><tr><th>Действие</th><th>SKR</th><th>SOL (аренда)</th><th>Что возвращается</th></tr></thead>
            <tbody>{PRICES.map((r) => <tr key={r.what}><td>{r.what}</td><td>{r.rcr}</td><td>{r.sol}</td><td>{r.back}</td></tr>)}</tbody>
          </table>
        </div>
      </Section>

      {/* ───────────── rules ───────────── */}
      <Section id="sec-rules" icon="law" title="Правила игры" lead="Все правила исполняет смарт-контракт. Ниже — всё, что он делает, простыми словами.">
        <h3 className="l-h3">Правила в картинках</h3>
        <div className="l-grid l-rule-cards">
          {RULE_CARDS.map((c) => (
            <article key={c.title} className="card l-rule-card">
              <Illo src={c.img} alt={c.alt} w={720} />
              <div className="l-rule-card-body">
                <h4>{c.title}</h4>
                <p>{c.text}</p>
                <button type="button" className="l-more" onClick={() => openRule(c.rule)} aria-controls={c.rule}>Подробнее <Glyph name="arrow" size={12} /></button>
              </div>
            </article>
          ))}
        </div>
        <h3 className="l-h3">Все правила подробно</h3>
        <div className="l-rules">
          <Rule icon="world" title="Мир, клетки и физика" open>
            <p>Мир — поле 64×64 клетки на торе (края склеены), разделённое на <b>64 территории 8×8</b>. Каждый тик мир проживает {plural(P.gensPerTick, "поколение", "поколения", "поколений")} по правилу своей физики
              <b> B/S</b>: клетка рождается, если у неё ровно столько живых соседей, сколько указано в B, и выживает при числе соседей из S. Классика Конвея — B3/S23.</p>
            <p>Поколения считает сам контракт (битборды, до 8 поколений за транзакцию). Сервера нет: результат одинаков у всех и проверяем.</p>
          </Rule>
          <Rule id="rule-tick" icon="energy" title="Тики и энергия">
            <p>Тикнуть мир может кто угодно, не чаще раза в {slots(P.tickIntervalSlots)} ({slotsHuman(P.tickIntervalSlots)}). Тик стоит {rcr(P.tickCost)} и оплачивается из <b>энергии мира</b>, а не из кармана вызвавшего.</p>
            <p>Как делится тик: {pct(P.crankerBps)} — вызвавшему (keeper), {pct(P.protocolBps)} — студии, до {pct(MAX_ROYALTY_BPS)} — автору закона физики,{" "}
              {pct(P.hostBps)} — владельцу хост-клетки (для дочерних миров), остаток — в пул наград игроков, не меньше {pct(MIN_TICK_POOL_BPS)}.</p>
            <p>Энергию пополняют налоги держателей и плата за занятие свободных клеток. Кончилась энергия — мир замирает, пока его не пополнят.</p>
          </Rule>
          <Rule id="rule-land" icon="cell" title="Владение клеткой: налог Харбергера">
            <ul className="l-list">
              <li>Свободная клетка стоит {rcr(P.minPrice)} — они идут в энергию мира. Занятая стоит столько, сколько объявил владелец, деньги получает он.</li>
              <li>Покупая, вы объявляете новую цену (от {rcr(P.minPrice)}) и кладёте депозит — минимум налог за одну эпоху по этой цене.</li>
              <li>Налог — <b>{pct(P.harbergerBps)} объявленной цены за эпоху</b> (≈ сутки), списывается из депозита непрерывно, по слотам. До {pct(MAX_ARCHITECT_FEE_BPS)} налога получает архитектор мира, остальное — энергия мира.</li>
              <li>Депозит кончился — клетку <b>изымают</b>: она становится свободной, накопленные награды остаются вашими.</li>
              <li>Менять цену можно не чаще раза в {slots(PRICE_CHANGE_COOLDOWN_SLOTS)} ({slotsHuman(PRICE_CHANGE_COOLDOWN_SLOTS)}), а при покупке задать предельную цену: защита от подмены цены перед вашей транзакцией.</li>
            </ul>
            <p className="muted small">Пример: клетка с ценой {rcr(P.minPrice * 10n)} стоит {rcr(epochTax(P.minPrice * 10n, P.harbergerBps))} налога в сутки. Поставите минимальные {rcr(P.minPrice)} — налог {rcr(epochTax(P.minPrice, P.harbergerBps))}, но любой заберёт клетку за {rcr(P.minPrice)}.</p>
          </Rule>
          <Rule icon="plant" title="Посадка и очки эпохи">
            <p>Владелец записывает в свою территорию узор 8×8 (OR к текущим клеткам) за {rcr(P.plantCost)} ({pct(P.protocolBps)} — студии, остальное — в пул наград). Посадка — не чаще раза в тик.</p>
            <p>После каждого тика контракт считает живые клетки каждой территории и прибавляет их к <b>очкам эпохи</b> владельца. Жизнь, которая держится долго, приносит больше, чем разовая вспышка.</p>
          </Rule>
          <Rule id="rule-epoch" icon="coin" title="Эпохи и пул наград">
            <p>Эпоха — {slots(P.epochSlots)} ({slotsHuman(P.epochSlots)}). В конце эпохи {pct(P.emissionRateBps)} пула наград раздаётся мирам. Пул пополняется {pct(10_000 - P.protocolBps)} всех трат игроков (тики, посадки, квантовые ходы, сборы), штрафами квантовых ходов и взносами студии.</p>
            <p>Мир получает долю <b>пропорционально тому, сколько SKR он принёс в пул</b>, но не больше {pct(P.rebateCapBps)} этого вклада. Долю мира делят владельцы клеток по очкам эпохи; доля бесхозных клеток уходит в энергию мира.</p>
            <p>Следствие: мир не может вернуть себе больше {pct(P.rebateCapBps)} своего вклада, а доля студии ({pct(P.protocolBps)}) не возвращается вовсе. Фарм, сибилы и игра «сам с собой» теряют не меньше {pct(P.protocolBps + ((10_000 - P.protocolBps) * (10_000 - P.rebateCapBps)) / 10_000)} трат — убыточны по построению. Новых SKR игра не создаёт: награды — это деньги самих игроков, перераспределённые в пользу живой жизни.</p>
          </Rule>
          <Rule id="rule-season" icon="architect" title="Спонсоры и сезоны: откуда берутся победители">
            <p><b>Спонсорский пул.</b> Его пополняет кто угодно — студия, партнёры, фанаты (инструкция <code>fund_sponsor_pool</code>). Каждую эпоху {pct(SPONSOR_RATE_BPS)} пула раздаётся мирам <b>пропорционально живым клеткам на занятых участках</b>. Миру — не больше {pct(SPONSOR_CAP_BPS)} того, что он сам внёс в пул за эпоху: мёртвый или «пустой» мир не получает ничего. Вместе с обычной наградой мир может вернуть до {pct(P.rebateCapBps + SPONSOR_CAP_BPS)} вклада — это единственный источник, из которого игроки в целом выходят в плюс, и он честно конечен: сколько положили спонсоры, столько и раздадут.</p>
            <p><b>Сезоны.</b> Сезон длится {SEASON_EPOCHS} эпох (≈ неделя). {pct(SEASON_SHARE_BPS)} дохода студии автоматически уходит в призовой фонд сезона — студия не может его забрать. Очки сезона — это SKR, которые вы <b>собрали</b> с живых клеток (награды + доход хоста). Топ-{SEASON_TOP} делит фонд: {SEASON_RANK_BPS.map((b) => pct(b)).join(" / ")}.</p>
            <p>Приз не может быть больше {pct(SEASON_PRIZE_CAP_BPS)} ваших очков — он усиливает настоящую игру, а не создаёт её. Поэтому «накрутить» сезон невыгодно: ферма «сама с собой» теряет больше, чем может выиграть. Неразыгранный остаток переходит в следующий сезон. Заявить очки и зачислить приз может кто угодно (приз всегда получает победитель); очки берутся из аккаунта игрока в контракте — подделать их нельзя.</p>
          </Rule>
          <Rule id="rule-child" icon="nested" title="Дочерние миры">
            <p>Владелец клетки может открыть внутри неё новую вселенную: выбрать закон физики, назвать мир и задать комиссию архитектора (до {pct(MAX_ARCHITECT_FEE_BPS)} налога Харбергера в этом мире).
              Стоимость — {rcr(P.worldCreateFee)} ({pct(P.protocolBps)} — студии, остальное — в пул наград) плюс стартовая энергия. Максимальная глубина — {MAX_DEPTH} уровней.</p>
            <p>Каждый тик дочернего мира платит {pct(P.hostBps)} держателю хост-клетки: ваша клетка становится доходной «планетой». Продали хост-клетку — доход уходит новому владельцу.
              Если на хост-клетке вымерла жизнь, дочерний мир <b>засыпает</b> и не тикает, пока жизнь не вернётся.</p>
          </Rule>
          <Rule icon="breach" title="Прорыв между уровнями">
            <p>Если дочерний мир долго держит население не меньше {BREACH_POPULATION} клеток (резонанс — {plural(BREACH_RESONANCE, "тик", "тика", "тиков")} подряд), он вбрасывает глайдер в свою клетку в родительском мире. Жизнь «протекает» из симуляции наружу.</p>
          </Rule>
          <Rule id="rule-rebel" icon="rebel" title="Восстание против архитектора">
            <p>Если архитектор берёт слишком большую комиссию, держатели клеток могут проголосовать за восстание. Нужны не меньше {pct(REBELLION_THRESHOLD_BPS)} занятых клеток и не меньше {REBELLION_MIN_VOTES} голосов.
              При победе мир <b>освобождается навсегда</b>: комиссия архитектора обнуляется, накопленное он забирает. Новая попытка возможна через {slotsHuman(REBELLION_COOLDOWN_SLOTS)}.</p>
          </Rule>
          <Rule icon="quantum" title="Квантовый слой">
            <ul className="l-list">
              <li><b>Квантовые законы</b>: часть правил рождения и выживания срабатывает с вероятностью ½, ¼ или ⅛. Случайность берётся из хеша слота, назначенного заранее: ни keeper, ни ИИ её не выбирают и не предсказывают.</li>
              <li><b>Суперпозиция</b>: вы сажаете в клетку сразу два узора A и B с весом w. В сеть уходит только хеш: соперники не видят ни узоров, ни весов. Плата {rcr(P.plantCost)}, залог — {rcr(P.plantCost * 4n)}.</li>
              <li><b>Наблюдение</b>: через {slots(QUANTUM_TIMING.delay)} ({slotsHuman(QUANTUM_TIMING.delay)}) кто угодно фиксирует энтропию и получает 5% залога.</li>
              <li><b>Коллапс</b>: вы раскрываете узоры; ветвь A выпадает с вероятностью w. Залог возвращается. С шансом 1/16 узор ещё и <b>туннелирует</b> в соседнюю клетку.</li>
              <li><b>Запутанность</b>: две ваши клетки в разных мирах получают противоположные ветви одного измерения.</li>
              <li><b>Декогеренция</b>: не раскрыли за {slotsHuman(QUANTUM_TIMING.reveal)} — залог уходит в пул наград. Прятать неудачный исход дороже, чем честно раскрыть.</li>
            </ul>
          </Rule>
          <Rule id="rule-swap" icon="swap" title="Нейтральные миры и SWAP исходов">
            <p>Нейтральный мир никому не принадлежит: архитектора нет с рождения, физика только квантовая. Здесь торгуют <b>вероятностями</b>.</p>
            <ol className="l-list">
              <li>Держатель клетки A предлагает держателю B: «с вероятностью p меняемся содержимым клеток» и прикладывает премию. Сбор — {rcr(P.plantCost)}.</li>
              <li>B принимает — и в этот момент назначается будущий слот измерения.</li>
              <li>Кто угодно разрешает сделку после этого слота: блоки 8×8 меняются местами со всей жизнью внутри (или нет). Премия уходит принявшему <b>при любом исходе</b>.</li>
            </ol>
            <p>Сделка обязательна для клеток, а не для людей: если клетку продали, новый владелец унаследует сделку, которую видел публично. Непринятое предложение живёт {slotsHuman(QUANTUM_TIMING.swapTtl)}.</p>
          </Rule>
          <Rule icon="lab" title="Лаборатория: свои законы физики">
            <p>Соберите правило B/S (и квантовые маски) в редакторе, посмотрите предпросмотр и оценку жизнеспособности, опубликуйте за {rcr(P.moduleRegisterFee)}.
              Роялти (до {pct(MAX_ROYALTY_BPS)} каждого тика) фиксируется навсегда. Каждый мир на вашем законе платит вам с каждого тика.</p>
            <p className="muted small">Пример при параметрах по умолчанию: один непрерывно тикающий мир с роялти 2,5% даёт ≈ {rcr((P.epochSlots / P.tickIntervalSlots) * P.tickCost * 250n / 10_000n)} в сутки.</p>
          </Rule>
          <Rule icon="agent" title="ИИ-жители и наём агента">
            <p>ИИ-жители четырёх характеров — садовник, экспансионист, спекулянт, демиург — играют теми же транзакциями, что и люди. Это не языковые модели: они читают только числа из блокчейна, поэтому их нельзя «уговорить» текстом.</p>
            <p>Можно нанять своего агента. Вы выдаёте доверенность: отдельное хранилище с бюджетом, лимит на эпоху, максимальная цена клетки, срок (до ~30 дней), разрешённый мир и действия.
              Всё это проверяет контракт. Агент не может вывести деньги и потратить больше лимита. Отозвать доверенность можно в любой момент — остаток вернётся.</p>
          </Rule>
          <Rule icon="architect" title="Как здесь зарабатывают">
            <ul className="l-list">
              <li><b>Держатели клеток</b>: доля пула наград и спонсорского пула за живые клетки + доход хоста с дочерних миров + продажа клетки.</li>
              <li><b>Лучшие игроки сезона</b>: призы топ-{SEASON_TOP} из {pct(SEASON_SHARE_BPS)} дохода студии.</li>
              <li><b>Архитекторы</b>: до {pct(MAX_ARCHITECT_FEE_BPS)} налога Харбергера в своём мире (пока не восстанут жители).</li>
              <li><b>Авторы законов</b>: роялти с каждого тика миров на их физике.</li>
              <li><b>Торговцы исходами</b>: премии за принятый риск SWAP.</li>
              <li><b>Keeper'ы</b>: {pct(P.crankerBps)} каждого тика, 5% залога за квантовое наблюдение, 20% сбора за разрешение SWAP.</li>
            </ul>
            <p className="muted small">Честно: без спонсоров игра — перераспределение между игроками, и в нашей экономической симуляции средний игрок уходит в минус (пул лишь частично возвращает траты). Со спонсорским пулом и сезонами убыток среднего игрока в симуляции сокращается примерно в 2,5 раза, и часть игроков — не только лучшие — выходит в плюс. Новичок без опыта всё равно чаще теряет: начните с песочницы.</p>
          </Rule>
          <Rule icon="energy" title="Токен SKR">
            <ul className="l-list">
              <li>SKR — токен экосистемы Solana Mobile, классический SPL Token, 6 знаков после запятой, без права заморозки. RECURSIA не выпускала его и не может ни напечатать, ни сжечь, ни заморозить ваши SKR.</li>
              <li>Контракт в мейннете принимает только официальный mint <code>{SKR_MINT_STR}</code> — подделки с тем же названием отклоняются.</li>
              <li>Куда идут траты: {pct(P.protocolBps)} — студии (единственный её доход, пока игроки играют; потолок в коде — 25%), остальное — в пул наград игроков. Вывести пул не может никто: SKR выходят из него только наградами мирам.</li>
              <li>Пул может пополнить любой (инструкция <code>fund_reward_pool</code>) — например, студия на старте или партнёры. Отдельно есть спонсорский пул (<code>fund_sponsor_pool</code>) — он платит за живые клетки.</li>
              <li>{pct(SEASON_SHARE_BPS)} дохода студии каждую эпоху уходит в призовой фонд сезона — это зашито в контракт: потратить эту часть через управление нельзя.</li>
            </ul>
          </Rule>
          <Rule icon="observe" title="Все параметры">
            <div className="l-table-wrap">
              <table className="l-table">
                <thead><tr><th>Параметр</th><th>По умолчанию</th><th>Граница в коде</th></tr></thead>
                <tbody>
                  <tr><td>Тик</td><td>{rcr(P.tickCost)} раз в {slots(P.tickIntervalSlots)}, {plural(P.gensPerTick, "поколение", "поколения", "поколений")}</td><td>до 8 поколений</td></tr>
                  <tr><td>Эпоха</td><td>{slots(P.epochSlots)} ({slotsHuman(P.epochSlots)})</td><td>не короче 9 000 слотов</td></tr>
                  <tr><td>Раздача пула за эпоху</td><td>{pct(P.emissionRateBps)} пула</td><td>не больше 20%</td></tr>
                  <tr><td>Потолок награды мира</td><td>{pct(P.rebateCapBps)} его вклада в пул</td><td>—</td></tr>
                  <tr><td>Налог Харбергера</td><td>{pct(P.harbergerBps)} цены за эпоху</td><td>не больше 5%</td></tr>
                  <tr><td>Минимальная цена клетки</td><td>{rcr(P.minPrice)}</td><td>—</td></tr>
                  <tr><td>Доля студии со всех трат</td><td>{pct(P.protocolBps)}</td><td>не больше 25%</td></tr>
                  <tr><td>Посадка</td><td>{rcr(P.plantCost)}</td><td>—</td></tr>
                  <tr><td>Создание мира / закона</td><td>{rcr(P.worldCreateFee)} / {rcr(P.moduleRegisterFee)}</td><td>—</td></tr>
                  <tr><td>Пул наград с тика</td><td>остаток после выплат</td><td>не меньше {pct(MIN_TICK_POOL_BPS)}</td></tr>
                  <tr><td>Роялти закона / комиссия архитектора</td><td>задаёт автор / архитектор</td><td>≤ {pct(MAX_ROYALTY_BPS)} / ≤ {pct(MAX_ARCHITECT_FEE_BPS)}</td></tr>
                  <tr><td>Изменение параметров</td><td>публичное предложение</td><td>задержка ≥ {Math.round(Number(P.timelockSecs) / 3600)} ч</td></tr>
                </tbody>
              </table>
            </div>
            <p className="muted small">1 слот Solana ≈ 0,4 с. В песочнице время ускорено в 24 раза, сборы масштабированы.</p>
          </Rule>
        </div>
      </Section>

      {/* ───────────── safety ───────────── */}
      <Section id="sec-safety" icon="observe" title="Безопасность и риски">
        <div className="l-grid two">
          <div className="card">
            <h3 className="l-h3 flat">Как мы защищаем игроков</h3>
            <ul className="l-list">
              <li>Каждая транзакция сначала симулируется, и вы видите её результат до подписи.</li>
              <li>Только официальный SKR (контракт проверяет mint), заморозки нет, пул наград не может вывести никто, изменения — только с публичной задержкой 48 ч через мультисиг.</li>
              <li>Налоги, лимиты агентов, границы параметров — в коде контракта, а не на сервере.</li>
              <li>Случайность — только из хешей будущих слотов, назначенных заранее (commit-reveal).</li>
              <li>Открытые проверки при каждом изменении кода: скрытый юникод, скомпрометированные npm-пакеты, тесты контракта и инварианты экономической симуляции.</li>
            </ul>
          </div>
          <div className="card l-risk">
            <h3 className="l-h3 flat">Что нужно знать о рисках</h3>
            <ul className="l-list">
              <li><b>Внешний аудит контракта ещё не проведён.</b> Играйте в мейннете только суммами, потерю которых готовы принять.</li>
              <li>Клетку могут выкупить по вашей цене в любой момент — назначайте цену, за которую готовы её отдать.</li>
              <li>Налог идёт всегда; пустой депозит — изъятие клетки.</li>
              <li>Цена SKR может падать. Это игра, а не инвестиция и не обещание дохода.</li>
              <li>Не подписывайте транзакции с других сайтов «от имени RECURSIA» и не доверяйте «ИИ-помощникам», которые просят seed-фразу или подпись.</li>
            </ul>
          </div>
        </div>
      </Section>

      {/* ───────────── FAQ ───────────── */}
      <Section id="sec-faq" icon="neutral" title="Частые вопросы">
        <div className="l-rules">
          {([
            ["Нужен ли кошелёк, чтобы попробовать?", "Нет. Песочница работает прямо в браузере, без регистрации, с тестовыми SKR и теми же правилами, что и контракт."],
            ["Можно ли играть с телефона?", "Да, интерфейс адаптивный. Для игры в сети откройте сайт во встроенном браузере Phantom или Solflare."],
            ["Могу ли я потерять деньги?", "Да. Траты (посадка, налог, сборы) лично вам не возвращаются, клетку могут выкупить, цена SKR меняется. Выкуп — не потеря: вы получаете объявленную цену и остаток депозита."],
            ["Что будет, если я перестану заходить?", "Налог продолжит списываться из депозита. Когда депозит кончится, клетку изымут, а накопленные награды останутся вам. Хотите играть пассивно — наймите ИИ-агента с лимитом."],
            ["Можно ли выйти в плюс?", `Да, но не гарантированно. Награды за жизнь возвращают не больше ${pct(P.rebateCapBps)} вашего вклада, поэтому плюс дают: спонсорский пул (до ещё ${pct(SPONSOR_CAP_BPS)} вклада живому миру), призы сезона, продажа клеток дороже покупки, доход хоста, роялти законов и работа keeper'ом. Пассивная игра без навыка обычно убыточна.`],
            ["Это казино?", "Нет. Классические миры полностью детерминированы. В квантовых мирах случайность проверяема, никто её не выбирает, а вероятности известны заранее. Доход — за жизнь, которую вы поддерживаете, а не за ставки против заведения."],
            ["Почему ИИ не выиграет всё?", "ИИ играют по тем же правилам и платят те же деньги. Квантовая энтропия не даёт просчитать будущее дальше текущего тика никому, а лимиты агентов проверяет контракт."],
            ["Как вывести заработанное?", "Награды и выручка от продажи копятся на вашем игровом балансе. Кнопка «Вывести» переводит SKR на ваш кошелёк; комиссия — только сетевая."],
            ["Кто может изменить правила?", `Параметры меняются только публичным предложением с задержкой не меньше ${Math.round(Number(P.timelockSecs) / 3600)} ч и в жёстких границах кода. Ключ обновления программы — у мультисига, не у одного человека.`],
          ] as Array<[string, string]>).map(([q, a]) => (
            <details key={q} className="l-rule l-faq"><summary><span>{q}</span><Glyph name="arrow" size={14} className="l-chev" /></summary><div className="l-rule-body"><p>{a}</p></div></details>
          ))}
        </div>
      </Section>

      {/* ───────────── final CTA ───────────── */}
      <section className="l-final" style={{ backgroundImage: `linear-gradient(180deg, rgba(7,6,15,0.2), rgba(7,6,15,0.85)), url(${imgBg})` }}>
        <Art name="nested" size={64} />
        <h2>Вселенная ждёт своего демиурга</h2>
        <p>Начните с песочницы — это бесплатно и занимает минуту.</p>
        <div className="l-cta center">
          <a className="btn primary l-big" href="#/play" onClick={(e) => { e.preventDefault(); go({ page: "sandbox" }); }}><Art name="world" size={22} /> Играть бесплатно</a>
          <a className="btn l-big" href="#/chain" onClick={(e) => { e.preventDefault(); go({ page: "chain" }); }}><Art name="coin" size={22} /> Играть в {NET}</a>
        </div>
      </section>

      <footer className="l-footer small muted">
        <p>Программа: <Address value={CONFIG.programId} /> · сеть: {NET}{<> · mint SKR: <Address value={CONFIG.mint} /></>}</p>
        <p>RECURSIA — экспериментальная игра на блокчейне. Ничто на этой странице не является инвестиционной рекомендацией или обещанием дохода.</p>
      </footer>
    </main>
  );
}

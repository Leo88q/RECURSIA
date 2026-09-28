// Human-readable (Russian) explanations for every failure a player can hit.
// Order of PROGRAM_ERRORS MUST equal `enum RecursiaError` in
// programs/recursia/src/errors.rs (Anchor numbers them 6000 + index) — a unit
// test parses the Rust file and fails CI on any drift.

export const ANCHOR_ERROR_OFFSET = 6000;

export const PROGRAM_ERRORS: ReadonlyArray<readonly [name: string, ru: string]> = [
  ["MathOverflow", "Арифметическое переполнение — сумма слишком велика"],
  ["Paused", "Протокол на паузе: новые действия временно недоступны, вывод средств работает"],
  ["BadMint", "Это не SKR: неверный mint, decimals или есть freeze authority"],
  ["ZeroAmount", "Сумма должна быть больше нуля"],
  ["InvalidParams", "Параметр вне допустимых границ"],
  ["TimelockActive", "Таймлок ещё не истёк"],
  ["NoPendingAction", "Нет ожидающего действия управления"],
  ["ActionAlreadyPending", "Уже есть ожидающее действие управления"],
  ["Unauthorized", "Недостаточно прав для этого действия"],
  ["CpiForbidden", "Вызов через другую программу запрещён — только прямые транзакции"],
  ["InvalidRule", "Недопустимое правило (B0 запрещено, маски 0..8)"],
  ["MaxDepth", "Достигнута максимальная глубина вложенности вселенных"],
  ["BadTerritory", "Номер клетки вне диапазона 0..63"],
  ["NotHolder", "Эта клетка вам не принадлежит"],
  ["AlreadyHeld", "Клетка уже занята"],
  ["PriceSlippage", "Цена изменилась выше вашего лимита — защита от фронтраннинга сработала, обновите данные"],
  ["BadPrice", "Цена вне допустимого диапазона"],
  ["DepositTooSmall", "Депозит налога слишком мал"],
  ["Cooldown", "Действует кулдаун — попробуйте позже"],
  ["TickTooEarly", "Слишком рано для тика этого мира"],
  ["OutOfEnergy", "У мира закончилась энергия — пополните его"],
  ["Dormant", "Клетка-хост мертва: вселенная спит"],
  ["EpochNotOver", "Эпоха ещё не завершилась"],
  ["NothingToClaim", "Нечего забирать"],
  ["ClaimWindow", "Окно получения наград закрыто или эпоха не та"],
  ["Mismatch", "Несоответствие аккаунтов (данные устарели — обновите страницу)"],
  ["DuplicateAccounts", "Одинаковые аккаунты там, где нужны разные"],
  ["InvariantViolated", "Нарушен инвариант хранилища — действие заблокировано ради безопасности"],
  ["RebellionUnavailable", "Восстание сейчас невозможно"],
  ["AlreadyVoted", "Вы уже проголосовали"],
  ["RebellionThreshold", "Порог голосов восстания не набран"],
  ["NoResonance", "Недостаточно резонанса для прорыва"],
  ["PermitExpired", "Разрешение ИИ-агента истекло"],
  ["PermitScope", "Разрешение агента не покрывает это действие"],
  ["PermitLimit", "Превышен лимит трат агента на эпоху"],
  ["NoArchitect", "У мира нет архитектора"],
  ["BadName", "Недопустимое имя (1..32 байта)"],
  ["BadVersion", "Неподдерживаемая версия аккаунта — нужна миграция"],
  ["NotMeasurable", "Слот измерения ещё не наступил"],
  ["AlreadyObserved", "Суперпозицию уже наблюдали"],
  ["NotObserved", "Суперпозицию ещё не наблюдали"],
  ["RevealWindowClosed", "Окно раскрытия закрыто — состояние декогерировало"],
  ["CommitmentMismatch", "Раскрытое состояние не совпадает с коммитом (не тот файл секрета?)"],
  ["NotNeutral", "Доступно только в нейтральном квантовом мире"],
  ["SwapAccepted", "SWAP уже принят"],
  ["SwapNotAccepted", "SWAP ещё не принят"],
  ["SwapExpired", "Предложение SWAP истекло"],
  ["SwapOpen", "Предложение SWAP ещё действует"],
  ["SelfSwap", "Нельзя обменяться с самим собой"],
  ["StillCoherent", "Суперпозиция ещё когерентна — рано"],
  ["InvalidWeight", "Недопустимая амплитуда / вероятность"],
  ["SlotHashes", "Системный аккаунт SlotHashes недоступен"],
  ["NoSeasonPoints", "В этом сезоне у игрока ещё нет очков (соберите награды за жизнь)"],
  ["NoPrize", "Приз не выигран или уже выплачен"],
  ["TreasuryLocked", "Эта сумма казны ещё не разделена с призовым фондом сезона"],
  ["TournamentClosed", "Регистрация на турнир закрыта"],
  ["TournamentFull", "Турнир заполнен"],
  ["TournamentRunning", "Турнир ещё идёт"],
  ["BadTier", "Неизвестный уровень турнира"],
  ["VrfPending", "Оракул случайности (ORAO VRF) ещё не ответил — запросите и подождите несколько секунд"],
  ["PrizesUnclaimed", "Ещё не все призы турнира выплачены — сначала заберите их (это может сделать кто угодно)"],
];

const ANCHOR_FRAMEWORK: Record<number, string> = {
  100: "Неизвестная инструкция — клиент и программа разных версий",
  101: "Неизвестная инструкция — клиент и программа разных версий",
  102: "Не удалось разобрать аргументы инструкции",
  2000: "Аккаунт должен быть изменяемым",
  2001: "Связь аккаунтов нарушена (has_one)",
  2002: "Нет нужной подписи",
  2003: "Нарушено ограничение аккаунта",
  2004: "Аккаунт принадлежит не той программе",
  2006: "Адрес PDA не совпадает с ожидаемым",
  2012: "Неверный адрес аккаунта",
  2014: "Токен-аккаунт не для SKR",
  2015: "Токен-аккаунт принадлежит другому владельцу",
  3001: "Аккаунт не того типа",
  3002: "Аккаунт не того типа",
  3003: "Не удалось прочитать аккаунт — версия программы и клиента не совпадают",
  3007: "Аккаунт принадлежит не той программе",
  3010: "Нет нужной подписи",
  3012: "Аккаунт ещё не создан (нет SKR-аккаунта? создайте его во вкладке «Кошелёк»)",
};

export function programErrorByCode(code: number): { name: string; message: string } | null {
  const e = PROGRAM_ERRORS[code - ANCHOR_ERROR_OFFSET];
  if (e) return { name: e[0], message: e[1] };
  if (ANCHOR_FRAMEWORK[code]) return { name: `Anchor${code}`, message: ANCHOR_FRAMEWORK[code] };
  if (code >= 2000 && code < 3000) return { name: `Anchor${code}`, message: "Нарушено ограничение аккаунта" };
  if (code >= 3000 && code < 4000) return { name: `Anchor${code}`, message: "Ошибка аккаунта" };
  return null;
}

export function programErrorByName(name: string): string | null {
  return PROGRAM_ERRORS.find(([n]) => n === name)?.[1] ?? null;
}

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/**
 * Turns anything that went wrong around a transaction (simulation error,
 * confirmed-with-error status, wallet exception, RPC exception) into one short
 * Russian sentence. `logs` are the program logs when available.
 */
export function explainTxError(err: unknown, logs: readonly string[] = []): string {
  // 1. Anchor prints the exact error name in the logs — the most reliable source.
  for (const l of logs) {
    const m = /Error Code: (\w+)\. Error Number: (\d+)/.exec(l);
    if (m) return programErrorByName(m[1]) ?? programErrorByCode(Number(m[2]))?.message ?? m[1];
  }
  const joined = logs.join("\n");
  if (/insufficient funds/i.test(joined) || (joined.includes(`Program ${TOKEN_PROGRAM} failed: custom program error: 0x1`))) return "Недостаточно RCR на счёте";
  if (/insufficient lamports/i.test(joined)) return "Недостаточно SOL для создания аккаунта (рента)";

  // 2. Structured InstructionError { Custom: n }.
  const structured = (typeof err === "object" && err !== null && "InstructionError" in err) ? (err as { InstructionError: [number, unknown] }).InstructionError : null;
  if (structured) {
    const [, inner] = structured;
    if (typeof inner === "object" && inner !== null && "Custom" in inner) {
      const code = Number((inner as { Custom: number }).Custom);
      const known = programErrorByCode(code);
      if (known) return known.message;
      return `Ошибка программы #${code}`;
    }
    if (typeof inner === "string") return inner === "ProgramFailedToComplete" || inner === "ComputationalBudgetExceeded" ? "Транзакции не хватило вычислительного бюджета" : `Ошибка инструкции: ${inner}`;
  }
  if (err === "AccountNotFound" || (typeof err === "string" && err.includes("AccountNotFound"))) return "Нет SOL на кошельке для комиссии";
  if (err === "InsufficientFundsForFee") return "Недостаточно SOL для комиссии сети";
  if (err === "BlockhashNotFound") return "Транзакция устарела — повторите";

  // 3. Exceptions from wallets / RPC.
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : JSON.stringify(err);
  if (/user rejected|rejected the request|denied|cancel/i.test(msg)) return "Вы отклонили подпись в кошельке";
  if (/block height exceeded|blockhash not found|expired/i.test(msg)) return "Транзакция устарела (истёк blockhash) — повторите";
  if (/custom program error: 0x([0-9a-f]+)/i.test(msg)) {
    const code = parseInt(/custom program error: 0x([0-9a-f]+)/i.exec(msg)![1], 16);
    return programErrorByCode(code)?.message ?? `Ошибка программы #${code}`;
  }
  if (/failed to fetch|network|timeout|429/i.test(msg)) return "RPC недоступен или перегружен — попробуйте позже";
  return msg.length > 180 ? `${msg.slice(0, 177)}…` : msg;
}

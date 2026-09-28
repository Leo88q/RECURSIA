# RECURSIA — аудит сайта и приложения перед продакт-деплоем

**Дата:** 2026-09-28 · **Аудитор:** Arena agent (машинный проход по чек-листу «Подготовка сайта и приложения») ·
**Коммит:** ветка `arena/01a0e5db-recursia` · **Раундов: 2** (2-й раунд: keeper-аудит, nginx-баг с `.well-known`,
бэкап-RPC, Dependabot-конфиг, CI-поверхность, принудительные compliance-файлы — см. правки ниже в таблице)

Статусы: **PASS** — закрыто (с доказательством) · **FAIL** — не закрыто · **N/A** — неприменимо (обосновано) ·
**HUMAN** — нужно действие человека (настройки GitHub/DNS/хостинга, юрист, внешние сервисы) ·
**FIXED** — исправлено в этом проходе.

---

## 0. Сводка

Ключевой факт архитектуры, с которого снята большая часть «серверных» рисков:
**у продукта нет сервера.** Это статический сайт (Vite-бандл) + смарт-контракт на Solana + permissionless keeper
(любой может запустить, секреты не требует). Нет бэкенда с API, нет БД, нет сессий, нет cookies, нет аналитики,
нет загрузки файлов, нет JWT. Поэтому целые разделы чек-листа (3.4–3.7, 4.x частично, 5.x частично) — N/A
по построению, а не «просто не сделано».

**Репозиторий публичный** (проверено через GitHub API). По правилу чек-листа всё содержимое и вся история
считаются раскрытыми. Последствий для средств нет: секретов в дереве и в истории не найдено (раздел 1),
keeper не держит ключей с деньгами (≤ 1 SOL на комиссии, OPERATIONS §1.2.6), admin/upgrade authority —
в Squads multisig на аппаратных кошельках (не в git, не в server'е). Публичность кода при verified build
даёт преимущество (проверяемость). Решение о приватности — HUMAN (раздел 2.8).

**Число находок по приоритетам** (по итогам всего прохода, включая предшествующие итерации):

| Приоритет | Число | Что |
|---|---|---|
| Critical | 0 | — |
| High | 3 | H1: внешний аудит контракта (блок mainnet) · H2: branch protection + Secret Scanning выключены · H3: реквизиты оператора в правовых документах не заполнены (блокирует легальность публикации) |
| Medium | 4 | M1: домен/DNS (DNSSEC, registry lock, CAA, HSTS preload) · M2: Dependabot не включён (конфиг `.github/dependabot.yml` готов) · M4: браузерный e2e-тест «подключение кошелька → клейм» · M5: Trivy/скан образа и мониторинг uptime |
| Low | 3 | L1: Lighthouse/WCAG после деплоя · L2: Sentry/ошибки-маяк (self-host, без PII) · L3: DPA с RPC-провайдером (документально) |
| ~~Medium~~ | — | ~~M3: бэкап-RPC-фолбэк~~ → **FIXED во 2-м раунде** (ChainApp: авто-переключение на публичный эндпоинт кластера после ~90 с недоступности, возврат на первичный с алертом) |

**Самые срочные 5 пунктов** (в порядке очереди):
1. **Внешний аудит контракта** (High) — уже стоит в `docs/DEPLOY.md` §10; без закрытых Critical/High mainnet не запускается. На лендинге честно предупреждение есть.
2. **GitHub-настройки владельца** (High, HUMAN): branch protection на `main` (PR + CI-статусы, запрет force-push), GitHub Secret Scanning + Push Protection, Dependabot, 2FA у всех коллабораторов. Агента нет прав (токен бота), — только владелец.
3. **Рекомендательные реквизиты + юрисдикция в правовых документах** (High, HUMAN/юрист): Privacy/Terms/Cookie/Risk созданы (v0.1), в них помечены места для юрлица/email/применимого права.
4. **Домен** (Medium, HUMAN): выкупить/направить DNS, DNSSEC, registry lock, CAA, 2FA на регистраторе и хостинге, HSTS preload после проверки, затем `scripts/post-deploy-check.sh` + SSL Labs + securityheaders.com.
5. **Keeper-инфраструктура** (Medium, HUMAN): ≥ 2 watcher'а с `ALERT_WEBHOOK`, uptime-мониторинг сайта, учебная пауза (весь регламент — OPERATIONS §5–6).

**Секретов не найдено** → список ротаций пуст (раздел «Ротации»). Если что-то из нижеперечисленного
в будущем обнаружится в pубличной истории — порядок: сначала ротация, потом filter-repo/BFG, потом force-update клонов.

**Что исправлено в этом проходе (безопасные правки):**
- `.gitignore` / `.dockerignore` — покрытие всех паттернов чек-листа 1.3.1 (`.pem`, `.p12`, `.keystore`, `serviceAccount*.json`, `credentials*`, `secrets*`, `*.sqlite`, `*.sql`, `*.bak`, `*.dump`, `.DS_Store`…); из Docker-контекста вынесены docs/tests/programs/Rust (2.7).
- **gitleaks в CI** (job `secrets`): рабочее дерево + полная история (все ветки), default ruleset + `.gitleaks.toml` (Solana keypair-массив, base58 87–88, keypair-файлы по имени); инструкция локального pre-commit (1.1.1/1.2.1/1.3.6).
- **GitHub Actions зафиксированы по SHA** (включая `dtolnay/rust-toolchain@master` → тег 1.86.0) (3.8.6).
- Правовые страницы `#/privacy` `#/terms` `#/cookies` `#/risk` + **глобальный футер на всех страницах** (7.1, 4.3, 5.2.1–5.2.4, 4.5).
- `/.well-known/security.txt` (7.2) — публикуется из `app/public`, проверен в `dist`.
- `THIRD_PARTY_LICENSES.md` (7.4), `CODEOWNERS` (2.10, часть), заметка об IP в README (2.11).
- `scripts/post-deploy-check.sh` (2.2, раздел 9) — запускать после каждого деплоя.

---

## 1. Секреты (раздел 1 чек-листа)

| Пункт | Приоритет | Доказательство | Описание / как исправить | Статус |
|---|---|---|---|---|
| 1.1.1 | High | job `secrets` в `.github/workflows/ci.yml`; локальный прогон — ручной grep всех паттернов 1.1.3 по дереву и `dist/` (0 находок; бинарник gitleaks в песочнице недоступен — CDN release-assets заблокирован, в CI он ставится) | gitleaks + ручной прогон. trufflehog не ставился: покрытие перекрывается gitleaks (default + кастом) + ручными паттернами; при желании добавить в тот же job | **PASS (FIXED: CI)** |
| 1.1.2 | High | `git ls-files \| grep -iE '\.env\|\.pem\|\.key\|id\.json\|keypair\|wallet\|keystore\|serviceAccount\|credentials\|secrets\|\.sqlite\|\.sql\|\.bak\|\.dump'` → только `app/.env.example` (шаблон), `WalletPanel.tsx`, `src/lib/secrets.ts`, `test/secrets.test.ts` (проверены: это клиентский commit-reveal-секрет суперпозиций, не credential; ключей/дампов нет) | — | **PASS** |
| 1.1.3 | High | grep всех 8 классов паттернов по дереву и `dist/`: keypair-64, base58 87–88, EVM `0x[64hex]`, TG-токен, Bearer/api_key/secret/password/token, RPC с ключом, `postgres://`/`mongodb+srv://`, service_role/Firebase/AWS/SMTP/Stripe/webhook → **0 находок**. В `dist/` 2 срабатывания `0x{64hex}` проверены вручную: константы кривых secp256k1/ed25519 из `@solana/web3.js` (p, n, Gx, Gy) — не ключи | — | **PASS** |
| 1.1.4 | High | README/docs/CI: `solana-keygen new … ~/.config/solana/id.json` в CI — одноразовый ключ деплоя в раннере, не коммитится; в docs/DEPLOY.md ключи создаются «на вашей машине»; тестовые данные (`tests/vectors/*.json`) — публичные векторы, секреты не содержат | — | **PASS** |
| 1.2.1 | High | `git log --all --oneline` → 1 squash-коммит (Merge #1), тегов 0, stash 0, remote веток только `origin/main`; job `secrets` сканирует `--log-opts=--all` (все refs) при каждом push/PR | Вся история = один коммит; сканер теперь проходит по ней в CI | **PASS (FIXED: CI)** |
| 1.2.2 | Med | `gh pr list --state all` → 1 PR (сработан, merged); issues: 0; Artifacts CI: `recursia-build` (idl/typedefs/recursia.so — публичные артефакты verified build, не секреты), `cargo-lock`; `so-blob` публикует blob только .so (debug-помощь); Wiki/Gists/форки — не используются | Проверено; при появлении PR-логов с ключами — ротация | **PASS** |
| 1.2.3 | High | `gh api repos/Leo88q/RECURSIA` → `"private": false` | Репозиторий публичный → всё содержимое и история считаются раскрытыми. Секретов там нет (1.1.x), средств не хранит. Если команда захочет приватный — закрывается одним действием; история уже публична, поэтому «скрытие» кода не даёт секретности для того, что уже было опубликовано | **HUMAN (решение)** |
| 1.2.4/1.2.5 | High | процедур: `docs/OPERATIONS.md` §6 (SEV-1), §1.2.4 (ротация подписанта 72 ч) | Скомпрометированных ключей не обнаружено → ротация не требуется. При обнаружении: ротация → filter-repo/BFG → force-update клонов (порядок соблюдён документом) | **PASS (процедура)** |
| 1.3.1 | Med | `git ls-files` — ни один чувствительный файл не отслеживается; `.gitignore` расширен (все паттерны чек-листа) | **FIXED** | **PASS (FIXED)** |
| 1.3.2 | Low | `app/.env.example` — только имена без значений, с комментарием «VITE_* публично» | — | **PASS** |
| 1.3.3 | High | в коде секретов нет: клиент — только публичные `VITE_*`; keeper: `RPC_URL` (env) + `KEEPER_KEYPAIR=./keeper.json` (файл, git-ignored, `chmod 600`, у key'а нет прав, только комиссии) | — | **PASS** |
| 1.3.4 | High | `app/src/lib/config.ts`: `VITE_RPC_URL не должен содержать логин/пароль — ключи RPC в клиентском бандле видны всем`; `VITE_`-переменные перечислены в `app/.env.example` и DEPLOY §9; в бандле (1.1.3/1.3.5) секретов нет | — | **PASS** |
| 1.3.5 | High | `npm -w app run build` → `check:bundle`: 0 `.map`, 0 `sourceMappingURL`; grep-скан `dist/` всех паттернов → 0 (кроме констант кривых, см. 1.1.3) | — | **PASS** |
| 1.3.6 | Med | CI job `secrets`; `.gitleaks.toml`; инструкция `gitleaks git --pre-commit` (DEPLOY §9). GitHub Secret Scanning + Push Protection — **отключены** (проверено API, у бота нет прав) | FIXED (CI+локально); Secret Scanning/Push Protection — владелец репозитория | **PASS (FIXED) + HUMAN** |
| 1.3.7 | High | `docs/OPERATIONS.md` §1: два независимых multisig (Admin 3/5, Upgrade 4/7 + 48ч), разные люди/аппаратные кошельки, минимальные права (keeper без прав) | Фактические ключи — HUMAN при деплое (сверка состава) | **PASS (процедура) + HUMAN** |
| 1.3.8 | High | нет server'а с ключами; hot-кошелёк keeper ≤ 1 SOL (только комиссии); admin/upgrade — Squads + hardware wallets; пауза `set_pause` | — | **PASS (процедура)** |
| 1.3.9 | Med | `config.ts` запрещает credential в RPC-URL; DEPLOY §9: «используйте провайдера с allow-list по домену (Origin) и лимитами»; CSP `connect-src` — белый список RPC-оригинов (включая доменного ключа через `VITE_RPC_URL`) | — | **PASS** |
| 1.3.10 | High | OPERATIONS §6: SEV-1 «пауза ≤ 30 мин», коммуникация ≤ 1 ч, разбор ≤ 7 дней; учебные паузы раз в квартал (§1.2.5) | — | **PASS** |

## 2. Не слить код игры (раздел 2)

| Пункт | Приоритет | Доказательство | Статус |
|---|---|---|---|
| 2.1 | High | Vercel: `app/vercel.json` → `outputDirectory: dist` (Root Directory = `app`); Netlify/CF: `dist` (+ `_headers`); Docker: `COPY --from=build /src/app/dist /usr/share/nginx/html` (`app/Dockerfile`) — публикуется только сборка, не корень репозитория | **PASS** |
| 2.2 | High | домен ещё не заведён → HUMAN: `scripts/post-deploy-check.sh https://домен` после каждого деплоя (сравнение содержимого, не кода; проверено локально на превью: все чувствительные пути не отдают реальные файлы, security.txt/robots отдаются) | **HUMAN (инструмент готов)** |
| 2.3 | High | `vite.config.ts`: `build.sourcemap: false`; `scripts/check-bundle.mjs` падает при `.map`/`sourceMappingURL` (в CI); nginx `location ~ \.map$ { deny all; }`; в `dist/` 0 map-файлов | **PASS** |
| 2.4 | High | `docs/SECURITY.md` Часть 0: симуляция считается в контракте (`programs/recursia/src/sim.rs`), клиент не «сообщает» счёт; keeper permissionless; все лимиты (агенты, slippage, параметры) — в контракте | **PASS (архитектура)** |
| 2.5 | Low | `app/public/`: favicon.svg, icons/, manifest.webmanifest, og.jpg, robots.txt, .well-known/security.txt — только публичные ассеты; исходники PNG в git не хранятся (DEPLOY §9 «Графика») | **PASS** |
| 2.6 | Med | nginx: `try_files`, без листинга. **2-й раунд: найден и исправлен баг** — до этого `location ~ /\.` (неякорный) блокировал и `/.well-known/security.txt` (403); теперь `location ~ /\.(?!well-known/)` (PCRE lookahead), `/.well-known/` обслуживается. Добавлено: `client_max_body_size 2k` (нет POST-содержимого — бюджет DoS), `gzip_vary on` (правильный `Vary` для кэшей) | **PASS (FIXED во 2-м раунде)** |
| 2.7 | Med | `.dockerignore` расширен (секреты, docs, tests, programs, Rust, git); образ: `nginxinc/nginx-unprivileged`, `USER 101`, в build только публичные VITE_*-args; секреты в образе не попадают (проверено: в `dist/` нет, build-args публичные). **Trivy/`docker history` — HUMAN** (в песочнице docker нет) | **PASS (конфиг) + HUMAN (Trivy)** |
| 2.8 | Med | monorepo публичный: принято как осознанное решение (проверяемость контракта, verified build, в keeper'е нет секретов). При появлении привилегированных сервисов — вынести в приватный репозиторий/модуль | **N/A / принято (задокументировано)** |
| 2.9 | Low | обфускация не используется и не требуется (клиент публичен по построению) | **N/A** |
| 2.10 | High | `gh api …/branches/main` → `protection.enabled: false`. `CODEOWNERS` добавлен; **2-й раунд:** `.github/pull_request_template.md` — обязательный security-чеклист в каждом PR. Остальное — HUMAN: protect main (require PR + CI статусы (включая `secrets`), запрет force-push/push на main), 2FA у всех коллабораторов, минимальные права | **FAIL → HUMAN** |
| 2.11 | Low | LICENSE-файла нет → «All rights reserved» (как и нужно для закрытого кода); README теперь это явно декларирует; решение об открытии — за командой/юристом | **PASS (заявлено)** |

## 3. Безопасность веб-приложения (раздел 3)

| Пункт | Приоритет | Доказательство | Статус |
|---|---|---|---|
| 3.1.1–3.1.3 | High | HTTPS: у Vercel/Netlify/CF — по умолчанию + редирект; nginx в Docker слушает 8080 (TLS терминируется на провайдере). HSTS: `max-age=63072000; includeSubDomains; preload` в `app/security.mjs` → все заголовки. TLS 1.2+ — на стороне хостинга. Домена нет → SSL Labs/testssl — после завёдения | **HUMAN (после домена)** |
| 3.2.1 | High | CSP: `default-src 'self'; script-src 'self'; … frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; upgrade-insecure-requests`; `connect-src` — белый список (публичные RPC + настроенный). `style-src 'unsafe-inline'` — неубираемо без per-request nonce'а, а он невозможен на чистой статике (Vercel/Netlify/nginx без edge-функций): приложение само использует inline style-атрибуты в 11 местах (`style={{…}}` в JSX, см. `Landing.tsx`), wallet-adapter-react-ui — CSS-in-JS. Inline-`<script>` нет, `unsafe-eval` нет — JS-вектор закрыт `script-src 'self'` | **PASS (оправдано)** |
| 3.2.2 | Med | `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` (строже требуемого), `Permissions-Policy` (камера/микро/гео/payment/usb/serial/hid/bluetooth/interest-cohort отключены), COOP/CORP same-origin | **PASS** |
| 3.2.3 | Low | nginx `server_tokens off`; на Vercel/CF версия не раскрывается | **PASS** |
| 3.2.4 | Med | securityheaders.com / Observatory — после деплоя (HUMAN); ожидаемо A (все директивы на месте) | **HUMAN** |
| 3.3.1 | High | grep `app/src`: `innerHTML`, `dangerouslySetInnerHTML`, `eval(`, `new Function`, `document.write`, `setTimeout("…")` — **0 вхождений**; весь HTML через JSX (экранирование React'ом по умолчанию) | **PASS** |
| 3.3.2 | Med | UGC на сайте нет (нет ников/чата); имён модулей/законов в клиенте — текст (React escape); on-chain строки валидируются в контракте (`validate_rule`) | **PASS** |
| 3.3.3 | Med | NFT-метаданных в игре нет (объекты — аккаунты программы, не token-metadata); ссылок из on-chain нет; explorer-ссылки — константа `explorer.solana.com` | **N/A (нет NFT) / PASS** |
| 3.3.4 | High | БД нет | **N/A** |
| 3.3.5 | High | server'а нет → command injection/path traversal/SSRF/open redirect не применимы; клиент не делает запросы по URL пользователя (RPC зашит при сборке) | **N/A (архитектура)** |
| 3.4.1–3 | High | нет server'а, нет cookies, нет сессий → CORS/CSRF неприменимы | **N/A** |
| 3.5.1–6 | High | нет логина/сессий: «подпись» — прямая подпись кошельком игрока каждой своей транзакции (simulate→превью→подпись, tx.tsx); серверу доверять нечего; nonce'ов нет (нет бэкенда) | **N/A (архитектура)** |
| 3.6.1–3 | High | нет API-эндпоинтов; «админка» — on-chain multisig (48ч timelock, публичное анонсирование, OPERATIONS §1.1); debug-роутов нет | **N/A (API) / PASS (админка)** |
| 3.7.1–6 | High | нет API; валидация входных данных — в контракте (Anchor `#[derive(Accounts)]`, `validate_rule`, границы параметров); rate-limit ботов — архитектура (агентские лимиты `AgentPermit`, CU-стоимость); идемпотентность — on-chain состояния (nonce'ов двойной траты нет: все операции меняют состояние PDA атомарно); стектрейсы наружу не уходят (нет server'а) | **N/A (архитектура)** |
| 3.8.1 | High | `npm audit --audit-level=high` → 7 moderate, **0 high/critical**; гейт в CI | **PASS** |
| 3.8.2 | High | `package-lock.json` закоммичен; `npm ci --ignore-scripts` везде (CI, Docker, DEPLOY) | **PASS** |
| 3.8.3 | High | `scripts/check-supply-chain.mjs` (скомпрометированные/typosquat/не-registry) + `scripts/check-unicode.mjs` в CI; `@solana/web3.js` 1.99.0 (постинцидентная ветка 1.x, актуальная); ignore-scripts отключает postinstall; `overrides: uuid` | **PASS** |
| 3.8.4 | High | внешних скриптов нет вообще (аналитика/виджеты/CDN-скрипты — 0; иконки inline-SVG; шрифты системные) | **PASS** |
| 3.8.5 | Med | **FIXED во 2-м раунде:** `.github/dependabot.yml` (npm еженедельно + cargo для контракта + github-actions — он умеет обновлять SHA-фиксацию) добавлен; включение функции — HUMAN (Settings → Code security → Dependabot). 2FA на npm-аккаунтах — HUMAN | **PASS (конфиг) + HUMAN (включить)** |
| 3.8.6 | High | **FIXED**: все Actions зафиксированы по SHA (checkout/setup-node/upload/download-artifact, rust-cache, rust-toolchain@1.86.0); глобально `permissions: contents: read`; write — только у двух джоб (lockfile — push-once, so-blob — debug) с обоснованием в комментах; `pull_request_target` не используется. **2-й раунд:** `fetch-depth: 1` во всех джобах, кроме `secrets` (меньше истории в раннерах, быстрее сборка) | **PASS (FIXED)** |
| 3.9.1 | High | «RECURSIA никогда не просит seed-фразу» — `tx.tsx:193`, `Landing.tsx:226-227`, FAQ, Terms §5, Risk §3; в UI поля ввода seed'а нет (grep) | **PASS** |
| 3.9.2 | High | `tx.tsx`: simulate → превью (ΔSKR/ΔSOL из post-state, CU, комиссия, программы, логи) → подпись со свежим blockhash; allow-list программ (чужие инструкции отклоняются до симуляции); slippage-лимиты в инструкциях | **PASS** |
| 3.9.3 | Med | `/.well-known/security.txt` + `.github/SECURITY.md` (приватные advisory, 90 дней); OPERATIONS §7: DNSSEC/registry lock/CAA/HSTS preload/2FA на регистраторе — **HUMAN (домен)**; висящих поддоменов нет (домен ещё не заведён) | **HUMAN (домен)** |
| 3.9.4 | **Critical→High** | аудит **не проводился** (честно заявлено: README ⚠️, лендинг risk-блок, DEPLOY §10); verified build — процедура OPERATIONS §2 (hash + verify-from-repo); upgrade authority → Upgrade multisig 4/7 + 48ч; `set_pause` как «красная кнопка»; лимиты параметров в контракте | **HUMAN (блок mainnet)** |
| 3.9.5 | Med | внешние ссылки в коде: `explorer.solana.com`, GitHub (Leo88q), squads.so (только в docs) — легитимные; соцсети не заявлены | **PASS** |
| 3.10.1 | Med | загрузки файлов на server нет; импорт секрет-файла — парсинг в браузере с валидацией формата и владельца (`secrets.ts: importSecret`, тест `secrets.test.ts`) | **N/A (server) / PASS (client)** |
| 3.11.1 | Med | Docker: `USER 101` (non-root), expose только 8080, healthcheck; БД/SSH нет. Хостинг — настройки провайдера (HUMAN) | **PASS (что существует) + HUMAN** |
| 3.11.2 | Med | WAF/DDoS — у провайдера (рекомендация: Cloudflare); лимиты CDN — HUMAN | **HUMAN** |
| 3.11.3 | Med | состояния нет (всё on-chain): бэкапу подлежит только конфигурация multisig/аккаунтов — в Squads/hosting (HUMAN) | **N/A (состояние) + HUMAN** |
| 3.11.4 | Med | серверных логов нет; keeper пишет в stdout локально (секретов в логах нет: RPC_URL публичный, keypair в файле, а не в логах) | **PASS (что существует)** |
| 3.11.5 | High | watcher: `keeper/src/watch.ts` (денежные инварианты каждую минуту, алерты `ALERT_WEBHOOK`, ≥ 2 экземпляра, heartbeat); учебная пауза — регламент. Запуск — HUMAN при деплое | **PASS (код) + HUMAN (запуск)** |
| 3.11.6 | High | OPERATIONS §6 (уровни, SEV-1 пошагово, шаблон сообщения, разбор ≤ 7 дней, `docs/incidents/`) | **PASS** |
| Keeper-аудит (2-й раунд) | High | `keeper/src/main.ts`: ключ — только из файла (проверка `chmod 600`, 64-байтовый JSON, **никогда не в лог/argv/env**); `RPC_URL` — только https; **allow-list программ** (`RECURSIA + ComputeBudget + ATA + ORAO VRF`, чужие инструкции отклоняются до подписи: «refusing to sign foreign program»); simulate-перед-подписью; жёсткие пределы (CU, priority fee, SOL-флор, backoff), single-instance lock; `watch.ts`: read-only, `ALERT_WEBHOOK` только https, в вебхук уходит только публичное on-chain состояние `{level, text}` (ключей/персоналки нет), URL фиксируется при старте (не пользовательский ввод → SSRF не применим). Находок нет | **PASS** |

## 4. Cookies и локальное хранилище (раздел 4)

| Пункт | Приоритет | Доказательство | Статус |
|---|---|---|---|
| 4.1 | Med | инвентаризация: **cookies — 0** (grep `document.cookie` — 0 вхождений); localStorage: 4 ключа (`recursia:wallet`, `recursia:priority`, `recursia:psi:*`, `recursia:onboarding:done`) — таблица в Cookie Policy; IndexedDB/sessionStorage — 0; пиксели/SDK/fingerprinting — 0 (внешних скриптов нет вообще, 3.8.4) | **PASS** |
| 4.2 | Low | нечего классифицировать: обязательных cookies нет, функциональные — только localStorage (не cookie) | **PASS** |
| 4.3 | Med | баннер не нужен: нет ни одной несущественной cookies/скрипта до согласия — согласия нечего запрашивать. «Настройки cookies» = постоянная ссылка в футере на каждой странице → `#/cookies` (как «отозвать» — очистить site data; предупреждение про `recursia:psi:*` там же). Cookie wall/dark patterns отсутствуют по построению | **PASS (FIXED: страница+футер)** |
| 4.4 | Low | согласия нет → логировать нечего | **N/A** |
| 4.5 | Med | `#/cookies` (v0.1): таблица ключей/назначений/сроков, внешние ресурсы, как удалить | **PASS (FIXED, для юриста)** |
| 4.6 | Med | шрифты: системный стек, внешних CDN нет; графика self-hosted (webp в бандле) | **PASS** |
| 4.7 | Low | видео/карт нет | **N/A** |
| 4.8 | Low | GPC/Consent Mode — неприменимы (нет трекеров/Google-сервисов) | **N/A** |
| 4.9 | Low | CMP не нужен (нет cookies) | **N/A** |

## 5. Персональные данные (раздел 5)

Факты для юриста (собранные в коде, без оценки):
- Сервера нет → **не собирается**: email, IP (с нашей стороны), device ID, логи, платежи, KYC.
- Собирает браузер: 4 ключа localStorage (4.1).
- On-chain: адрес кошелька игрока — публичен навсегда (владелец объектов, участники транзакций); в метаданные NFT PII не пишется (NFT нет); в логи программы имена/описания модулей — до 64 байт, управляются игроком (юрист: можно ли считать PII при связке с адресом).
- Третьи стороны: RPC-провайдер (видит адреса запросов + IP браузера), Solana (публичный блокчейн), GitHub (advisories/отчёты), Squads (только у команды).
- Юрисдикции: не определены (HUMAN). GDPR применяется при ЕС-аудитории независимо от сервера; 152-ФЗ при РФ-аудитории (локализация) — юрист.

| Пункт | Приоритет | Статус |
|---|---|---|
| 5.1.1–5.1.5 | High | Карта данных — в `#/privacy` v0.1 (сбор/хранение/срок/третьи стороны); «кошелёк+IP не анонимны» — учтено; персоналки в блокчейн не пишутся (адрес — псевдоним, задокументировано). **PASS (FIXED: страница) + HUMAN (юрист: основания, сроки, DPIA/DPO)** |
| 5.2.1–5.2.4 | High | 4 документа созданы (v0.1): Privacy, Terms, Risk Disclosure, Cookie Policy; доступны с каждой страницы (глобальный футер) + при подключении кошелька (футер виден в live-режиме); версия+дата у каждого; **реквизиты оператора и применимое право — плейсхолдеры «будет обновлено»** | **PASS (FIXED) + HUMAN (юрист: реквизиты, юрисдикция, архив версий)** |
| 5.3.1–5.3.4 | Med | форм/рассылок нет (email не собирается) → double opt-in/возраст: 18+ заявлен в Terms §1 и Risk; согласие на маркетинг не запрашивается (маркетинга нет) | **N/A / PASS (18+)** |
| 5.4.1–5.4.4 | High | канал DSAR: GitHub Security (в `#/privacy` §5, ответ ≤ 30 дней); технически хранить/удалять нечего (задокументировано); CCPA/GPC — N/A (нет продажи/трекеров) | **PASS (FIXED: канал) + HUMAN (юрист: процесс)** |
| 5.5.1–5.5.5 | High | список процессоров — в THIRD_PARTY_LICENSES.md §3; DPA с RPC-провайдером — **HUMAN**; шифрование — TLS у провайдера + публичный блокчейн (задокументировано); Sentry отсутствует (ошибки — ErrorBoundary локально; L2: рассмотреть self-host beacon без PII); план утечки — OPERATIONS §6; реестр операций/DPIA/DPO — юрист | **HUMAN (юрист + DPA)** |

## 6. Крипто-специфичные юридические риски (раздел 6 — для юриста)

| Пункт | Факт из кода/сайта | Статус |
|---|---|---|
| 6.1 | У игры **нет своего токена**: используется внешний SKR (Solana Mobile), mint authority не у игры (проверено в `initialize`); есть стейк-подобные депозиты (налог), ребейты, роялти за законы, турнирные призы → квалификация (MiCA/e-money/ценная бумага) — юрист | **HUMAN** |
| 6.2 | Квантовая механика: commit-reveal с вероятностями + награды наблюдателям + SWAP с «премией за риск» — элемент случайности при платных входах (лутбокс/лотерея-квалификация в отдельных юрисдикциях) — юрист; на лендинге есть FAQ «Это казино? — Нет» с обоснованием | **HUMAN** |
| 6.3 | KYC/AML нет (permissionless); санкционных фильтров нет; геоблокировки нет — сознательная архитектура; допустимость по юрисдикциям — юрист (список стран в Terms — плейсхолдер) | **HUMAN** |
| 6.4 | Маркетинг проверен: «не инвестиционная рекомендация и не обещание дохода» (футер лендинга, FAQ, Terms §3, Risk); формулировок «гарантированный доход/инвестиция» нет (grep «гарантир» — только «не гарантированно»); блогеры/промо — не запущены | **PASS (тексты)** |
| 6.5 | налоги/договоры — вне рамок агента | **HUMAN** |

## 7. Обязательные страницы и файлы (раздел 7)

| Пункт | Статус |
|---|---|
| 7.1 футер | **PASS (FIXED)**: глобальный футер на всех страницах: Privacy, Terms, Cookie Policy, Risk Disclosure, «Сообщить об уязвимости». Реквизиты оператора (юрлицо/email/адрес) — плейсхолдер в Privacy §1 → **HUMAN** |
| 7.2 security.txt | **PASS (FIXED)**: `app/public/.well-known/security.txt` → публикуется (проверено в `dist` и на превью: 200), контакт = GitHub private advisory, ссылка на политику раскрытия |
| 7.3 robots.txt | **PASS**: `User-agent: * / Allow: /` — приватных путей нет (их не существует) |
| 7.4 лицензии | **PASS (FIXED)**: `THIRD_PARTY_LICENSES.md` (зависимости, графика, шрифты, сервисы) |
| 7.5 DMCA | **N/A**: пользовательских загрузок контента нет |
| 7.6 доступность | **PARTIAL → HUMAN**: skip-link, `aria-label`, `aria-current`, `:focus-visible`, `tabindex=-1` на main, контраст тёмной темы — в коде; Lighthouse a11y + EAA-оценка — после деплоя/юрист |

## 8. Качество и исправная работа (раздел 8)

| Пункт | Статус |
|---|---|
| 8.1 | **PASS**: `npm -w app run build` (tsc + vite) — зелёно; тесты: SDK 58 + keeper 9 + app 70 — зелёно (прогнан в этом проходе); clippy/fmt/LiteSVM-интеграция — в CI; e2e-браузерного «подключи кошелёк → клейм» нет (M4 — рекомендация) |
| 8.2 | **PASS (конфиг) / HUMAN (цифры)**: initial 112.7 KB gzip (бюджет 150, гейт в CI), lazy-чанки (wallet/web3 грузятся только в live-режиме), gzip в nginx, immutable-кеш для ассетов, PWA; Lighthouse/CWV — после деплоя |
| 8.3 | **PASS (с оговоркой)**: hash-роутер не может дать «404 страницу» (неизвестный маршрут → лендинг — осознано, т.к. статика без server-rewrite); реальных битых ссылок/картинок нет (все ассеты в бандле с хешами); `noscript`-блок есть; ErrorBoundary с человеком-сообщением |
| 8.4 | **PASS**: Wallet Standard (Phantom/Solflare/Backpack); отказ от подписи — обработан (`cancelled`); WS-падение — покрывается поллингом (45с, «сохраняет последнее рабочее состояние»); недоступный RPC — понятный экран «Сеть сейчас недоступна» + авто-ретрай; **запасной RPC: FIXED во 2-м раунде** — `ChainApp` каждые 30 с зондирует endpoint, после ~90 с недоступности первичного переключается на публичный эндпоинт того же кластера (всегда в CSP-белом списке, `rpcFallback()` + тесты), каждые 30 с пробует вернуться, тосты о смене; localnet без фолбэка (осознанно, http не в CSP) |
| 8.5 | **PASS**: адаптив (мобильный: документ скроллится, `viewport-fit=cover`), `lang="ru"`, OG/Twitter-картинки (абсолютные через `VITE_SITE_URL`), favicon+PWA-иконки+maskable |
| 8.6 | **PARTIAL → HUMAN**: `/healthz` (Docker/nginx), откат = перепубликация предыдущего бандла (статика), staging = devnet-деплой; uptime-мониторинг/ошибка-алерты — HUMAN (UptimeRobot/CF) |
| 8.7 | **PASS**: README (запуск без секретов) + DEPLOY.md (все env-переменные, хостинги, Docker, домен) + SECURITY.md/SECURITY_AUDIT.md/OPERATIONS.md |

## 9. Внешние пассивные проверки (раздел 9)

**HUMAN после завёдения домена.** Готовый инструмент: `scripts/post-deploy-check.sh https://домен`
(заголовки, чувствительные пути по содержимому, HTTP→HTTPS, source maps в бандле, security.txt/robots).
Внешние сервисы: SSL Labs, securityheaders.com, Mozilla Observatory, Lighthouse, DNS-проверки (DNSSEC, CAA).
Локальный прогон на превью выполнен (см. 2.2) — структура ответов корректна; заголовки из `_headers`/meta CSP в bандле верны (проверено в `dist`).

## 10. Инструменты (раздел 10)

| Задача | Что применено |
|---|---|
| Секреты | gitleaks (CI, v8.30.1 pinned, default+`.gitleaks.toml`, full history) + ручной grep всех паттернов; GitHub Secret Scanning — **HUMAN (включить)** |
| Стек | npm audit (CI гейт high+), check-supply-chain.mjs, check-unicode.mjs, ignore-scripts, lockfile, SHA-pinned Actions, CODEOWNERS |
| Зависимости | npm ci --ignore-scripts; Dependabot — **HUMAN (включить)** |
| Контейнеры | .dockerignore (секреты/docs/tests), non-root nginx, healthcheck; Trivy/checkov — **HUMAN** |
| TLS/заголовки | security.mjs → _headers/vercel.json/nginx (синхронность проверяется в CI `check:deploy`); SSL Labs — после домена |
| Cookies | инвентаризация (0 cookies), Cookie Policy с таблицей localStorage |
| Контракты | unit + property-fuzz + LiteSVM + эталонная модель + econ-sim (в CI); внешний аудит — **HUMAN (блок)** |

---

## «Проверить вручную» (человеку, по списку)

1. **GitHub (владелец репозитория):** branch protection на `main` (PR + обязательные CI-статусы включая `secrets`, запрет force-push); Secret Scanning + Push Protection; Dependabot (npm + Rust); 2FA + аппаратный ключ у всех коллабораторов; права коллабораторов — минимальные; проверить visibility (решение public/private — 1.2.3/2.8).
2. **Регистратор:** DNSSEC, registry lock, CAA (`0 issue "letsencrypt.org"` — до выбора CA), 2FA, автопродление отключить.
3. **Хостинг/CDN:** HSTS preload после проверки (hstspreload.org), WAF/DDoS (рекомендация Cloudflare), лимиты, uptime-алерты.
4. **Кошельки:** состав multisig (Admin 3/5, Upgrade 4/7, разные люди/устройства), hot-кошелёк keeper ≤ 1 SOL, seed-фразы на бумаге в 2 местах, учебная пауза.
5. **Процессоры:** DPA/условия RPC-провайдера (страна обработки, логи), GitHub (адvisories), Squads.
6. **После каждого деплоя:** `scripts/post-deploy-check.sh https://домен` + SSL Labs + securityheaders.com (≥ A) + Lighthouse.

## «Для юриста»

1. Реквизиты оператора (юрлицо/ФИО, адрес, email) в `#/privacy` §1 и `#/terms` §7 (плейсхолдеры «будет обновлено»).
2. Юрисдикции аудитории: GDPR/152-ФЗ/CCPA — перечень стран в Terms §7; 152-ФЗ: локализация + уведомление Роскомнадзора.
3. Квалификация SKR-механик (стейкинг-депозиты, ребейты, роялти, турниры) — MiCA/ценная бумага (6.1).
4. Квантовый лутбокс/SWAP — лотерея/азартная квалификация по юрисдикциям (6.2).
5. KYC/AML/geoblocking — решение permissionless-модели (6.3).
6. Возраст 18+ — достаточен? Дети: данных сознательно не собираем (5.3.4).
7. DPIA/DPO, реестр обработки (ст. 30 GDPR), 72-часовые уведомления (5.5.4) — соответствие OPERATIONS §6.
8. Лицензия кода: открыть или «all rights reserved» (2.11).
9. European Accessibility Act — попадает ли сайт (7.6).

## Ротации

**Список пуст**: скомпрометированных ключей/токенов в дереве и в истории (1 коммит) не найдено.
Кондиционально (если найдено в будущем):
- любой RPC-ключ/токен API → новый ключ у провайдера, old отозвать, обновить деплой-конфиг;
- keeper-keypair → новый файл `keeper.json` (у ключа нет прав, средства не переводит — достаточно заменить);
- подписант multisig → процедура OPERATIONS §1.2.4 (72 ч; Upgrade — через 48ч timelock);
- program authority → только через Upgrade multisig (48ч), `--final` после стабилизации.

## План повторного аудита

- **После каждого релиза:** CI-проходы уже обязательны (secrets, supply-chain, audit, build, bundle, deploy-sync); post-deploy-check.sh — в ручную после каждого деплоя.
- **Раз в квартал:** полный проход этого чек-листа (секреты по истории, зависимости, заголовки, cookies/storage, документы — сверка версий), учебная пауза multisig (OPERATIONS §1.2.5).
- **Триггерные:** смена RPC-провайдера/хостинга, добавление backend/аналитики/UGC (разделы 3.4–3.7 и 4–5 перестают быть N/A), инцидент (разбор ≤ 7 дней).
- **Перед mainnet:** внешний аудит контракта + пентест сайта + юридическое заключение (обязательные, DEPLOY §10).

---
*Ни один чек-лист не даёт 100% защиты. Перед запуском с реальными деньгами игроков: независимый аудит контракта, пентест сайта, консультация юриста по вашим юрисдикциям.*

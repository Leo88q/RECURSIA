# Развёртывание RECURSIA

> ⚠️ Никогда не коммитьте ключи. `.gitignore` уже исключает `*-keypair.json`, `id.json`, `keeper.json`, `keys/` и `.env`.
> Все ключи ниже создаются **на вашей машине**, приватные ключи подписантов multisig — на аппаратных кошельках.

## 0. Требования
- Rust 1.86 (`rust-toolchain.toml`), Agave/Solana CLI **2.1.21**, Anchor CLI **0.31.1**, Node 22.
- Squads v4 multisig (UI: squads.so) — будущий admin и upgrade authority.

## 1. Program ID
В репозитории зашит ID `2GrrTSyT4AG58XkEjtsV18dV8RPm6AZgQSjSxguCwCik`. Его приватный ключ **не** в репозитории.
Для своего деплоя создайте новый:
```bash
solana-keygen new -o target/deploy/recursia-keypair.json
anchor keys sync          # обновит declare_id! и Anchor.toml
# затем обновите PROGRAM_ID_STR в packages/sdk/src/constants.ts (или задайте VITE_PROGRAM_ID для клиента)
```

## 2. Сборка и проверка
```bash
npm ci --ignore-scripts
npm test                       # SDK + keeper
npm run econ                   # экономическая симуляция, все инварианты должны пройти
cargo test -p recursia && cargo clippy -p recursia -- -D warnings
anchor build                                   # devnet/localnet (любой mint без freeze authority)
anchor build -- --features mainnet             # мейннет: initialize принимает только официальный SKR
npx -w packages/sdk tsx scripts/check-idl.ts ../../target/idl/recursia.json
```
Для verified build: `solana-verify build -- --features mainnet` и публикация `solana-verify verify-from-repo` после деплоя.

## 3. Devnet
```bash
solana config set -u devnet
solana airdrop 5
anchor deploy --provider.cluster devnet
```

## 4. initialize → fund_reward_pool
`initialize` может вызвать **только текущая upgrade authority** (защита от фронт-рана инициализации).
Передайте `admin` = адрес vault'а вашего Squads multisig и `mint`:

- **mainnet** — только официальный SKR `SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3`. Мейннет-сборка
  (`anchor build -- --features mainnet`) другой mint не примет (`BadMint`).
- **devnet/localnet** — тестовый mint с 6 decimals и **без freeze authority**:
  ```bash
  spl-token create-token --decimals 6            # freeze authority не задаём
  spl-token create-account <TEST_MINT> && spl-token mint <TEST_MINT> 100000000
  ```
  Клиенту и keeper'у передайте его: `VITE_MINT=<TEST_MINT>` и `MINT=<TEST_MINT>`.

`initialize` создаёт PDA-аккаунты `treasury`, `reward_pool`, `claims`, `sponsor_pool`, `season_pool` и аккаунт таблицы `season`
для этого mint. Mint больше не меняется. Первый сезон начинается с эпохи 1.
Дальше по желанию:

1. `fund_reward_pool(amount)` — пополнить пул наград (студия на запуске, партнёры). Подписать может любой, вывести пул не может никто.
1a. `fund_sponsor_pool(amount)` — спонсорский пул (платит мирам за живые клетки, 10% в эпоху). Рекомендуется на запуске:
   по econ-sim именно он превращает игру из чистого перераспределения в игру, где часть игроков выходит в плюс.
   Взнос невозвратный: вывести его нельзя, в том числе студии.
2. Проверьте: `spl-token display SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3` → `Freeze authority: (not set)`, decimals 6;
   `config.mint` в аккаунте Config совпадает с ним. Клиент на `mainnet-beta` откажется работать, если `VITE_MINT` не официальный SKR.

Скрипты можно собрать из `RecursiaIx.initialize(...)` / `RecursiaIx.fundRewardPool(...)` в SDK; через Squads — «Transaction builder → Import base58».

## 5. Передача upgrade authority
```bash
solana program set-upgrade-authority <PROGRAM_ID> --new-upgrade-authority <SQUADS_VAULT> --skip-new-upgrade-authority-signer-check
```
Когда код стабилизируется после аудита — рассмотрите `--final` (неизменяемая программа).

## 6. Регламент multisig (обязателен)
- Порог **≥ 3 из 5**, ключи на разных аппаратных кошельках у разных людей; никаких «горячих» подписантов.
- Каждое админ-действие: `propose` → публичный анонс → ожидание timelock (≥ 48ч, уменьшить до нуля невозможно) → `execute(expected_nonce)`.
- Подписант **самостоятельно** декодирует транзакцию и сверяет `pending_nonce` и параметры. Никаких «срочных» подписей по просьбе в мессенджере, никаких durable-nonce транзакций, подготовленных третьими лицами (урок Drift 2026).
- `set_pause` — единственное действие без timelock; оно не может двигать средства.

## 7. Модули и первые миры
- `register_module` для пресетов (Conway Life, HighLife, Day & Night, …) — от адреса студии, роялти до 5%.
- `create_root_world` × N, `fund_world` энергией из distribution.

## 8. Keeper
```bash
chmod 600 keeper.json
RPC_URL=https://api.devnet.solana.com KEEPER_KEYPAIR=./keeper.json npm -w keeper start -- --dry-run   # проверка
RPC_URL=... KEEPER_KEYPAIR=./keeper.json npm -w keeper start
```
Keeper permissionless — запускать может кто угодно, несколько независимых keeper'ов повышают живучесть.
Помимо тиков, эпох и квантовых измерений keeper читает аккаунт `season` и отправляет `claim_season_prize` за каждое
невыплаченное место прошлого сезона. Приз всегда уходит победителю, keeper платит только комиссию сети.

Внимание: `advance_epoch` теперь принимает 8 аккаунтов (добавлены `sponsor_pool`, `treasury` (mut), `season_pool`, `season`).
Старые скрипты, собранные до этой версии, нужно пересобрать через SDK.

## 9. Клиент (фронтенд)

### Конфигурация
Все переменные — **публичные** (попадают в JS-бандл), секретов в них быть не должно. Шаблон: `app/.env.example`.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `VITE_CLUSTER` | `devnet` | `devnet` / `testnet` / `mainnet-beta` / `localnet` — подписи в UI, ссылки эксплорера |
| `VITE_RPC_URL` | публичный RPC кластера | свой RPC для продакшена (Helius/Triton/…); только `https://` |
| `VITE_WS_URL` | из RPC | отдельный websocket, если провайдер его требует |
| `VITE_PROGRAM_ID` | `PROGRAM_ID_STR` из SDK | адрес вашей программы |
| `VITE_MAX_PRIORITY_FEE` | `500000` | жёсткий потолок priority fee, µ-lamports/CU |
| `VITE_SITE_URL` | — | публичный https-origin сайта: абсолютные `og:image`/`og:url` для превью ссылок |

Конфигурация валидируется при старте (`app/src/lib/config.ts`): http-RPC вне localnet, логин/пароль в URL,
неверный base58 — клиент покажет экран ошибки вместо тихой поломки. RPC-ключ в URL виден всем:
используйте провайдера с allow-list по домену (Origin) и лимитами.

### Сборка
```bash
VITE_CLUSTER=mainnet-beta VITE_RPC_URL=https://<ваш RPC> VITE_PROGRAM_ID=<PROGRAM_ID> npm -w app run build
npm -w app run check:bundle     # бюджет бандла, CSP-meta, _headers, отсутствие source maps
```
Результат — статический `app/dist` (hash-роутинг `#/…`, поэтому серверные rewrite не нужны; работает и с IPFS/Arweave-зеркал).
Первый экран (песочница) ≈ 115 KB gzip; кошелёк + web3 (≈ 150 KB gzip) грузятся лениво только в ончейн-режиме.

### Графика
Иконки, фон и ключевой арт — собственные ассеты в `app/src/assets/art` (WebP, хеш в имени → immutable-кеш), PWA-иконки и
Open Graph-картинка — в `app/public/icons`, `app/public/og.jpg`. Исходники (PNG ~17 МБ) в git не хранятся; оптимизированные
файлы собираются воспроизводимо: `app/scripts/build-art.sh <папка с PNG>` (ImageMagick с WebP; можно подать только часть исходников — например, новые `i-*.png` — обновятся только они). Чёрный фон неоновых иконок
превращается в настоящую прозрачность (альфа из яркости + un-premultiply). Бюджет: все картинки ≤ 400 KB, каждая ≤ 160 KB
(`check:bundle`). Иллюстрации лендинга — исходники `land-<имя>.png` (философия: `recursion`, `emergence`, `quantum`; правила:
`harberger`, `energy`, `rewards`, `breach`, `rebellion`, `swap`; фон `bg`) → `app/src/assets/landing/*.webp` (720–960 px, фон 1600 px).
Они грузятся лениво (`loading="lazy"`), не входят в первый экран и имеют отдельный бюджет: ≤ 700 KB всего, ≤ 110 KB каждая. Мелкие UI-глифы — inline-SVG (`app/src/ui/Icon.tsx`), без emoji: они превращаются в «тофу» на системах без шрифта.

### Заголовки безопасности
Единый источник — `app/security.mjs` (CSP, HSTS, X-Frame-Options, Referrer-Policy, Permissions-Policy, COOP/CORP).
Из него генерируются:
- `<meta http-equiv="Content-Security-Policy">` в `index.html` (при сборке);
- `dist/_headers` — Netlify / Cloudflare Pages подхватывают автоматически;
- `app/vercel.json` — Vercel (Root Directory = `app`);
- `app/deploy/nginx.conf` — nginx / Docker.

`npm -w app run check:deploy` (в CI) падает, если закоммиченные `vercel.json`/`nginx.conf` разошлись с `security.mjs`.
После смены политики: `node app/scripts/gen-deploy.mjs`. Кастомный `VITE_RPC_URL`/`VITE_WS_URL` автоматически
добавляется в `connect-src` в `_headers` и meta; для Vercel со своим RPC перегенерируйте `vercel.json` с этими переменными.

### Хостинг
| Платформа | Как |
|---|---|
| Cloudflare Pages / Netlify | build `npm ci --ignore-scripts && npm -w app run build`, output `app/dist` (`_headers` уже внутри) |
| Vercel | Root Directory `app`, настройки из `app/vercel.json` |
| Docker | `docker build -f app/Dockerfile --build-arg VITE_CLUSTER=mainnet-beta --build-arg VITE_RPC_URL=https://… -t recursia-app .` → `docker run -p 8080:8080 recursia-app` (nginx без root, `/healthz`, CSP собирается под ваш RPC) |

### Домен (обязательно для mainnet)
DNSSEC, registry lock, CAA-записи, HSTS preload (`hstspreload.org`), отдельный домен без сторонних скриптов/аналитики.
PROGRAM_ID публикуется в README и на сайте; кошелёк показывает вызываемую программу, превью транзакции — тоже.

### Что делает клиент ради безопасности игрока
- каждая транзакция: симуляция → превью (изменение SKR/SOL из post-state симуляции, CU, комиссия, список программ, логи) → подпись;
- allow-list программ (RECURSIA, Compute Budget, ATA, System) — инструкции чужих программ отвергаются до симуляции;
- свежий blockhash в момент подписи, ребродкаст до подтверждения или истечения `lastValidBlockHeight`;
- приоритетная комиссия по перцентилю `getRecentPrioritizationFees` с жёстким потолком;
- ошибки Anchor → понятные сообщения (`packages/sdk/src/errors.ts`, сверяются с `errors.rs` в тестах);
- лимиты цены (slippage) зашиты в инструкции, а не в UI;
- секреты суперпозиций только в браузере, экспорт/импорт с проверкой владельца;
- нет автоподписи, нет сторонней телеметрии, нет `eval`/inline-скриптов.

## 10. Перед mainnet (чек-лист)
- [ ] Внешний аудит программы (+ исправления, повторная проверка).
- [ ] Trident-фаззинг инструкций с инвариантами из `SDK/model.ts`.
- [ ] Минимум 2–4 недели devnet/testnet с живыми игроками, калибровка параметров по `docs/TOKENOMICS.md`.
- [ ] Bug bounty (Immunefi или аналог).
- [ ] Verified build опубликован, upgrade authority = multisig.
- [ ] Мониторинг: алерты на `propose`, смену upgrade authority, аномальные выводы.
- [ ] Фронтенд: свой RPC с allow-list домена, заголовки проверены (securityheaders.com), DNSSEC/registry lock/CAA, HSTS preload, базовые образы Docker закреплены по digest.

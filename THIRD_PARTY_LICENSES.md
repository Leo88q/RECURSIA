# Сторонние компоненты и лицензии (checklist 7.4)

## Собственные компоненты

| Компонент | Лицензия |
|---|---|
| Смарт-контракт `programs/recursia`, `packages/sdk`, `app`, `keeper`, `tests` | **Не опубликована.** Лицензионного файла в репозитории нет — по умолчанию «All rights reserved»: копирование, изменение и использование кода разрешены только по явному письменному согласию команды. Для mainnet-запуска решение об открытии/закрытии фиксируется юристом. |
| Графика (`app/src/assets/art/*.webp`, `app/src/assets/landing/*.webp`, `app/public/icons/*`, `app/public/og.jpg`) | Собственная генерация команды; исходники (PNG) в git не хранятся, оптимизация — `app/scripts/build-art.sh`. |
| Иконки-глифы (`app/src/ui/Icon.tsx`) | Собственные inline-SVG. |
| Шрифты | **Нет внешних шрифтов.** `font-family` — системный стек (Inter/Segoe UI/system-ui без загрузки с CDN) — внешние запросы на шрифты отсутствуют. |

## npm-зависимости (прямые, по workspace'ам)

| Пакет | Лицензия |
|---|---|
| react, react-dom | MIT |
| @solana/web3.js | MIT |
| @solana/wallet-adapter-base, @solana/wallet-adapter-react, @solana/wallet-adapter-react-ui | Apache-2.0 |
| @noble/hashes | MIT |
| bs58, buffer | MIT |
| vite, @vitejs/plugin-react | MIT |
| typescript | Apache-2.0 |
| vitest, tsx, happy-dom | MIT |
| @types/node, @types/react, @types/react-dom | MIT |
| litesvm (только тесты `tests/chain`, не входит в клиент) | MIT |

Полный список транзитивных зависимостей — в `package-lock.json`; установка идёт через
`npm ci --ignore-scripts` (скрипты установки сторонних пакетов отключены — supply-chain гигиена,
см. `.npmrc` и job `hygiene` в CI). Известные уязвимости: `npm audit --audit-level=high` в CI
(High/Critical блокируют merge).

## Сторонние сетевые сервисы (не код)

| Сервис | Назначение |
|---|---|
| Публичные RPC Solana (`api.devnet.solana.com` и т.д.) или провайдер, настроенный через `VITE_RPC_URL` | запросы к блокчейну напрямую из браузера; провайдерами выбираются с allow-list домена и лимитами (RPC-ключ в клиент не попадает) |
| ORAO VRF (программа-оракул на Solana) | проверяемая случайность для квантового слоя |
| Squads (multisig) — только у команды, не из браузера | администрирование программы |
| GitHub | репозиторий, CI, security advisories (см. `/.well-known/security.txt`) |

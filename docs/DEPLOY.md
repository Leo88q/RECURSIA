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
# затем обновите PROGRAM_ID в packages/sdk/src/pda.ts и пересоберите
```

## 2. Сборка и проверка
```bash
npm ci --ignore-scripts
npm test                       # SDK + keeper
npm run econ                   # экономическая симуляция, все инварианты должны пройти
cargo test -p recursia && cargo clippy -p recursia -- -D warnings
anchor build
npx -w packages/sdk tsx scripts/check-idl.ts ../../target/idl/recursia.json
```
Для verified build: `solana-verify build` и публикация `solana-verify verify-from-repo` после деплоя.

## 3. Devnet
```bash
solana config set -u devnet
solana airdrop 5
anchor deploy --provider.cluster devnet
```

## 4. initialize → genesis
`initialize` может вызвать **только текущая upgrade authority** (защита от фронт-рана инициализации).
Передайте `admin` = адрес vault'а вашего Squads multisig. Сразу после:

1. `genesis(distribution)` — подписывает admin (через Squads). Минтит 45/10/45 и **навсегда** отзывает mint authority.
2. Проверьте: `spl-token display <MINT>` → `Mint authority: (not set)`, `Freeze authority: (not set)`, supply = 1 000 000 000.

Скрипты можно собрать из `RecursiaIx.initialize(...)` / `RecursiaIx.genesis(...)` в SDK; через Squads — «Transaction builder → Import base58».

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

## 9. Клиент
```bash
VITE_RPC_URL=https://<ваш RPC> VITE_PROGRAM_ID=<PROGRAM_ID> npm -w app run build
```
Кастомный RPC автоматически попадает в CSP. Раздавайте `app/dist` со статического хостинга с HTTPS, HSTS, DNSSEC и registry lock на домене.

## 10. Перед mainnet (чек-лист)
- [ ] Внешний аудит программы (+ исправления, повторная проверка).
- [ ] Trident-фаззинг инструкций с инвариантами из `SDK/model.ts`.
- [ ] Минимум 2–4 недели devnet/testnet с живыми игроками, калибровка параметров по `docs/TOKENOMICS.md`.
- [ ] Bug bounty (Immunefi или аналог).
- [ ] Verified build опубликован, upgrade authority = multisig.
- [ ] Мониторинг: алерты на `propose`, смену upgrade authority, аномальные выводы.

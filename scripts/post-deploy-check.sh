#!/usr/bin/env bash
# Пост-деплой проверки (checklist 2.2 + раздел 9 «Внешние пассивные проверки»).
#
#   scripts/post-deploy-check.sh https://your-domain.tld
#
# Что проверяется:
#   1. Чувствительные пути не отдаются содержимым (SPA должен вернуть index.html
#      ТОЛЬКО на «игровых» путях; /.git, /.env, /package.json — 403/404/редирект).
#   2. Заголовки безопасности присутствуют (CSP, HSTS, nosniff, frame-ancestors…).
#   3. HTTP → HTTPS редирект.
#   4. В JS-бандле нет sourceMappingURL и длинных base58-ключей.
#   5. security.txt, robots.txt, favicon отдаются.
set -uo pipefail

DOMAIN=${1:?использование: $0 https://your-domain.tld}
DOMAIN=${DOMAIN%/}
BASE="${DOMAIN%/}"
[ "${DOMAIN:0:5}" = "https" ] || { echo "ожидался https://-URL"; exit 2; }
HOST=${DOMAIN#https://}

fail=0
note() { printf '  %s\n' "$*"; }
bad()  { printf '  [FAIL] %s\n' "$*"; fail=1; }
ok()   { printf '  [ok]   %s\n' "$*"; }

echo "=== 1. Чувствительные пути (ожидаем НЕ-200 ИЛИ index.html-SPA 404-обёртку) ==="
# Для статического хостинга (Vercel/Netlify/nginx) неизвестные пути могут вернуть
# index.html (200) — это ожидаемо для SPA. Запрещено: отдача РЕАЛЬНЫХ файлов .git/.env.
while IFS= read -r p; do
  body_head=$(curl -s -L --max-time 15 -o /tmp/pdc_body -w '%{http_code}' "$BASE/$p")
  if grep -qE 'BEGIN (RSA |EC )?PRIVATE KEY|-----BEGIN' /tmp/pdc_body 2>/dev/null; then
    bad "$p — в теле PRIVATE KEY!"
  elif grep -qE '"name":\s*"recursia"|package-lock\.json' /tmp/pdc_body 2>/dev/null; then
    bad "$p — похоже на package.json/lock!"
  elif grep -qE '^ref: |^\[core\]|core\.repositoryformatversion' /tmp/pdc_body 2>/dev/null; then
    bad "$p — похоже на .git-файл!"
  else
    note "$p -> $body_head (проверено по содержимому)"
  fi
done <<'PATHS'
.git/HEAD
.git/config
.env
.env.local
.env.production
.DS_Store
package.json
package-lock.json
yarn.lock
pnpm-lock.yaml
docker-compose.yml
Dockerfile
.github/workflows/ci.yml
src/
server/
admin/
backup.zip
dump.sql
.npmrc
.gitignore
README.md
PATHS

echo
echo "=== 2. Заголовки безопасности ==="
hdrs=$(curl -sI --max-time 15 "$BASE/")
for h in "strict-transport-security" "content-security-policy" "x-content-type-options" "x-frame-options" "referrer-policy" "permissions-policy"; do
  if echo "$hdrs" | grep -qi "^${h}:"; then
    v=$(echo "$hdrs" | grep -i "^${h}:" | head -1 | sed 's/^[^:]*: *//' | cut -c1-80)
    ok "$h: $v"
  else
    bad "нет заголовка: $h"
  fi
done
if echo "$hdrs" | grep -qiE '^server:.*version' || echo "$hdrs" | grep -qi '^x-powered-by:'; then
  bad "Server/X-Powered-By раскрывает версию"
else
  ok "Server/X-Powered-By без версий"
fi
# frame-ancestors в CSP (кликджекинг на экранах подписи)
if echo "$hdrs" | grep -i '^content-security-policy:' | grep -q "frame-ancestors 'none'"; then
  ok "CSP: frame-ancestors 'none'"
else
  bad "CSP без frame-ancestors 'none'"
fi

echo
echo "=== 3. HTTP → HTTPS ==="
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "http://$HOST/" 2>/dev/null || echo "ERR")
loc=$(curl -sI --max-time 15 "http://$HOST/" 2>/dev/null | grep -i '^location:' | head -1 | tr -d '\r')
case "$code" in
  301|302|307|308) ok "http -> $code $loc" ;;
  200) bad "http отдаёт 200 без редиректа (mixed risk)" ;;
  *) note "http: $code (приватный IP/локальный хост? — проверьте вручную)" ;;
esac

echo
echo "=== 4. JS-бандл: source maps и базовые утечки ==="
html=$(curl -s --max-time 15 "$BASE/")
for js in $(echo "$html" | grep -oE 'src="[^"]+\.js"' | sed -E 's/src="(.*)"/\1/' | tr -d '"'); do
  case "$js" in http*) url="$js";; *) url="$BASE/$js";; esac
  case "$url" in
    *sourceMappingURL*) bad "$js — sourceMappingURL в HTML?";;
  esac
  if curl -s --max-time 20 "$url" | tail -c 500 | grep -q 'sourceMappingURL'; then
    bad "$js — sourceMappingURL в бандле"
  else
    ok "$js — без sourceMappingURL"
  fi
  if curl -s --max-time 20 "$url" | grep -qP '\b[1-9A-HJ-NP-Za-km-z]{87,88}\b'; then
    bad "$js — string 87–88 base58 (возможный приватный ключ)!"
  fi
done

echo
echo "=== 5. Service-файлы ==="
for p in .well-known/security.txt robots.txt manifest.webmanifest favicon.svg; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/$p")
  [ "$code" = "200" ] && ok "$p -> 200" || bad "$p -> $code"
done

echo
if [ "$fail" = 0 ]; then echo "РЕЗУЛЬТАТ: все проверки пройдены (с оговорками 'note' — осмотрите вручную)"; else echo "РЕЗУЛЬТАТ: ЕСТЬ НАХОДКИ — см. [FAIL]"; fi
exit $fail

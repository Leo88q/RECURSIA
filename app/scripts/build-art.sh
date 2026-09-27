#!/usr/bin/env bash
# Reproducible art pipeline: raw generated PNGs (kept OUT of git, ~17 MB) →
# optimised assets committed to the repo (~0.3 MB).
#   usage: app/scripts/build-art.sh <dir with raw PNGs>
# Requires ImageMagick 6/7 with WebP. Raw files: logo.png, bg.png, hero.png, i-<name>.png
#
# Icons are neon-on-black renders; black is turned into real transparency by
# deriving alpha from the brightest channel and un-premultiplying the colour,
# so the glow blends correctly over any panel background.
set -euo pipefail
SRC="${1:?raw art dir}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
ART="$HERE/src/assets/art"; PUB="$HERE/public"
mkdir -p "$ART" "$PUB/icons"
IM=convert; command -v magick >/dev/null && IM="magick"

# glow-on-black → RGBA: alpha = clamp(max(r,g,b)·k), rgb = rgb / alpha
keyblack() { # in size out
  local tmp; tmp="$(mktemp --suffix=.png)"
  $IM "$1" -fuzz 6% -trim +repage "$tmp"
  local side; side="$($IM identify -format '%[fx:ceil(max(w,h)*1.08)]' "$tmp" 2>/dev/null || identify -format '%[fx:ceil(max(w,h)*1.08)]' "$tmp")"
  $IM "$tmp" -gravity center -background black -extent "${side}x${side}" -resize "${2}x${2}" -colorspace sRGB "$tmp"
  # alpha = clamp(max(r,g,b)·1.35); rgb = rgb / alpha  (un-premultiply, keeps the hue)
  $IM "$tmp" -separate -evaluate-sequence max -evaluate multiply 1.35 "${tmp%.png}-a.png"
  $IM "$tmp" "${tmp%.png}-a.png" -compose Divide_Src -composite "${tmp%.png}-c.png"
  $IM "${tmp%.png}-c.png" "${tmp%.png}-a.png" -alpha off -compose CopyOpacity -composite \
    -strip -define webp:alpha-quality=90 -define webp:method=6 -quality 90 "$3"
  rm -f "${tmp%.png}-a.png" "${tmp%.png}-c.png"
  rm -f "$tmp"
}

for f in "$SRC"/i-*.png; do
  n="$(basename "$f" .png)"; n="${n#i-}"
  keyblack "$f" 96 "$ART/$n.webp"
done
keyblack "$SRC/logo.png" 160 "$ART/logo.webp"

# backgrounds (opaque)
$IM "$SRC/bg.png" -resize '1920x>' -modulate 125,115 -strip -quality 84 -define webp:method=6 "$ART/bg.webp"
$IM "$SRC/hero.png" -resize '1200x>' -strip -quality 76 -define webp:method=6 "$ART/hero.webp"

# PWA / favicon / social (stable URLs → public/)
for s in 32 180 192 512; do
  $IM "$SRC/logo.png" -resize "${s}x${s}" -strip +dither -colors 128 -define png:compression-level=9 "$PUB/icons/icon-$s.png"
done
# maskable: logo inside the 80% safe zone on the brand background
$IM -size 512x512 xc:'#07060f' \( "$SRC/logo.png" -resize 380x380 \) -gravity center -composite -strip +dither -colors 128 -define png:compression-level=9 "$PUB/icons/maskable-512.png"
# Open Graph 1200×630: key art, darkened toward the bottom for link previews
$IM "$SRC/hero.png" -resize 1200x630^ -gravity center -extent 1200x630 \
  \( -size 1200x630 gradient:'rgba(7,6,15,0)-rgba(7,6,15,0.55)' \) -composite \
  -strip -quality 82 "$PUB/og.jpg"
for p in "$PUB"/icons/*.png; do command -v optipng >/dev/null && optipng -quiet -o2 "$p" || true; done
du -ch "$ART"/* "$PUB"/icons/* "$PUB/og.jpg" | tail -1

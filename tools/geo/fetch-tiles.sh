#!/usr/bin/env bash
# Готовит свою подложку карты поиска по геоданным ([geo-search] tiles = pmtiles):
#   1) вырезает Европу и Россию (region.geojson) из ежедневной сборки Protomaps — скачиваются только нужные тайлы;
#   2) скачивает basemaps-assets (шрифты и спрайты для стиля MapLibre), если их ещё нет.
#
#   tools/geo/fetch-tiles.sh <каталог> [дата сборки YYYYMMDD] [максимальный зум]
#
# Нужен pmtiles CLI: https://github.com/protomaps/go-pmtiles/releases (один бинарник).
# Файл заменяется атомарно (mv в том же каталоге) — сервер приложения перезапускать не нужно.
set -euo pipefail

DEST=${1:?"укажите каталог, например /srv/foottracker/geo"}
DATE=${2:-$(date -u -d yesterday +%Y%m%d)}
MAXZOOM=${3:-14}
HERE=$(cd "$(dirname "$0")" && pwd)

command -v pmtiles >/dev/null || { echo "нужен pmtiles CLI: https://github.com/protomaps/go-pmtiles/releases" >&2; exit 1; }
mkdir -p "$DEST"

echo "Сборка Protomaps $DATE, зум 0–$MAXZOOM → $DEST/europe-russia.pmtiles"
pmtiles extract "https://build.protomaps.com/$DATE.pmtiles" "$DEST/europe-russia.pmtiles.tmp" \
  --region="$HERE/region.geojson" --maxzoom="$MAXZOOM" --download-threads=4
mv -f "$DEST/europe-russia.pmtiles.tmp" "$DEST/europe-russia.pmtiles"

if [ ! -d "$DEST/basemaps-assets/fonts" ]; then
  echo "basemaps-assets → $DEST/basemaps-assets"
  curl -fsSL https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.tar.gz | tar -xz -C "$DEST"
  rm -rf "$DEST/basemaps-assets"
  mv "$DEST/basemaps-assets-main" "$DEST/basemaps-assets"
fi

pmtiles show "$DEST/europe-russia.pmtiles" | head -n 20

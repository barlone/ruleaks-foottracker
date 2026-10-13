# Подложка карты поиска по геоданным

Раздел «Поиск по геоданным» (`[config] geo-search = true`) рисует карту MapLibre GL. Подложка — `[geo-search] tiles`:

| `tiles` | Что это | Где |
|---|---|---|
| `raster` | растровые тайлы публичного сервера (`raster-url`, по умолчанию tile.openstreetmap.org) | только разработка: правила OSM не допускают продакшен-нагрузку, и сервер тайлов видит, какие районы смотрят |
| `pmtiles` | свои векторные тайлы [Protomaps](https://protomaps.com) — один файл `.pmtiles` + шрифты и спрайты | продакшен |

При `tiles = pmtiles` с путями на сервере отдельного тайл-сервера нет: сервер приложения отдаёт файл по
`/geo/tiles.pmtiles`, а `basemaps-assets` по `/geo/assets/…`, только вошедшим пользователям
(`apps/server/src/geo-files.ts`). Браузер читает нужные куски `.pmtiles` Range-запросами (библиотека `pmtiles`).

## Подготовка файла (на LXC-хосте)

1. Поставить [pmtiles CLI](https://github.com/protomaps/go-pmtiles/releases): это один бинарник, его кладут в `/usr/local/bin`.
2. Оценить размер, ничего не скачивая:
   ```bash
   pmtiles extract https://build.protomaps.com/20261007.pmtiles /tmp/x.pmtiles --region=tools/geo/region.geojson --maxzoom=14 --dry-run
   ```
3. Вырезать регион и скачать шрифты и спрайты:
   ```bash
   bash tools/geo/fetch-tiles.sh /srv/foottracker/geo            # сборка за вчера, зум до 14
   bash tools/geo/fetch-tiles.sh /srv/foottracker/geo 20261007 14 # конкретная сборка и зум
   ```
   Получится `/srv/foottracker/geo/europe-russia.pmtiles` и `/srv/foottracker/geo/basemaps-assets/` (`fonts/`, `sprites/`).
4. В `config.ini`:
   ```ini
   [config]
   geo-search = true

   [geo-search]
   tiles = pmtiles
   pmtiles = /srv/foottracker/geo/europe-russia.pmtiles
   assets = /srv/foottracker/geo/basemaps-assets
   max-zoom = 17
   ```
5. Прокси перед сервером должен пропускать `/geo/*` так же, как `/trpc`:
   - Caddy: `reverse_proxy /geo/* 127.0.0.1:3001`;
   - nginx: `location /geo/ { proxy_pass http://127.0.0.1:3001; }`. Заголовок `Range` nginx передаёт сам; gzip для `/geo/` не включать, тайлы внутри файла уже сжаты.

## Подробности

- **Регион.** `region.geojson` — грубый контур Европы (с Турцией и Кавказом) и России с запасом по границам.
  Чукотка восточнее 180° выделена отдельным многоугольником. Лишние куски Казахстана, Монголии и моря почти ничего не весят.
- **Зум.** Тайлы в файле — до 14, это меньше места. MapLibre увеличивает векторные тайлы дальше без потери качества,
  поэтому предел зума на самой карте (`max-zoom`) может быть выше.
- **Обновление.** Раз в месяц–квартал повторить `fetch-tiles.sh`. Файл заменяется атомарно, перезапуск не нужен.
  Ежедневные сборки Protomaps хранятся ограниченное время, поэтому берите свежую дату.
- **Атрибуция.** «Protomaps © OpenStreetMap» выводится на карте автоматически, убирать её нельзя (лицензия ODbL).
- **Разработка без файла.** В `pmtiles` и `assets` можно указать https-адреса, тогда браузер ходит туда сам:
  `pmtiles = https://build.protomaps.com/<дата>.pmtiles`, `assets = https://protomaps.github.io/basemaps-assets`.
  Это только для проверки: Protomaps не рассчитаны на такую нагрузку.

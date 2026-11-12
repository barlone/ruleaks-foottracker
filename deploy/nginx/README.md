# nginx для прода: заголовки безопасности

Аудит безопасности, пункты 7 (нет защиты от clickjacking, MIME-sniffing, нет CSP) и 8 (внешние картинки в общих
досье). Страницу и статику на проде отдаёт nginx, а не Fastify, поэтому заголовки ставятся здесь.

| Файл | Что это |
|---|---|
| `foottracker-security.conf` | Сниппет `add_header`: X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, COOP, HSTS, CSP |
| `foottracker.conf.example` | Образец `server { }`: где подключать сниппет, real_ip от Cloudflare, кэш сборки |

## Установка

1. Задеплоить код этого коммита (`git pull`, `npm run build`): inline-скрипт темы вынесен в `/theme-init.js`,
   без этого CSP заблокирует его, и светлая тема будет мигать тёмной при загрузке.
2. `sudo cp deploy/nginx/foottracker-security.conf /etc/nginx/snippets/`
3. В своём `server { }` добавить `include /etc/nginx/snippets/foottracker-security.conf;`
   - на уровне `server` — для `/trpc/`, `/geo/`, `/scans/`;
   - **и внутрь каждого `location` со своим `add_header`** (у нас `location /` с `Cache-Control`): nginx не наследует
     `add_header` с уровня выше, если в `location` есть хоть один свой. Это самая частая ошибка — проверить шагом 5.
4. `sudo nginx -t && sudo systemctl reload nginx`
5. Проверка:
   ```bash
   curl -sI https://<сайт>/ | grep -iE 'x-frame|nosniff|referrer|content-security|permissions|strict-transport|opener'
   curl -sI https://<сайт>/dossiers | grep -ci content-security      # SPA fallback — тоже 1
   curl -sI "https://<сайт>/trpc/auth.mode" | grep -ci x-frame       # ответы приложения — тоже 1
   ```

## CSP: в два шага

Сниппет ставит `Content-Security-Policy-Report-Only`: ничего не блокирует, нарушения пишутся в консоль браузера
(«[Report Only] Refused to …»). Пройтись по сайту под своим входом: досье с фото и видео с Диска, граф расследования,
поиск по геоданным (карта), поиск по Google с фото профиля, сканы документов, экспорт PDF/файла, импорт. Если в консоли
пусто — заменить в сниппете имя заголовка на `Content-Security-Policy` и снова `reload`.

На сборке (локально, `apps/web/dist` с этими заголовками) уже проверено: список досье, досье с медиа, граф,
страницы поиска — без нарушений. Карта грузила растровые тайлы `tile.openstreetmap.org` (`[geo-search] tiles = raster`,
режим для разработки) — CSP их заблокировал. Если на проде в `[geo-search]` `tiles`/`assets` стоят https-адреса,
их хосты надо дописать в `connect-src`; локальные пути (`pmtiles` с сервера) работают как есть.

## Пункт 8: что закрыто, а что нет

- `Referrer-Policy: no-referrer` — чужой сервер не видит адрес страницы (id досье, запрос поиска с ФИО или телефоном).
- **IP и время просмотра** внешний сервер картинки по-прежнему видит: браузер зрителя грузит её напрямую. Закрыть
  это в nginx можно только строгим `img-src` (вариант описан в конце сниппета): внешние картинки перестанут
  показываться. На проде их 3 (dossier.center, archive.is, occrp.org) — перезалить файлами или положить на Диск.
  Без потери внешних картинок это решается только в коде: сервер скачивает картинку при сохранении в медиа.

## Связанное

- `[server] trust-proxy = 127.0.0.1` в `config.ini` — вместе с блоком real_ip из образца (адрес клиента для лимита
  попыток пароля). Числа там быть не может: сервер не запустится.
- Если HSTS уже включён в Cloudflare (SSL/TLS → Edge Certificates), строку `Strict-Transport-Security` в сниппете
  можно убрать — заголовок придёт дважды, браузеру это не мешает.

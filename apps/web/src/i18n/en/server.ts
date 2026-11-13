// Английский перевод: тексты, которые приходят с сервера (ошибки шлюза, причины, заметки хода поиска) — переводятся tx(). Ключ — русский текст из кода (lib/i18n.ts).
const en: Record<string, string> = {
  // apps/server/src/adapters/http/gateway.ts — ошибки шлюза (коды 1–8) и связи с ним
  'Нет доступа к этому поиску': 'No access to this search',
  'Неверные параметры запроса': 'Invalid request parameters',
  'Неверные параметры запроса: {text}': 'Invalid request parameters: {text}',
  'Неизвестная задача': 'Unknown job',
  'База данных поиска недоступна, попробуйте позже': 'The search database is unavailable, try again later',
  'Система перегружена, попробуйте повторить запрос через несколько минут': 'The system is overloaded, try again in a few minutes',
  'База данных временно на обслуживании. Повторите запрос через 20–30 минут': 'The database is under maintenance. Try again in 20–30 minutes',
  'API-сервер перезапускается, повторите запрос через минуту': 'The API server is restarting, try again in a minute',
  'Результат устарел — повторите запрос': 'The result has expired — run the search again',
  'API-сервер не ответил вовремя': 'The API server did not respond in time',
  'API-сервер недоступен: {error}': 'The API server is unavailable: {error}',
  'API-сервер не принял токен пользователя (401)': 'The API server rejected the user’s token (401)',
  'API-сервер не может проверить токен, повторите позже (503)': 'The API server cannot check the token, try again later (503)',
  'API-сервер вернул {status}: {text}': 'The API server returned {status}: {text}',
  'Неожиданный ответ API-сервера: {body}': 'Unexpected API server response: {body}',
  'Ошибка API-сервера {code}': 'API server error {code}',
  'Ошибка API-сервера {code}: {text}': 'API server error {code}: {text}',

  // apps/server/src/adapters/memory/gateway.ts
  'Неизвестный путь {path}': 'Unknown path {path}',
  'Результат устарел, повторите запрос': 'The result has expired, run the search again',

  // apps/server/src/adapters/botdb/bot.ts, adapters/memory/bot.ts — причины отказа в доступе, dev-вход
  'Токен не установлен': 'Token not set',
  'Токен отключен администратором': 'Token disabled by the administrator',
  'Подписка не оформлена': 'No subscription',
  'Подписка истекла {date}': 'Subscription expired on {date}',
  'Вход без бота выключен ([server] dev-login)': 'Login without the bot is disabled ([server] dev-login)',
  'Укажите Telegram ID пользователя бота': 'Enter the bot user’s Telegram ID',
  'Пользователь с Telegram ID {tgId} не найден в базе бота': 'No user with Telegram ID {tgId} in the bot database',
  'Ссылка входа устарела, обновите страницу': 'The login link has expired, reload the page',
  'Ссылка входа устарела': 'The login link has expired',
  'В демо-режиме вход по демо-учётке': 'In demo mode, log in with a demo account',

  // apps/server/src/adapters/solo.ts
  'Вход через бота выключен ([config] auth)': 'Login via the bot is disabled ([config] auth)',

  // apps/server/src/ports.ts — имя нового пользователя, если бот его не сообщил
  'Пользователь бота': 'Bot user',

  // apps/server/src/adapters/memory/store.ts — предопределённые типы связей (как в миграции dossier-relations)
  'родственник': 'relative',
  'совместная работа': 'worked together',
  'совместная учеба': 'studied together',
  'совместная служба': 'served together',

  // apps/server/src/routers/auth.ts
  'Telegram ID — только цифры': 'Telegram ID — digits only',

  // apps/server/src/routers/dossiers.ts — подробность MEDIA_QUOTA (MEDIA_TOO_LARGE — «{size} КБ» из shared)
  'занято {used} КБ из {max}': '{used} KB of {max} used',

  // apps/server/src/routers/search.ts
  'Укажите Telegram ID, @ник или телефон': 'Enter a Telegram ID, @nickname or phone number',
  'Пользователь @{nick} не найден': 'User @{nick} not found',
  'Не удалось найти пользователя Telegram с таким номером телефона': 'No Telegram user found with this phone number',
  'тел. {phone}': 'phone {phone}',
  'Отметьте атрибуты для второго шага поиска': 'Select attributes for the second search step',
  'Второй шаг поиска невозможен: не выбраны атрибуты, по которым искать': 'The second search step is impossible: no attributes to search by are selected',
  'Марка авто — минимум 3 буквы или цифры': 'Car make — at least 3 letters or digits',
  'Поиск не завершился за {sec} с — повторите запрос позже': 'The search did not finish in {sec} s — try again later',
  // и export/attrPick.ts
  'Поиск ещё не завершён': 'The search has not finished yet',

  // apps/server/src/search/step2.ts
  'Второй шаг поиска прервался из-за ошибки на сервере': 'The second search step was interrupted by a server error',
  'не выполнялся: несколько ошибок подряд': 'not run: several errors in a row',

  // apps/server/src/search/wait.ts
  'Шлюз не ответил вовремя': 'The API server did not respond in time',

  // apps/server/src/export/read.ts — подробности ImportError (BAD_FILE: …)
  'распакованный объём больше предела': 'unpacked size exceeds the limit',
  'не ZIP-архив': 'not a ZIP archive',
  'нет version.vN': 'no version.vN',
  'нет meta.info': 'no meta.info',
  'нет {file}': '{file} is missing',
  'не читается {path}': 'cannot read {path}',
  'неверный формат': 'invalid format',
  'больше одного расследования': 'more than one investigation',
  'повторяются ключи досье': 'duplicate dossier keys',
  'повторяются uid досье': 'duplicate dossier uids',
  'повторяются ключи снимков': 'duplicate snapshot keys',
  'повторяются ключи в расследовании': 'duplicate keys in the investigation',
  'нет корневого объекта': 'no root object',

  // apps/server/src/export/import.ts
  'Поиск не был завершён на момент экспорта': 'The search had not finished when it was exported',
  'неверные данные': 'invalid data',
  '{where}: неверные данные': '{where}: invalid data',
  'досье «{title}»': 'dossier “{title}”',
  'расследование «{title}»': 'investigation “{title}”',
  '{where}: слишком большой граф': '{where}: graph is too large',

  // apps/server/src/google/hunter.ts — googleErrorText и названия частей отчёта
  'Внутренняя ошибка поиска по Google': 'Internal Google search error',
  'Google отклонил служебный аккаунт сайта — поиск недоступен, пока администратор не обновит доступ':
    'Google rejected the site’s service account — search is unavailable until the administrator renews access',
  'Google временно ограничил запросы с этого сервера — повторите позже': 'Google is temporarily limiting requests from this server — try again later',
  'Google не ответил вовремя — повторите поиск': 'Google did not respond in time — run the search again',
  'Google ответил не так, как ожидалось — возможно, сервис изменился': 'Google answered unexpectedly — the service may have changed',
  'Карты': 'Maps',
  'Drive: приложение-источник': 'Drive: source app',
  'Drive: содержимое папки': 'Drive: folder contents',
  'Drive: комментарии': 'Drive: comments',
  'Геокодер': 'Geocoder',

  // apps/server/src/google/account.ts
  'отменено в очереди Google': 'cancelled in the Google queue',

  // apps/server/src/google/knowledge.ts — DRIVE_MIME_LABELS
  'Аудио': 'Audio',
  'Google Документ': 'Google Doc',
  'Ярлык стороннего приложения': 'Third-party app shortcut',
  'Google Рисунок': 'Google Drawing',
  'Файл Google Диска': 'Google Drive file',
  'Папка Google Диска': 'Google Drive folder',
  'Google Форма': 'Google Form',
  'Google Мои карты': 'Google My Maps',
  'Фото': 'Photo',
  'Google Презентация': 'Google Slides',
  'Ярлык': 'Shortcut',
  'Google Сайт': 'Google Site',
  'Google Таблица': 'Google Sheet',
  'Неизвестный тип': 'Unknown type',
  'Видео': 'Video',
  'Документ Word': 'Word document',
  'Документ Word (OpenXML)': 'Word document (OpenXML)',
  'Презентация PowerPoint с макросами': 'Macro-enabled PowerPoint presentation',
  'Таблица Excel': 'Excel spreadsheet',
  'Таблица Excel (OpenXML)': 'Excel spreadsheet (OpenXML)',
  'Android-пакет (APK)': 'Android package (APK)',
  'ZIP-архив': 'ZIP archive',
  'Изображение JPEG': 'JPEG image',
  'Аудио MPEG': 'MPEG audio',
  'Видео MPEG': 'MPEG video',
  'Текст': 'Text',

  // apps/server/src/google/demo.ts
  'имитации для «{mode}» нет — этот вид работает без аккаунта': 'no demo for “{mode}” — this mode works without an account',

  // apps/server/src/pages/check.ts — заметки проверки сайта (status unknown)
  'нет соединения (таймаут)': 'no connection (timeout)',
  'нет ответа (таймаут)': 'no response (timeout)',
  'соединение оборвано': 'connection dropped',
  'адрес не найден (DNS)': 'address not found (DNS)',
  'соединение отклонено': 'connection refused',
  'соединение сброшено': 'connection reset',
  'хост недоступен': 'host unreachable',
  'сеть недоступна': 'network unreachable',
  'отменено': 'cancelled',
  'ошибка TLS-сертификата': 'TLS certificate error',
  'не получена cookie для проверки': 'the check cookie was not received',

  // apps/server/src/pages/outbound.ts
  'адрес во внутренней сети': 'address on an internal network',
  'схема {scheme} не разрешена': 'scheme {scheme} is not allowed',
  'адрес {host} не найден': 'address {host} not found',

  // apps/server/src/email/report.ts — причины пропуска частей и заметки хода
  'выключено в настройках сервера': 'disabled in the server settings',
  'на сервере не задан ключ API сервиса': 'the service API key is not set on the server',
  'у адреса Gmail домен принадлежит Google': 'a Gmail address’s domain belongs to Google',
  'у бесплатного почтового сервиса домен общий для всех': 'a free email service’s domain is shared by everyone',
  'домен одноразовых ящиков общий для всех': 'a disposable mailbox domain is shared by everyone',
  'не проверялось': 'not checked',
  'нет данных DNS о почтовых серверах домена': 'no DNS data on the domain’s mail servers',
  'в очереди к Google': 'queued for Google',
  'Отменено': 'Cancelled',
  '{done} из {total}': '{done} of {total}',

  // apps/server/src/email/http.ts — emailErrorText
  'Внутренняя ошибка проверки': 'Internal check error',
  'Сервис не принял ключ API сайта — проверка недоступна, пока администратор не обновит ключ':
    'The service rejected the site’s API key — the check is unavailable until the administrator updates the key',
  'Исчерпан лимит запросов к сервису — повторите позже': 'The service request limit is exhausted — try again later',
  'Сервис не ответил вовремя — повторите поиск': 'The service did not respond in time — run the search again',
  'Сервис недоступен — нет соединения': 'The service is unavailable — no connection',
  'Сервис ответил не так, как ожидалось — возможно, он изменился или закрыт': 'The service answered unexpectedly — it may have changed or shut down',

  // apps/server/src/email/jobs.ts
  'Внутренняя ошибка поиска': 'Internal search error',

  // apps/server/src/email/dns.ts — названия почтовых провайдеров и сервисов («Рамблер» — в shared)
  'Яндекс 360': 'Yandex 360',
  'Спринтхост': 'Sprinthost',
  'Мастерхост': 'Masterhost',
  'Джино': 'Jino',
  'Хостинг Украина': 'Hosting Ukraine',
  'Яндекс': 'Yandex',
  'Битрикс24': 'Bitrix24',

  // Итоги снимков поиска, сохранённые в досье прежними версиями сайта (до перевода — всегда по-русски, без форм числа).
  '{n} утечек': '{n} leaks',
  '{n} утечек, вторым шагом добавлено значений: {added}': '{n} leaks, values added by the second step: {added}',
  '{n} связанных значений': '{n} linked values',
  '{n} сообщ.': '{n} msg.',
  '{n} сообщ. (не все)': '{n} msg. (not all)',
  '{n} реакц.': '{n} reactions',
  '{n} авт.': '{n} authors',
  '{n} польз., {m} сообщ.': '{n} users, {m} msg.',
};

export default en;

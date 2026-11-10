# Анализ архитектуры, возможностей и требований проекта GHunt (v2)

> **Репозиторий:** [https://github.com/mxrch/GHunt](https://github.com/mxrch/GHunt)  
> **Версия:** 2.3.4+ (Архитектура v2, полная поддержка Python 3.10–3.13)  
> **Лицензия:** GNU Affero General Public License v3.0 (AGPL-3.0)  
> **Автор:** [mxrch](https://github.com/mxrch) (в сотрудничестве с Malfrats Industries / HideAndSec)

---

## 1. Введение и концепция проекта

**GHunt** — это модульный асинхронный фреймворк на Python для проведения OSINT (разведки по открытым источникам) и аудита безопасности в экосистеме сервисов **Google**. 

В отличие от первой версии (v1), где использовался ручной парсинг сырых cookies браузера и синхронные запросы, **GHunt v2** представляет собой полнофункциональный программный комплекс с собственной объектно-ориентированной архитектурой:
- **Полная асинхронность:** сетевой стек построен на `httpx` (с поддержкой HTTP/2) и `asyncio`.
- **Эмуляция Android Device & OAuth:** получение мастер-токена Android Play Services позволяет автоматически перевыпускать сессионные cookies и сервисные токены Google без необходимости регулярного ручного ввода.
- **Работа как CLI, так и Library:** фреймворк можно использовать как утилиту командной строки или импортировать в собственные Python-проекты (`import ghunt`).
- **Связка с расширением для браузера:** официальное расширение **GHunt Companion** перехватывает первичный авторизационный токен и передает его в CLI через локальный HTTP-сервер-листнер или Base64.
- **Машиночитаемый экспорт:** поддержка аргумента `--json` для сохранения собранного цифрового следа в структурированном виде.

---

## 2. Системные требования и зависимости

### 2.1. Требования к среде исполнения
- **ОС:** Linux (рекомендуется Kali, Debian, Ubuntu), macOS, Windows.
- **Python:** `Python >= 3.10` (протестировано до Python 3.13 включительно).
- **Менеджер пакетов:** `pipx` (рекомендуется разработчиком для CLI во избежание конфликта зависимостей) или `poetry` / `pip` (для разработки и использования в качестве библиотеки).

### 2.2. Ключевые зависимости (`pyproject.toml` / `requirements.txt`)
* **Сетевой уровень и HTTP:**
  * `httpx[http2] (^0.27.2)` — современный асинхронный HTTP-клиент с поддержкой HTTP/2.
  * `dnspython (^2.7.0)` — низкоуровневая работа с DNS-записями.
* **Сериализация и парсинг протоколов Google:**
  * `protobuf (^5.28.2)` — декодирование и кодирование структур Protocol Buffers (основа внутренних API Google).
  * `beautifulsoup4 (^4.12.3)` — разбор промежуточных HTML-форм Google ServiceLogin/SetOSID.
  * `jsonpickle (^3.3.0)` — сложная сериализация графа объектов GHunt в JSON.
* **Геопространственные библиотеки:**
  * `geopy (^2.4.1)` — расчет дистанций по геодезической линии и обратное геокодирование адресов через OpenStreetMap / Nominatim.
* **Обработка медиа:**
  * `pillow (^12.1.0)`, `imagehash (^4.3.1)` — анализ, вычисление хешей и сравнение профильных аватарок.
* **Интерфейс командной строки и вывод:**
  * `rich (^13.9.1)`, `rich-argparse (^1.5.2)` — форматированный цветной консольный вывод таблиц, дерева данных и стилизованная справка.
  * `alive-progress (^3.1.5)` — анимированные прогресс-бары выполнения тяжелых запросов.
  * `humanize (^4.10.0)`, `inflection (^0.5.1)` — читабельное представление дат, таймстемпов, размеров файлов и терминов.
* **Оптимизация памяти:**
  * `autoslot (^2022.12.1)` — автоматическое создание `__slots__` в датаклассах для снижения потребления RAM при обработке массивов данных.

---

## 3. Архитектура аутентификации и работа с токенами

Безопасность и стабильность работы GHunt v2 основаны на эмуляции авторизации Android-устройств. Код авторизации сосредоточен в модулях `ghunt/helpers/auth.py`, `ghunt/helpers/listener.py` и `ghunt/objects/session.py`.

```mermaid
sequenceDiagram
    autonumber
    actor User as Исследователь
    participant Ext as GHunt Companion (Browser)
    participant List as GHunt Listener (localhost:60067)
    participant CLI as GHunt CLI / Core
    participant GAuth as Google Android Auth API
    participant GMerge as Google Accounts MergeSession
    participant GServices as Google Services APIs

    User->>CLI: ghunt login
    CLI->>List: Запуск локального HTTP сервера (порт 60067)
    User->>Ext: Нажатие кнопки перехвата токена
    Ext->>List: POST / JSON {oauth_token: "oauth2_4/..."}
    List->>CLI: Передача oauth_token
    
    CLI->>GAuth: POST https://android.googleapis.com/auth<br/>(эмуляция Android, service=ac2dm, callerSig)
    GAuth--CLI: Возврат Master Token (aas_et/...) + данные владельца
    
    CLI->>GAuth: Запрос токена авторизации приложения (com.google.android.gms)
    GAuth--CLI: Uberauth токен
    
    CLI->>GMerge: GET accounts.google.com/MergeSession?uberauth=...
    GMerge--CLI: Сессионные Cookies (SID, HSID, SSID, SAPISID)
    
    CLI->>GServices: GET /ServiceLogin?service=...&osid=1 (генерация OSID)
    GServices--CLI: Возврат кук OSID для play, maps, contacts, drive
    
    CLI->>CLI: Сохранение credentials в ~/.ghunt/resources/creds.json
```

### 3.1. Типы токенов в GHunt
1. **`oauth_token` (префикс `oauth2_4/`):**
   * Первичный одноразовый/короткоживущий токен сессии, извлекаемый из браузера при помощи расширения *GHunt Companion*.
2. **`master_token` (префикс `aas_et/`):**
   * Долгоживущий мастер-токен Android. Генерируется через `https://android.googleapis.com/auth` с сигнатурой `callerSig: 38918a453d07199354f8b19af05ec6562ced5788` (официальный сертификат Google Play Services).
   * Сохраняется локально в профиле пользователя и используется для автоматической тихой регенерации сессий.
3. **`SAPISID` и `sapisidhash`:**
   * Специфический протокол аутентификации внутренних веб-API Google (включая People PA). Вычисляется динамически на каждый запрос по формуле:
     $$\text{sapisidhash} = \text{timestamp} + \text{"\_"} + \text{SHA1}(\text{timestamp} + \text{" "} + \text{SAPISID} + \text{" "} + \text{Origin})$$
4. **`OSID` (Origin Specific Identifiers):**
   * Куки, привязанные к изолированным поддоменам сервисов Google (`contacts.google.com`, `drive.google.com`, `play.google.com`). Формируются через внутренние редиректы `/ServiceLogin` и `/accounts/SetOSID`.

---

## 4. Модули GHunt и их функциональные возможности

Вся функциональность разделена на независимые модули внутри каталога `ghunt/modules/`.

| Модуль | Команда CLI | Основное назначение | Используемый API / Сервисы |
|---|---|---|---|
| **login** | `ghunt login` | Первичная авторизация, валидация и очистка сессий | `android.googleapis.com/auth`, `accounts.google.com` |
| **email** | `ghunt email <email>` | Полный сбор данных по Gmail / Google Account | `people-pa.clients6.google.com`, `Play Games API`, `Google Maps API`, `Calendar API` |
| **gaia** | `ghunt gaia <gaia_id>` | Сбор профиля напрямую по 21-значному идентификатору | `people-pa.clients6.google.com`, `Maps API` |
| **drive** | `ghunt drive <file_id>` | Анализ публичных файлов и папок Google Drive | `drive.google.com`, `ClientAuthConfig API` |
| **geolocate** | `ghunt geolocate -b <bssid>` | Геолокация Wi-Fi роутера по BSSID (MAC) | `geolocation.googleapis.com`, OpenStreetMap / Nominatim |
| **spiderdal** | `ghunt spiderdal -u <url>` | Поиск взаимосвязей между Web и Android-приложениями | `digitalassetslinks.googleapis.com` |

---

### 4.1. Модуль `email` (Разведка по Gmail)
Основной рабочий инструмент. Принимает целевой почтовый адрес:
1. **People API (`PeoplePaHttp.people_lookup`):**
   * Запрашивает профиль через `people-pa.clients6.google.com/v2/people/lookup` с шаблоном `max_details`.
   * Определяет **Gaia ID** (постоянный 21-значный цифровой ID).
   * Определяет контейнеры (`PROFILE`, `DOMAIN_PROFILE`, `CONTACT`).
   * Извлекает статус аватара (дефолтный или кастомный), прямую ссылку на фото высокого разрешения и обложку.
   * Фиксирует точную дату и время последнего редактирования профиля Google (`lastUpdated`).
   * Тип пользователя (`userTypes`: Enterprise, Google One, Consumer и др.).
2. **Google Chat & Workspace Extended Data:**
   * Корпоративный статус (`isEnterpriseUser`).
   * Данные Google Chat (Dynamite): `customerId`, `entityType`.
   * Доступные и активированные внутренние приложения (`inAppReachability`).
3. **Google Play Games (`playgames.search_player`):**
   * Поиск игрового профиля по почте.
   * Никнейм игрока, Player ID, игровой аватар и статистика.
4. **Google Maps Data:**
   * Проверка профиля участника на Google Maps, извлечение статистики отзывов, оценок и фотографий.
5. **Google Calendar (`gcalendar.fetch_all`):**
   * Проверка публичной доступности календаря цели.
   * Извлечение событий, расписания, конференций и привязанных участников.

---

### 4.2. Модуль `gaia` (Разведка по Gaia ID)
Позволяет проводить профилирование объекта, если его email неизвестен, но известен его `Gaia ID` (например, получен из ссылки на отзыв в картах или комментария на Google Диске):
* Прямой запрос к `people-pa.clients6.google.com/v2/people/{gaia_id}`.
* Получение аватаров, истории редактирования, подключенных сервисов и статистики Google Maps.

---

### 4.3. Механизм работы с Google Maps (Отзывы и геолокационный след)
Анализ кода в `ghunt/helpers/gmaps.py` и `ghunt/config.py`:

1. **Запрос статистики контрибьютора:**
   * GHunt отправляет GET-запрос к эндпоинту:
     ```text
     https://www.google.com/locationhistory/preview/mas?authuser=0&hl=en&gl=us&pb={gmaps_pb['stats']}
     ```
   * Параметр `pb` представляет собой сериализованную строку Protocol Buffers, содержащую Gaia ID цели.
   * Ответ содержит JSON массив (с префиксом `)]}'`), откуда парсится блок `[16][8][0]` со счетчиками:
     * `Reviews` (текстовые отзывы)
     * `Ratings` (оценки без текста)
     * `Photos` (загруженные фотографии мест)
2. **Прямой URL профиля:**
   * Формируется ссылка на публичный профиль контрибьютора:
     ```text
     https://www.google.com/maps/contrib/{gaia_id}/reviews
     ```
3. **Алгоритм вероятного местоположения (`calculate_probable_location`):**
   * GHunt группирует все координаты мест, где пользователь оставлял отзывы/фото, с радиусом кластеризации (по умолчанию `gmaps_radius = 30` км).
   * Вычисляется временной интервал (`range = maxdate - mindate`) и частота посещений.
   * Локациям присваиваются баллы:
     * За максимальное количество отзывов в одной зоне (+16 очков).
     * За наибольший временной охват (+12 очков).
     * За преобладание над остальными зонами (+8 очков).
     * За минимальное пороговое число отзывов (+4 очка).
   * Вычисляется усредненная точка кластера (`avg_location`) и отправляется в Nominatim для получения города и страны.
   * Назначается уровень достоверности (`Extremely high`, `Very high`, `Okay`, `Low`).

> [!NOTE]
> В актуальных версиях GHunt прямой детальный парсинг тела каждого отзыва закомментирован автором из-за регулярных изменений протокола со стороны Google (Issue #529). Однако модуль извлекает статистику, счетчики, статус приватности и формирует прямую валидную ссылку контрибьютора.

---

### 4.4. Модуль `drive` (Разведка по документам Google Drive)
Принимает `file_id` (идентификатор файла или папки из ссылки общего доступа):
* **Свойства файла:** название, тип (MIME Type), размер, MD5-хеш, ссылка на скачивание.
* **Права доступа (Permissions):** тип публичной ссылки (`anyoneWithLink`), выданные роли.
* **Деанонимизация участников (`get_users_from_file`):**
  * Извлечение списка пользователей с ролями: `Owner`, `Writer`, `Commenter`, `Reader`.
  * Для каждого пользователя выгружаются: **Имя, Email-адрес и Gaia ID**.
  * Фиксация последнего пользователя, редактировавшего документ.
* **Комментарии (`get_comments`):** выгрузка списка комментариев и авторов (включая тех, кто не является владельцем).
* **Source Application (`ClientAuthConfigHttp`):** определение стороннего приложения Google Cloud, создавшего файл, с поиском его домашней страницы и бренда.
* **EXIF/Медиа-метаданные:** ширина, высота, поворот кадра, длительность видео.

---

### 4.5. Модуль `geolocate` (Геолокация Wi-Fi BSSID)
Использует обратный доступ к внутреннему API геолокации Google:
* Входные данные: MAC-адрес точки доступа Wi-Fi (BSSID), например `30:86:2d:c4:29:d0` (или батч-файл запроса).
* Запрос отправляется в `https://www.googleapis.com/geolocation/v1/geolocate`.
* Возвращаются точные координаты (широта, долгота) и радиус точности (`accuracy` в метрах).
* Координаты автоматически преобразуются в человекочитаемый адрес через Nominatim и формируется ссылка на точку в Google Maps.

---

### 4.6. Модуль `spiderdal` (Digital Asset Links Spider)
Инструмент для поиска скрытой инфраструктуры компаний через механизм Google Digital Asset Links (`/.well-known/assetlinks.json`):
* Принимает домен сайта (URL) либо имя пакета Android (`com.company.app`) и отпечаток сертификата SHA-256.
* Запрашивает эндпоинты `digitalassetslinks.googleapis.com/v1/statements:list`.
* Строит паутину (граф) связанных активов: находит скрытые поддомены, вспомогательные API и связанные Android-приложения (включая приватные пакеты, не опубликованные в Play Store).

---

## 5. Установка и запуск

### Вариант 1: Установка как CLI через `pipx` (Рекомендуемый)
```bash
# Установка pipx (если не установлен)
python -m pip install --user pipx
python -m pipx ensurepath

# Установка GHunt в изолированное окружение
pipx install ghunt
```

### Вариант 2: Установка для разработки / как библиотеки через `pip`
```bash
git clone https://github.com/mxrch/GHunt.git
cd GHunt
pip install .
```

### Настройка авторизации:
1. Установите расширение **GHunt Companion** в браузер (Chrome / Firefox / Edge).
2. Выполните вход в аккаунт Google в браузере (рекомендуется использовать отдельный burner-аккаунт).
3. В терминале запустите:
   ```bash
   ghunt login
   ```
4. Выберите пункт `[1] (Companion) Put GHunt on listening mode` (запустится сервер на порту 60067).
5. В браузере кликните по иконке расширения GHunt Companion и подтвердите передачу токена.
6. Токены будут автоматически обработаны и сохранены в локальный профиль:
   * Linux/macOS: `~/.ghunt/resources/creds.json`
   * Windows: `%USERPROFILE%\.ghunt\resources\creds.json`

---

## 6. Примеры практического применения (CLI)

```bash
# 1. Разведка по целевому адресу электронной почты с экспортом в JSON
ghunt email target_account@gmail.com --json target_report.json

# 2. Анализ профиля по найденному Gaia ID
ghunt gaia 102938475610293847561 --json gaia_report.json

# 3. Деанонимизация владельца и редакторов документа Google Drive
ghunt drive 1N__vVu4c9fCt4EHxfthUNzVOs_tp8l6tHcMBnpOZv_M --json drive_report.json

# 4. Геолокация Wi-Fi роутера по BSSID
ghunt geolocate -b 30:86:2d:c4:29:d0

# 5. Разведка мобильных и веб-активов компании по домену
ghunt spiderdal -u https://example.com --json assets.json
```

---

## 7. Использование GHunt как Python-библиотеки

Благодаря структуре классов `ghunt.apis.*` и `ghunt.helpers.*`, проект можно интегрировать в собственные скрипты:

```python
import asyncio
from ghunt.helpers.utils import get_httpx_client
from ghunt.helpers import auth
from ghunt.apis.peoplepa import PeoplePaHttp

async def lookup_email(email: str):
    # Создаем асинхронный HTTP-клиент
    async_client = get_httpx_client()
    
    # Загружаем сохраненные учетные данные GHunt
    creds = await auth.load_and_auth(async_client)
    
    # Инициализируем клиент People API
    people_api = PeoplePaHttp(creds)
    
    # Запрашиваем данные по email
    found, person = await people_api.people_lookup(async_client, email, params_template="max_details")
    
    if found:
        print(f"Gaia ID: {person.personId}")
        if "PROFILE" in person.profilePhotos:
            print(f"Avatar: {person.profilePhotos['PROFILE'].url}")
        print(f"Google Maps Reviews URL: https://www.google.com/maps/contrib/{person.personId}/reviews")
    else:
        print("Профиль не найден.")
        
    await async_client.aclose()

if __name__ == "__main__":
    asyncio.run(lookup_email("target@gmail.com"))
```

---

## 8. Безопасность, риски и ограничения

1. **Использование Burner-аккаунтов:**
   * Категорически не рекомендуется авторизовывать GHunt через личный рабочий или основной аккаунт Google. Эмуляция запросов Android Master Auth и частые нестандартные вызовы People API могут привести к временной заморозке или блокировке аккаунта.
2. **Rate Limits и защита Google:**
   * При интенсивных запросах Google возвращает HTTP 302 с перенаправлением на страницу капчи (`https://www.google.com/sorry/index`). Рекомендуется делать паузы между запросами и при необходимости использовать резидентные прокси.
3. **Настройки приватности цели:**
   * Если пользователь явно скрыл свои отзывы в настройках приватности Google Maps («Ограничить доступ к профилю»), прямая страница отзывов будет пустой, а в CLI отобразится статус `Reviews are private`.
4. **Юридический аспект:**
   * Проект распространяется под лицензией AGPL-3.0 и предназначен исключительно для уполномоченного аудита безопасности, журналистских расследований и легального OSINT.

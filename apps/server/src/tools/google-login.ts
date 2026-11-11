import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { findConfig, getIniValue, setIniValue } from '@ft/config';
import { CHROME_APP, PLAYGAMES_APP } from '../google/knowledge.ts';
import { GoogleError, type Ctx } from '../google/net.ts';
import { GoogleSession, masterAuth, oauthForApp } from '../google/session.ts';

// npm run google-login — мастер-токен служебного аккаунта Google для «Поиска по Google» (аналог `ghunt login`).
//
// Что принимает (аргументом или в ответ на вопрос):
//   oauth2_4/…   одноразовый токен: войдите служебным аккаунтом на https://accounts.google.com/EmbeddedSetup,
//                после входа возьмите значение cookie oauth_token (DevTools → Application → Cookies) — живёт минуты
//                и срабатывает один раз (повторный запуск с ним даёт BadAuthentication — нужен свежий);
//   aas_et/…     готовый мастер-токен (например, из GHunt);
//   base64       строка расширения GHunt Companion (JSON с полем oauth_token);
//   путь         файл учётных данных GHunt (~/.malfrats/ghunt/creds.m).
// Токен проверяется (выдача токена OAuth и создание веб-сессии) и записывается в config.ini:
// [google-search] master-token. --print — только вывести, файл не трогать.
//
// Используйте отдельный аккаунт Google, не личный: мастер-токен даёт доступ ко всему аккаунту,
// а за нетипичные запросы Google может аккаунт заблокировать.
//
// Выход — через process.exitCode, а не process.exit(): на Windows выход во время закрытия readline
// роняет процесс ассертом libuv (UV_HANDLE_CLOSING). Поэтому вся работа в main(), readline закрывается
// один раз в finally, и цикл событий завершается сам.

const ROOT = resolve(import.meta.dirname, '../../../..');
const printOnly = process.argv.includes('--print');
const ctx: Ctx = { timeoutMs: 30_000, signal: new AbortController().signal };

/** Остановить работу с сообщением пользователю и кодом выхода (без process.exit). */
class ExitError extends Error {
  readonly code: number;
  constructor(message: string, code = 1) {
    super(message);
    this.code = code;
  }
}

function fail(msg: string): never {
  throw new ExitError(msg);
}

const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;

/** Строка, файл GHunt или вывод Companion → токен (oauth2_4/… или aas_et/…). */
function tokenFrom(input: string): string {
  const s = input.trim().replace(/^["']|["']$/g, '');
  if (s.startsWith('oauth2_4/') || s.startsWith('aas_et/')) return s;
  // Файл GHunt (base64 от JSON с android.master_token) либо строка Companion (base64 от JSON с oauth_token).
  const raw = existsSync(s) ? readFileSync(s, 'utf8').trim() : s;
  try {
    const data = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as { oauth_token?: string; android?: { master_token?: string } };
    const token = data.android?.master_token ?? data.oauth_token;
    if (token && (token.startsWith('oauth2_4/') || token.startsWith('aas_et/'))) return token;
  } catch {
    // не base64 и не JSON
  }
  fail('Не распознано: нужен токен oauth2_4/…, мастер-токен aas_et/…, строка GHunt Companion или путь к creds.m');
}

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const input = arg ?? (rl ? await rl.question('oauth_token (oauth2_4/…), мастер-токен (aas_et/…), строка Companion или путь к creds.m:\n> ') : fail('Передайте токен аргументом: npm run google-login -- <токен>'));
  let token = tokenFrom(input);

  // Основная проверка — мастер-токен: обмен oauth_token (если дали его) и выдача токенов OAuth приложений.
  // Это и есть то, что обязательно для сохранения: без действующего мастер-токена смысла нет.
  try {
    if (token.startsWith('oauth2_4/')) {
      const m = await masterAuth(token, ctx);
      console.log(`Аккаунт: ${m.name || '—'} <${m.email}>`);
      token = m.masterToken;
    }
    // helpers/auth.py check_master_token.
    await oauthForApp(token, PLAYGAMES_APP, ctx);
    await oauthForApp(token, CHROME_APP, ctx);
    console.log('Мастер-токен действителен: токены OAuth выдаются.');
  } catch (e) {
    if (e instanceof ExitError) throw e;
    // oauth2_4/… одноразовый: при BadAuthentication подскажем взять свежий.
    const extra = e instanceof GoogleError && /BadAuthentication/.test(e.message) && token.startsWith('oauth2_4/')
      ? '\nТокен oauth_token одноразовый и живёт минуты — войдите на accounts.google.com/EmbeddedSetup заново и возьмите новый.'
      : '';
    fail((e instanceof GoogleError ? `Google: ${e.message}` : `Ошибка: ${(e as Error).message}`) + extra);
  }

  // Вторичная проверка — веб-сессия (cookie для People API и Календаря). Её сбой не мешает сохранить токен:
  // Play Игры и Карты работают и без неё, а веб-сессию сервер создаёт сам при первом поиске. Печатаем
  // диагностику (имена cookie, ответ CheckCookie) — по ней видно, на чём именно споткнулась сессия.
  try {
    await new GoogleSession(token, (m) => console.log(m), true).sessionCookies(ctx);
    console.log('Веб-сессия создаётся — доступны все разделы (профиль, Play Игры, Карты, Календарь).');
  } catch (e) {
    const msg = e instanceof GoogleError ? e.message : (e as Error).message;
    console.warn(`\nВнимание: веб-сессия не создалась (${msg}).`);
    console.warn('Поиск по профилю (People API) и Календарь пока работать не будут; Play Игры и Карты — будут.');
    console.warn('Мастер-токен действителен и будет сохранён — разберёмся с веб-сессией отдельно.\n');
  }

  if (printOnly) {
    console.log(`master-token = ${token}`);
    return;
  }

  const found = findConfig();
  const file = found ?? join(ROOT, 'config.ini');
  if (!existsSync(file)) {
    if (found) fail(`Файл конфигурации не найден: ${file}`); // путь из FT_CONFIG
    copyFileSync(join(ROOT, 'config.example.ini'), file);
    console.log(`Создан ${file} из config.example.ini — заполните остальные секции.`);
  }

  let src = setIniValue(readFileSync(file, 'utf8'), 'google-search', 'master-token', token);
  let enabled = ['true', 'yes', 'on', '1'].includes((getIniValue(src, 'config', 'google-search') ?? '').toLowerCase());
  if (!enabled && rl) {
    const a = (await rl.question('Раздел «Поиск по Google» выключен. Включить ([config] google-search = true)? [Д/н] ')).trim().toLowerCase();
    if (['', 'д', 'да', 'y', 'yes'].includes(a)) {
      src = setIniValue(src, 'config', 'google-search', 'true');
      enabled = true;
    }
  }
  writeFileSync(file, src, 'utf8');

  console.log(`Мастер-токен записан: ${file} → [google-search] master-token`);
  if (!enabled) console.log('Раздел не включён: [config] google-search = false.');
  if (process.env.FT_GOOGLE_SEARCH_MASTER_TOKEN !== undefined) console.log('Внимание: FT_GOOGLE_SEARCH_MASTER_TOKEN в окружении перекрывает значение из файла.');
  console.log('Перезапустите сервер.');
}

try {
  await main();
} catch (e) {
  if (e instanceof ExitError) {
    console.error(e.message);
    process.exitCode = e.code;
  } else {
    console.error((e as Error)?.stack ?? String(e));
    process.exitCode = 1;
  }
} finally {
  // Закрываем readline и снимаем удержание stdin, чтобы процесс завершился сам, без process.exit.
  rl?.close();
  process.stdin.unref?.();
}

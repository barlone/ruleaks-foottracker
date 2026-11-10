import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import { text } from 'node:stream/consumers';
import { parse } from 'ini';
import { findConfig } from './index.ts';
import { setIniValue } from './ini-edit.ts';

// npm run password-hash — sha256 пароля записывается в config.ini: [config] password-sha256.
// В терминале пароль вводится без эха (дважды), затем можно сразу включить auth = password-sha256;
// без терминала пароль — первая строка stdin. Нет config.ini — он создаётся из config.example.ini.
// --print — только вывести строку для конфига, файл не трогать.
// Файл правится построчно: комментарии, порядок и остальные ключи сохраняются.

const ROOT = resolve(import.meta.dirname, '../../..');
const printOnly = process.argv.includes('--print');
const tty = !!process.stdin.isTTY;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

let muted = false;
const rl: Interface | null = tty ? createInterface({ input: process.stdin, output: process.stdout, terminal: true }) : null;
if (rl) {
  // Подавляем эхо введённых символов, но не текст вопроса.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
    if (!muted) process.stdout.write(s);
    else if (s.includes('\n')) process.stdout.write('\n');
  };
}

const ask = (q: string, hidden = false) =>
  new Promise<string>((res) => {
    muted = false;
    rl!.question(q, res);
    muted = hidden;
  });

async function readPassword(): Promise<string> {
  if (!rl) return (await text(process.stdin)).split(/\r?\n/)[0]!;
  const first = await ask('Пароль: ', true);
  if (first && (await ask('Ещё раз: ', true)) !== first) fail('Пароли не совпадают');
  return first;
}

const password = await readPassword();
if (!password) fail('Пустой пароль');
const hash = createHash('sha256').update(password, 'utf8').digest('hex');

if (printOnly) {
  rl?.close();
  console.log(`password-sha256 = ${hash}`);
  process.exit(0);
}

const found = findConfig();
const file = found ?? join(ROOT, 'config.ini');
if (!existsSync(file)) {
  if (found) fail(`Файл конфигурации не найден: ${file}`); // путь из FT_CONFIG
  copyFileSync(join(ROOT, 'config.example.ini'), file);
  console.log(`Создан ${file} из config.example.ini — заполните остальные секции.`);
}

let src = readFileSync(file, 'utf8');
src = setIniValue(src, 'config', 'password-sha256', hash);
const auth = String((parse(src).config as Record<string, unknown> | undefined)?.auth ?? 'bot-db').trim().toLowerCase();
let enabled = auth === 'password-sha256';
if (!enabled && rl) {
  const a = (await ask(`Сейчас [config] auth = ${auth}. Включить вход по паролю (auth = password-sha256)? [Д/н] `)).trim().toLowerCase();
  if (['', 'д', 'да', 'y', 'yes'].includes(a)) {
    src = setIniValue(src, 'config', 'auth', 'password-sha256');
    enabled = true;
  }
}
rl?.close();
writeFileSync(file, src, 'utf8');

console.log(`Хеш пароля записан: ${file} → [config] password-sha256`);
if (!enabled) console.log(`Вход по паролю не включён: [config] auth = ${auth} (нужно password-sha256).`);
if (process.env.FT_CONFIG_PASSWORD_SHA256 !== undefined) console.log('Внимание: FT_CONFIG_PASSWORD_SHA256 в окружении перекрывает значение из файла.');
console.log('Перезапустите сервер; открытые сессии завершатся.');

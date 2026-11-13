import { createElement, Fragment, type ReactNode } from 'react';
import type { Lang } from '@ft/shared';

// Язык интерфейса — настройка пользователя (users.settings.lang, по умолчанию русский).
//
// Ключ перевода — сам русский текст (как в gettext): в коде строки остаются по-русски и читаются как раньше,
// английский словарь (src/i18n/en/*.ts) — «русский текст → английский». Нет перевода — показывается русский.
// Словарь грузится отдельным чанком только для английского (loadLang), в стартовый файл не попадает.
//
// t() читает текущий язык в момент вызова, поэтому:
//   • t() вызывается при отрисовке или в обработчике, не на уровне модуля: таблица подписей в модуле
//     остаётся русской, а t(item.label) — там, где подпись показывается;
//   • при смене языка Root (AppShell) перемонтирует всё дерево (key = язык), чтобы перерисовались и
//     мемоизированные компоненты.
// Полноту словаря проверяет `npm run i18n-check`: каждая русская строка в коде веба и @ft/shared должна в нём быть.

const STORAGE_KEY = 'ft-lang';

type Dict = Record<string, string>;
type Params = Record<string, string | number>;

let current: Lang = 'ru';
let en: Dict | null = null;

export const LANGS: { value: Lang; label: string }[] = [
  { value: 'ru', label: 'Русский' }, // i18n-ignore: название языка на нём самом
  { value: 'en', label: 'English' },
];

export const currentLang = (): Lang => current;

/** Язык последнего пользователя этого браузера — для первой отрисовки и страницы входа (ответа сервера ещё нет). */
export function storedLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ru';
  } catch {
    return 'ru';
  }
}

export const isLangReady = (lang: Lang) => lang === 'ru' || en !== null;

/** Загружает словарь языка (для русского ничего не нужно). */
export async function loadLang(lang: Lang): Promise<void> {
  if (lang === 'en' && !en) en = (await import('../i18n/en/index.ts')).EN;
}

/**
 * Делает язык текущим. Словарь уже должен быть загружен (isLangReady). Вызывается и во время отрисовки Root —
 * до отрисовки дочерних компонентов, чтобы они уже читали новый язык; повторный вызов ничего не делает.
 */
export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  patterns = null;
  document.documentElement.lang = lang;
  try {
    if (lang === 'ru') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // Хранилище недоступно: язык всё равно придёт с сервера вместе с настройками.
  }
}

/** Локаль для toLocaleString / Intl: даты по-английски тоже «день, месяц, год». */
export const locale = () => (current === 'en' ? 'en-GB' : 'ru-RU');

function fill(s: string, params: Params): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/**
 * Перевод строки интерфейса. Ключ — русский текст; подстановки — {name}: t('Найдено {n} записей', { n }).
 * Ключ обязательно литерал (его ищет npm run i18n-check); для подписей из таблиц — t(item.label).
 */
export function t(ru: string, params?: Params): string {
  const s = current === 'en' ? (en?.[ru] ?? ru) : ru;
  return params ? fill(s, params) : s;
}

/**
 * Перевод с контекстом — для слов, которые по-русски совпадают, а по-английски различаются:
 * tc('поле', 'Досье') — «Dossier» в подписи поля, а t('Досье') — «Dossiers» в меню. Ключ словаря — 'поле::Досье';
 * по-русски показывается сам текст.
 */
export function tc(context: string, ru: string, params?: Params): string {
  const s = current === 'en' ? (en?.[`${context}::${ru}`] ?? en?.[ru] ?? ru) : ru;
  return params ? fill(s, params) : s;
}

const RU_PLURAL = new Intl.PluralRules('ru');
const EN_PLURAL = new Intl.PluralRules('en');

/**
 * Число со словом: tn(n, '{n} запись|{n} записи|{n} записей'). Формы русские (1 / 2–4 / 5+), в словаре —
 * английские через «|» (one|other): '{n} record|{n} records'. {n} подставляется само, другие — через params.
 */
export function tn(n: number, forms: string, params?: Params): string {
  const p = { n, ...params };
  if (current === 'en' && en?.[forms]) {
    const [one = '', other = one] = en[forms]!.split('|');
    return fill(EN_PLURAL.select(n) === 'one' ? one : other, p);
  }
  const [one, few = one, many = few] = forms.split('|');
  const rule = RU_PLURAL.select(n);
  return fill(rule === 'one' ? one! : rule === 'many' ? many! : few!, p);
}

/**
 * Перевод с подстановкой элементов: tj('Нажмите {btn}, чтобы продолжить', { btn: <b>…</b> }).
 * Для текста со ссылками и выделением внутри фразы, где порядок слов в языках разный.
 */
export function tj(ru: string, params: Record<string, ReactNode>): ReactNode {
  const parts = t(ru).split(/\{(\w+)\}/);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => (i % 2 ? createElement(Fragment, { key: i }, part in params ? params[part] : `{${part}}`) : part)),
  );
}

// ---------- Тексты, пришедшие с сервера ----------
// Сервер отвечает по-русски (ошибки шлюза, причины пропуска проверок, заметки хода поиска, ошибки в сохранённых
// снимках). Их ключи в словаре могут быть шаблонами: 'Пользователь @{nick} не найден' совпадёт с
// «Пользователь @ivan не найден», и {nick} подставится в английский текст.

let patterns: { re: RegExp; key: string; names: string[] }[] | null = null;

function buildPatterns() {
  const list: { re: RegExp; key: string; names: string[]; weight: number }[] = [];
  for (const key of Object.keys(en ?? {})) {
    if (!key.includes('{') || key.includes('|')) continue;
    const names: string[] = [];
    const src = key
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m) {
          names.push(m[1]!);
          return '(.+?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    if (!names.length) continue;
    // Сначала шаблоны с более длинным постоянным текстом: они точнее.
    list.push({ re: new RegExp(`^${src}$`, 's'), key, names, weight: key.replace(/\{\w+\}/g, '').length });
  }
  return list.sort((a, b) => b.weight - a.weight);
}

function txSplit(s: string, sep: string, depth: number): string | null {
  if (!s.includes(sep)) return null;
  const parts = s.split(sep);
  const done = parts.map((part) => tx(part, depth + 1));
  return done.some((part, i) => part !== parts[i]) ? done.join(sep) : null;
}

/**
 * Перевод текста с сервера: точное совпадение, иначе по частям, склеенным « · » / «; » (они делят фразы — до
 * шаблонов, иначе широкий шаблон '{done} из {total}' съел бы всю строку), иначе шаблон, иначе перечисление через «, »
 * («12 из 12 поисков (ИНН, СНИЛС) · ошибок: 1», «найден по паспорту, ИНН»). Не найдено — текст как есть.
 */
export function tx(s: string, depth = 0): string {
  if (current !== 'en' || !en || !s) return s;
  const exact = en[s];
  if (exact !== undefined) return exact;
  if (depth > 3) return s;
  const phrases = txSplit(s, ' · ', depth) ?? txSplit(s, '; ', depth);
  if (phrases !== null) return phrases;
  patterns ??= buildPatterns();
  for (const p of patterns) {
    const m = p.re.exec(s);
    if (!m) continue;
    const values: Params = {};
    p.names.forEach((name, i) => (values[name] = tx(m[i + 1]!, depth + 1)));
    return fill(en[p.key]!, values);
  }
  return txSplit(s, ', ', depth) ?? s;
}

// Проверка перевода интерфейса (npm run i18n-check [-- <часть пути> ...]).
//
// Ищет русский текст в коде веба (apps/web/src) и @ft/shared и сообщает:
//   missing   — строки нет в английском словаре (src/i18n/en);
//   unwrap    — веб: строка внутри функции или в JSX-атрибуте не передана в t()/tn()/tj()/tx();
//   jsx-text  — веб: русский текст прямо в JSX (нужно {t('…')});
//   template  — веб: русский текст в шаблонной строке `…${x}…` (нужно t('… {x} …', { x }));
//   params    — подстановки {name} в переводе не совпадают с ключом;
//   conflict  — один ключ переведён по-разному в разных частях словаря.
// Строки таблиц на уровне модуля (подписи, варианты) переводятся там, где показываются, — t(item.label);
// для них проверяется только наличие в словаре. Шаблоны в @ft/shared должны быть в словаре шаблоном
// ('Найдено {n}' для `Найдено ${n}`). Не текст интерфейса (данные, сравнения, регулярки) — комментарий
// `i18n-ignore` в той же или предыдущей строке; весь файл — `i18n-ignore-file`.
// Код сервера не проверяется: его тексты, доходящие до интерфейса, собраны в словаре вручную (en/server.ts).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'rolldown/utils';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const { EN, PARTS } = (await import('../src/i18n/en/index.ts')) as {
  EN: Record<string, string>;
  PARTS: Record<string, Record<string, string>>;
};

const CYR = /[А-Яа-яЁё]/;
const T_ARG: Record<string, number> = { t: 0, tj: 0, tx: 0, tn: 1, tc: 1 };
const SKIP_SHARED = new Set(['stem.ts']);

type Problem = { file: string; line: number; kind: string; text: string };
const problems: Problem[] = [];
const filters = process.argv.slice(2);

function walk(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'i18n') walk(p, out);
    } else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const norm = (s: string) => s.replace(/\{\w+\}/g, '{}');
const patternKeys = new Set(Object.keys(EN).filter((k) => k.includes('{')).map(norm));

// Словарь: подстановки и расхождения между частями.
const seen = new Map<string, { part: string; value: string }>();
for (const [part, dict] of Object.entries(PARTS)) {
  for (const [key, value] of Object.entries(dict)) {
    const forms = key.includes('|') ? value.split('|') : [value];
    for (const f of forms) {
      const missingName = [...f.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).find((n) => n !== 'n' && !key.includes(`{${n}}`));
      if (missingName) problems.push({ file: `i18n/en/${part}.ts`, line: 0, kind: 'params', text: `${key} → ${value}` });
    }
    const before = seen.get(key);
    if (before && before.value !== value) {
      problems.push({ file: `i18n/en/${part}.ts`, line: 0, kind: 'conflict', text: `${key}: «${before.value}» (${before.part}) / «${value}»` });
    }
    seen.set(key, { part, value });
  }
}

type Node = { type: string; start: number; end: number; [k: string]: unknown };

function check(file: string, kind: 'web' | 'shared') {
  const src = readFileSync(file, 'utf8');
  if (src.includes('i18n-ignore-file')) return;
  const rel = relative(root, file).split(sep).join('/');
  const lines = src.split('\n');
  const lineStarts: number[] = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const ignored = (line: number) => /i18n-ignore/.test(lines[line - 1] ?? '') || /i18n-ignore/.test(lines[line - 2] ?? '');
  const report = (node: Node, k: string, text: string) => {
    const line = lineOf(node.start);
    if (!ignored(line)) problems.push({ file: rel, line, kind: k, text });
  };

  const { program, errors } = parseSync(file, src, { lang: file.endsWith('.tsx') ? 'tsx' : 'ts' }) as unknown as {
    program: Node;
    errors: { message: string }[];
  };
  if (errors.length) problems.push({ file: rel, line: 0, kind: 'parse', text: errors[0]!.message });

  /** Строка — аргумент перевода: t('…'), t(c ? '…' : '…'), tn(n, '…'). */
  function wrapped(chain: Node[]): boolean {
    let child = chain[chain.length - 1]!;
    for (let i = chain.length - 2; i >= 0; i--) {
      const p = chain[i]!;
      if (p.type === 'ConditionalExpression' && p.test !== child) { child = p; continue; }
      if (p.type === 'LogicalExpression' || p.type === 'ParenthesizedExpression' || p.type === 'TSAsExpression' || p.type === 'TSSatisfiesExpression') { child = p; continue; }
      if (p.type === 'CallExpression') {
        const callee = p.callee as Node & { name?: string };
        const idx = callee.type === 'Identifier' ? T_ARG[callee.name!] : undefined;
        return idx !== undefined && (p.arguments as Node[])[idx] === child;
      }
      return false;
    }
    return false;
  }

  const inFunction = (chain: Node[]) => chain.some((n) => /Function|ArrowFunctionExpression|MethodDefinition/.test(n.type));
  const inType = (chain: Node[]) => chain.some((n) => n.type.startsWith('TS') && n.type !== 'TSAsExpression' && n.type !== 'TSSatisfiesExpression' && n.type !== 'TSNonNullExpression');

  function visit(node: Node, chain: Node[]) {
    chain.push(node);
    const parent = chain[chain.length - 2];
    // tc('контекст', 'текст'): контекст — не текст, ключ словаря — 'контекст::текст'.
    const tcCall = parent?.type === 'CallExpression' && (parent.callee as Node & { name?: string }).name === 'tc' ? (parent.arguments as Node[]) : null;
    if (tcCall?.[0] === node) {
      // контекст перевода
    } else if (node.type === 'Literal' && typeof node.value === 'string' && !node.regex && CYR.test(node.value) && !inType(chain)) {
      const ctx = tcCall?.[1] === node ? (tcCall[0] as Node).value : undefined;
      const value = typeof ctx === 'string' ? `${ctx}::${node.value}` : node.value;
      if (!(value in EN)) report(node, 'missing', value);
      if (kind === 'web' && !wrapped(chain) && (parent?.type === 'JSXAttribute' || inFunction(chain))) report(node, 'unwrap', value);
    } else if (node.type === 'JSXText' && CYR.test(node.value as string)) {
      report(node, 'jsx-text', (node.value as string).trim().replace(/\s+/g, ' '));
    } else if (node.type === 'TemplateLiteral' && !inType(chain)) {
      const quasis = node.quasis as (Node & { value: { cooked: string } })[];
      if (quasis.some((q) => CYR.test(q.value.cooked ?? ''))) {
        const text = quasis.map((q) => q.value.cooked).join('{}');
        if (kind === 'web') report(node, 'template', text);
        else if (!patternKeys.has(text)) report(node, 'missing', text);
      }
    }
    for (const key in node) {
      if (key === 'parent') continue;
      const v = node[key];
      if (Array.isArray(v)) for (const c of v) { if (c && typeof c === 'object' && typeof (c as Node).type === 'string') visit(c as Node, chain); }
      else if (v && typeof v === 'object' && typeof (v as Node).type === 'string') visit(v as Node, chain);
    }
    chain.pop();
  }
  visit(program, []);
}

const files: [string, 'web' | 'shared'][] = [
  ...walk(join(root, 'apps/web/src')).map((f) => [f, 'web'] as [string, 'web']),
  ...walk(join(root, 'packages/shared/src'))
    .filter((f) => !SKIP_SHARED.has(f.split(sep).pop()!))
    .map((f) => [f, 'shared'] as [string, 'shared']),
];
for (const [f, k] of files) check(f, k);

const shown = filters.length ? problems.filter((p) => filters.some((f) => p.file.includes(f))) : problems;
for (const p of shown) console.log(`${p.file}:${p.line}  ${p.kind.padEnd(8)} ${p.text}`);
const byKind: Record<string, number> = {};
for (const p of shown) byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
console.log(shown.length ? `\nВсего: ${shown.length} (${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(', ')})` : 'Перевод полный.');
process.exit(shown.length ? 1 : 0);

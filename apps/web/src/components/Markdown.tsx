import { lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from '@tanstack/react-router';
import clsx from 'clsx';
import { MARK_CLOSE_RE, MARK_OPEN_RE, highlightKey } from '@ft/shared';
import { Spinner, Textarea } from './ui.tsx';
import { t } from '../lib/i18n.ts';
import type { MarkdownEditorProps } from './MarkdownEditor.tsx';

// Markdown — формат хранения всех текстов (сводки, заметки, факты, гипотезы).
// Упоминание досье: набрать «@» — вставляется обычная ссылка [@Название](/dossiers/<id>),
// поэтому текст остаётся чистым Markdown и читается где угодно.

// Выделение цветом хранится как <mark data-color="yellow">…</mark> (@ft/shared highlight.ts).

interface MdNode { type: string; value?: string; children?: MdNode[]; data?: Record<string, unknown> }

/**
 * remark-плагин показа: пара html-узлов <mark …> … </mark> внутри одного абзаца становится элементом mark.
 * Остальной HTML в тексте по-прежнему не исполняется — react-markdown показывает его как текст.
 */
function remarkHighlight() {
  const walk = (node: MdNode) => {
    if (!node.children) return;
    const out: MdNode[] = [];
    const open: MdNode[] = [];
    const push = (n: MdNode) => (open.length ? open[open.length - 1]!.children! : out).push(n);
    for (const child of node.children) {
      walk(child);
      const tag = child.type === 'html' ? (child.value ?? '').trim() : '';
      const m = tag ? MARK_OPEN_RE.exec(tag) : null;
      if (m) {
        const el: MdNode = { type: 'highlight', children: [], data: { hName: 'mark', hProperties: { dataColor: highlightKey(m[1]) } } };
        push(el);
        open.push(el);
      } else if (tag && open.length && MARK_CLOSE_RE.test(tag)) {
        open.pop();
      } else {
        push(child);
      }
    }
    node.children = out;
  };
  return (tree: unknown) => walk(tree as MdNode);
}

export function MarkdownView({ source, className }: { source: string; className?: string }) {
  if (!source.trim()) return <p className={clsx('font-mono text-sm text-mute', className)}>—</p>;
  return (
    <div className={clsx('md', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkHighlight]}
        components={{
          a: ({ href, children }) =>
            href?.startsWith('/') ? (
              <Link to={href} className="mention">{children}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
            ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

// Редактор (TipTap и ProseMirror — сотни килобайт) лежит в MarkdownEditor.tsx и подгружается, когда его впервые
// открывают: иначе он попадал в стартовый файл сайта через страницы, где редактор — только в диалоге создания.
// Файл редактора не загрузился. Обычная причина — сайт обновили, пока страница была открыта: у файлов сборки новые
// имена, старого уже нет. Markdown — простой текст, поэтому вместо падения даём простое поле: начатое не теряется.
const LazyEditor = lazy(() => import('./MarkdownEditor.tsx').then((m) => ({ default: m.MarkdownEditor }), () => ({ default: PlainEditor })));

/** Запасной редактор: поле с текстом Markdown без кнопок и подсказки «@». */
function PlainEditor({ value, onChange, placeholder, className, autoFocus }: MarkdownEditorProps) {
  return (
    <div className={className}>
      <Textarea rows={6} value={value} autoFocus={autoFocus} placeholder={placeholder ?? t('Текст в Markdown…')} onChange={(e) => onChange(e.target.value)} className="w-full font-mono text-sm" />
      <div className="mt-1 text-xs text-warn">{t('Редактор с кнопками не загрузился: вышла новая версия сайта. Текст можно ввести здесь; после обновления страницы редактор вернётся.')}</div>
    </div>
  );
}

export function MarkdownEditor(props: MarkdownEditorProps) {
  return (
    <Suspense fallback={<div className={clsx('grid min-h-[168px] place-items-center rounded-xl border border-line bg-bg-soft', props.className)}><Spinner /></div>}>
      <LazyEditor {...props} />
    </Suspense>
  );
}

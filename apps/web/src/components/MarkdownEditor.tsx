import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorContent, Mark, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import clsx from 'clsx';
import { Bold, Code, Heading2, Highlighter, Italic, List, ListChecks, ListOrdered, Quote, Strikethrough, X } from 'lucide-react';
import { HIGHLIGHT_COLORS, HIGHLIGHT_DEFAULT, MARK_SPAN_RE, highlightKey, type HighlightKey } from '@ft/shared';
import { trpc } from '../lib/trpc.ts';

// Редактор Markdown на TipTap. Сам файл нигде не импортируется напрямую: его подгружает обёртка MarkdownEditor
// из Markdown.tsx — так TipTap не попадает в стартовый файл сайта.

/** Марка TipTap: в редакторе — <mark data-color>, в Markdown — тот же тег; внутри остаётся обычная разметка. */
const Highlight = Mark.create({
  name: 'highlight',
  addAttributes() {
    return {
      color: {
        default: HIGHLIGHT_DEFAULT,
        parseHTML: (el: HTMLElement) => highlightKey(el.getAttribute('data-color')),
        renderHTML: (attrs: { color?: string }) => ({ 'data-color': highlightKey(attrs.color) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'mark' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['mark', HTMLAttributes, 0];
  },
  markdownTokenName: 'highlight',
  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start: (src: string) => src.indexOf('<mark'),
    tokenize(src, _tokens, lexer) {
      const m = MARK_SPAN_RE.exec(src);
      if (!m) return undefined;
      return { type: 'highlight', raw: m[0], color: highlightKey(m[1]), tokens: lexer.inlineTokens(m[2]!) };
    },
  },
  parseMarkdown: (token, helpers) => helpers.applyMark('highlight', helpers.parseInline(token.tokens ?? []), { color: token.color }),
  renderMarkdown: (node, h) => `<mark data-color="${highlightKey(node.attrs?.color)}">${h.renderChildren(node)}</mark>`,
});
interface MentionItem { id: string; title: string; kind: string }

export interface MarkdownEditorProps { value: string; onChange: (md: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }

export function MarkdownEditor({
  value, onChange, placeholder = 'Текст в Markdown… «@» — упомянуть досье', className, autoFocus,
}: MarkdownEditorProps) {
  const options = trpc.dossiers.options.useQuery(undefined, { staleTime: 60_000 });
  const itemsRef = useRef<MentionItem[]>([]);
  itemsRef.current = options.data ?? [];
  const [popup, setPopup] = useState<{ items: MentionItem[]; index: number; rect: DOMRect | null; command: (i: MentionItem) => void } | null>(null);
  const popupRef = useRef(popup);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wrapRect = wrapRef.current?.getBoundingClientRect();
  popupRef.current = popup;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Markdown,
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Mention.configure({
        suggestion: {
          char: '@',
          items: ({ query }) =>
            itemsRef.current.filter((d) => d.title.toLowerCase().includes(query.toLowerCase())).slice(0, 8),
          // Вставляем не узел mention, а текст со ссылкой — так он сохраняется в Markdown.
          command: ({ editor, range, props }) => {
            const item = props as unknown as MentionItem;
            editor
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: 'text', text: `@${item.title}`, marks: [{ type: 'link', attrs: { href: `/dossiers/${item.id}` } }] },
                { type: 'text', text: ' ' },
              ])
              .run();
          },
          render: () => ({
            onStart: (p: SuggestionProps) => setPopup(toPopup(p, 0)),
            onUpdate: (p: SuggestionProps) => setPopup((prev) => toPopup(p, Math.min(prev?.index ?? 0, Math.max(0, p.items.length - 1)))),
            onExit: () => setPopup(null),
            onKeyDown: ({ event }: SuggestionKeyDownProps) => {
              const cur = popupRef.current;
              if (!cur || !cur.items.length) return false;
              if (event.key === 'ArrowDown') { setPopup({ ...cur, index: (cur.index + 1) % cur.items.length }); return true; }
              if (event.key === 'ArrowUp') { setPopup({ ...cur, index: (cur.index - 1 + cur.items.length) % cur.items.length }); return true; }
              if (event.key === 'Enter' || event.key === 'Tab') { cur.command(cur.items[cur.index]!); return true; }
              return false;
            },
          }),
        },
      }),
    ],
    content: value,
    contentType: 'markdown',
    onUpdate: ({ editor }) => onChange(editor.getMarkdown()),
    editorProps: { attributes: { class: 'md tiptap px-4 py-3' } },
  });

  // Внешняя смена значения (другой объект, откат) — без зацикливания на собственных правках.
  useEffect(() => {
    if (editor && value !== editor.getMarkdown()) editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
  }, [value, editor]);

  // autofocus TipTap срабатывает до вставки в DOM диалога — фокусируем после монтирования.
  useEffect(() => {
    if (!editor || !autoFocus) return;
    const t = setTimeout(() => editor.commands.focus('end'), 30);
    return () => clearTimeout(t);
  }, [editor, autoFocus]);

  return (
    <div ref={wrapRef} className={clsx('relative rounded-xl border border-line bg-bg-soft focus-within:border-mint/60', className)}>
      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
      {popup && popup.rect && (
        <div
          className="absolute z-50 w-72 overflow-hidden rounded-lg border border-line bg-panel shadow-glow-sm"
          // Относительно обёртки редактора: fixed ломается внутри предков с transform/backdrop-filter.
          style={{ top: popup.rect.bottom - (wrapRect?.top ?? 0) + 6, left: popup.rect.left - (wrapRect?.left ?? 0) }}
        >
          {popup.items.length === 0 ? (
            <div className="px-3 py-2 font-mono text-xs text-mute">Нет досье</div>
          ) : (
            popup.items.map((it, i) => (
              <button
                key={it.id}
                onMouseDown={(e) => { e.preventDefault(); popup.command(it); }}
                className={clsx('block w-full cursor-pointer px-3 py-2 text-left text-sm', i === popup.index ? 'bg-mint/15 text-mint' : 'text-dim hover:bg-mint/5')}
              >
                @{it.title}
                <span className="ml-2 font-mono text-[10px] text-mute">{it.kind === 'group' ? 'группа' : 'персона'}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function toPopup(p: SuggestionProps, index: number) {
  return {
    items: p.items as MentionItem[],
    index,
    rect: p.clientRect?.() ?? null,
    command: (i: MentionItem) => p.command(i as never),
  };
}

/** Кнопка «Выделить цветом»: палитра из шести цветов и сброс; работает по выделенному тексту. */
function HighlightButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const active = editor.isActive('highlight');
  const current = active ? (editor.getAttributes('highlight').color as HighlightKey) : null;
  const pick = (color: HighlightKey | null) => {
    setOpen(false);
    const c = editor.chain().focus();
    if (color) c.setMark('highlight', { color }).run();
    else c.unsetMark('highlight').run();
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="Выделить цветом"
        // mousedown без потери выделения в редакторе
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v); }}
        className={clsx('grid size-7 cursor-pointer place-items-center rounded-md transition', active || open ? 'bg-mint/15 text-mint' : 'text-mute hover:bg-mint/5 hover:text-mint')}
      >
        <Highlighter size={15} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 flex items-center gap-1.5 rounded-lg border border-line bg-panel p-2 shadow-glow-sm">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.key}
              type="button"
              title={c.label}
              onMouseDown={(e) => { e.preventDefault(); pick(c.key); }}
              className={clsx('size-6 cursor-pointer rounded-md border border-text/25 transition hover:scale-110', current === c.key && 'ring-2 ring-mint ring-offset-2 ring-offset-panel')}
              style={{ background: c.color }}
            />
          ))}
          <button
            type="button"
            title="Убрать выделение"
            onMouseDown={(e) => { e.preventDefault(); pick(null); }}
            className="grid size-6 cursor-pointer place-items-center rounded-md border border-text/25 text-dim transition hover:text-danger"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const btn = (active: boolean, onClick: () => void, icon: ReactNode, title: string) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={clsx('grid size-7 cursor-pointer place-items-center rounded-md transition', active ? 'bg-mint/15 text-mint' : 'text-mute hover:bg-mint/5 hover:text-mint')}
    >
      {icon}
    </button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="flex flex-wrap gap-0.5 border-b border-line-soft px-2 py-1.5">
      {btn(editor.isActive('heading', { level: 2 }), () => c().toggleHeading({ level: 2 }).run(), <Heading2 size={15} />, 'Заголовок')}
      {btn(editor.isActive('bold'), () => c().toggleBold().run(), <Bold size={15} />, 'Жирный')}
      {btn(editor.isActive('italic'), () => c().toggleItalic().run(), <Italic size={15} />, 'Курсив')}
      {btn(editor.isActive('strike'), () => c().toggleStrike().run(), <Strikethrough size={15} />, 'Зачёркнутый')}
      {btn(editor.isActive('code'), () => c().toggleCode().run(), <Code size={15} />, 'Код')}
      <HighlightButton editor={editor} />
      <span className="mx-1 w-px bg-line-soft" />
      {btn(editor.isActive('bulletList'), () => c().toggleBulletList().run(), <List size={15} />, 'Список')}
      {btn(editor.isActive('orderedList'), () => c().toggleOrderedList().run(), <ListOrdered size={15} />, 'Нумерованный')}
      {btn(editor.isActive('taskList'), () => c().toggleTaskList().run(), <ListChecks size={15} />, 'Задачи')}
      {btn(editor.isActive('blockquote'), () => c().toggleBlockquote().run(), <Quote size={15} />, 'Цитата')}
      <span className="ml-auto self-center pr-1 font-mono text-[10px] text-mute">markdown</span>
    </div>
  );
}

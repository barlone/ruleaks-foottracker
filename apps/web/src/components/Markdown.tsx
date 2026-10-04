import { useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from '@tanstack/react-router';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import Mention from '@tiptap/extension-mention';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import clsx from 'clsx';
import { Bold, Code, Heading2, Italic, List, ListChecks, ListOrdered, Quote, Strikethrough } from 'lucide-react';
import { trpc } from '../lib/trpc.ts';

// Markdown — формат хранения всех текстов (сводки, заметки, факты, гипотезы).
// Упоминание досье: набрать «@» — вставляется обычная ссылка [@Название](/dossiers/<id>),
// поэтому текст остаётся чистым Markdown и читается где угодно.

export function MarkdownView({ source, className }: { source: string; className?: string }) {
  if (!source.trim()) return <p className={clsx('font-mono text-sm text-mute', className)}>—</p>;
  return (
    <div className={clsx('md', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
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

interface MentionItem { id: string; title: string; kind: string }

export function MarkdownEditor({
  value, onChange, placeholder = 'Текст в Markdown… «@» — упомянуть досье', className, autoFocus,
}: { value: string; onChange: (md: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
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
      <span className="mx-1 w-px bg-line-soft" />
      {btn(editor.isActive('bulletList'), () => c().toggleBulletList().run(), <List size={15} />, 'Список')}
      {btn(editor.isActive('orderedList'), () => c().toggleOrderedList().run(), <ListOrdered size={15} />, 'Нумерованный')}
      {btn(editor.isActive('taskList'), () => c().toggleTaskList().run(), <ListChecks size={15} />, 'Задачи')}
      {btn(editor.isActive('blockquote'), () => c().toggleBlockquote().run(), <Quote size={15} />, 'Цитата')}
      <span className="ml-auto self-center pr-1 font-mono text-[10px] text-mute">markdown</span>
    </div>
  );
}

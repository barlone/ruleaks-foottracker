import { useEffect, useState, type ReactNode } from 'react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { LEAK_FIELDS, type LeakField, type SearchSection } from '@ft/shared';
import { download } from '../../components/ExportDialog.tsx';
import { isCancelled, ProcessDialog, useProcess } from '../../components/ProgressDialog.tsx';
import { Button, Dialog, Field, Input, Segmented, Spinner, Textarea } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { toast } from '../../lib/toast.ts';

// Экспорт результата поиска по атрибутам / геоданным в PDF или Excel. Файл собирает сервер из сохранённого
// снимка поиска. Есть отметки — в файл идут только отмеченные значения, нет — весь результат; включённый фильтр
// «Атрибуты» сужает выгрузку (галочкой можно выгрузить без него).

type Format = 'pdf' | 'xlsx';
type Printing = 'none' | 'low' | 'high';

const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;
const SCANS_FIELD = 'scans';
const fieldLabel = (f: string) => (f === SCANS_FIELD ? 'Сканы документов' : LEAK_FIELDS[f as LeakField] ?? f);

/** Имя файла без запрещённых в Windows символов, как у остальных экспортов: «Название ГГГГ-ММ-ДД». */
function defaultName(section: SearchSection, query: string): string {
  const title = `${section === 'geo' ? 'Поиск по геоданным' : 'Поиск по атрибутам'} ${query}`;
  return `${safeName(title).slice(0, 80)} ${new Date().toISOString().slice(0, 10)}`;
}
// eslint-disable-next-line no-control-regex
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();

function Radio({ checked, onChange, title, children }: { checked: boolean; onChange: () => void; title: string; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer gap-2.5 text-sm">
      <input type="radio" checked={checked} onChange={onChange} className="mt-1 accent-[var(--color-mint)]" />
      <span>
        <span className="block">{title}</span>
        <span className="block text-xs text-mute">{children}</span>
      </span>
    </label>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-mint)]" />
      {children}
    </label>
  );
}

export function AttrExportDialog({
  format, job, selected, fields, scans, open, onOpenChange,
}: {
  format: Format;
  job: { id: string; section: SearchSection; query: string };
  /** Отмеченные значения — ключи «поле:значение». */
  selected: string[];
  /** Включённый фильтр «Атрибуты»; пусто — фильтра нет. */
  fields: string[];
  /** Сканов документов в результате (без дублей). */
  scans: number;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const me = trpc.auth.me.useQuery();
  const [name, setName] = useState('');
  const [useFilter, setUseFilter] = useState(true);
  // Excel
  const [layout, setLayout] = useState<'rows' | 'columns'>('rows');
  // PDF
  const [author, setAuthor] = useState('');
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [printing, setPrinting] = useState<Printing>('high');
  const [copying, setCopying] = useState(true);
  const [landscape, setLandscape] = useState(false);
  const [watermark, setWatermark] = useState('');
  const [withScans, setWithScans] = useState(true);

  const client = trpc.useUtils().client;
  const process = useProcess();
  const pending = process.state !== null;

  // Каждое открытие — с чистыми паролями и свежим именем файла (дата, запрос).
  useEffect(() => {
    if (!open) return;
    setName(defaultName(job.section, job.query));
    setPassword('');
    setRepeat('');
    setUseFilter(true);
    setAuthor((a) => a || me.data?.displayName || '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const filter = useFilter && fields.length ? fields : undefined;
  // Сканы не отмечаются: с отметками их в выгрузке нет; фильтр без сканов их тоже убирает.
  const scansAvailable = format === 'pdf' && scans > 0 && !selected.length && (!filter || filter.includes(SCANS_FIELD));
  const mismatch = format === 'pdf' && password !== repeat;
  const ext = `.${format}`;
  const fileName = (safeName(name.replace(new RegExp(`\\${ext}$`, 'i'), '')) || defaultName(job.section, job.query)) + ext;

  const submit = async () => {
    if (mismatch || pending) return;
    const pick = {
      jobId: job.id,
      only: selected.length ? selected : undefined,
      fields: filter,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    try {
      const r = await process.run(
        format === 'pdf' ? 'Результат поиска в PDF' : 'Результат поиска в Excel',
        (p) => {
          if (format === 'xlsx') {
            p.set({ status: 'Сервер собирает таблицу…' });
            return client.search.exportAttrXlsx.mutate({ ...pick, layout }, { signal: p.signal });
          }
          p.set({ status: 'Сервер формирует отчёт…', detail: scansAvailable && withScans ? 'Сканы документов загружаются из хранилища' : undefined });
          return client.search.exportAttrPdf.mutate(
            { ...pick, author, note, password, options: { printing, copying, scans: scansAvailable && withScans, landscape, watermark } },
            { signal: p.signal },
          );
        },
        { cancellable: true },
      );
      download(fileName, r.data, MIME[format]);
      toast(`Файл «${fileName}» сохранён`);
      onOpenChange(false);
    } catch (e) {
      if (!isCancelled(e)) toast(errorText(e), 'error');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={format === 'pdf' ? 'Результат поиска в PDF' : 'Результат поиска в Excel'}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Имя файла">
          <div className="flex items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} autoFocus className="flex-1" />
            <span className="font-mono text-sm text-dim">{ext}</span>
          </div>
        </Field>

        <div className="space-y-2 rounded-lg border border-line-soft bg-bg-soft px-3 py-2.5 text-sm">
          <div>
            В файл войдут:{' '}
            <span className="text-mint">{selected.length ? `только отмеченные значения (${selected.length})` : 'все найденные значения'}</span>
          </div>
          {fields.length > 0 && (
            <Check checked={useFilter} onChange={setUseFilter}>
              <span>
                Только атрибуты из фильтра: <span className="text-dim">{fields.map(fieldLabel).join(', ')}</span>
              </span>
            </Check>
          )}
        </div>

        {format === 'xlsx' ? (
          <div className="space-y-3">
            <Radio checked={layout === 'rows'} onChange={() => setLayout('rows')} title="Построчно">
              Как на странице: утечка, под ней записи — строки «атрибут — значение», записи разделены чертой.
            </Radio>
            <Radio checked={layout === 'columns'} onChange={() => setLayout('columns')} title="Поколоночно">
              Таблица: каждый атрибут — колонка, каждая запись утечки — строка; несколько значений — в одной ячейке
              с переносом. Шапка закреплена, есть автофильтр.
            </Radio>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Автор">
                <Input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={256} />
              </Field>
              <Field label="Водяной знак">
                <Input value={watermark} onChange={(e) => setWatermark(e.target.value)} maxLength={60} placeholder="например, ДСП" />
              </Field>
            </div>
            <Field label="Примечание">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} placeholder="Попадёт в шапку отчёта" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Пароль на открытие">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={256} autoComplete="new-password" />
              </Field>
              <Field label="Пароль ещё раз">
                <Input
                  type="password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  maxLength={256}
                  autoComplete="new-password"
                  className={mismatch && repeat ? 'border-danger/60' : undefined}
                />
              </Field>
            </div>
            {mismatch && repeat && <p className="text-xs text-danger">Пароли не совпадают</p>}

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">Печать</span>
                <Segmented<Printing>
                  value={printing}
                  onChange={setPrinting}
                  options={[{ value: 'none', label: 'Запрещена' }, { value: 'low', label: 'Низкое качество' }, { value: 'high', label: 'Разрешена' }]}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">Ориентация</span>
                <Segmented<'portrait' | 'landscape'>
                  value={landscape ? 'landscape' : 'portrait'}
                  onChange={(v) => setLandscape(v === 'landscape')}
                  options={[{ value: 'portrait', label: 'Книжная' }, { value: 'landscape', label: 'Альбомная' }]}
                />
              </div>
              <Check checked={copying} onChange={setCopying}>Разрешить копирование текста</Check>
              {scansAvailable && <Check checked={withScans} onChange={setWithScans}>Сканы документов ({scans})</Check>}
            </div>
            <p className="text-xs leading-relaxed text-mute">
              Пароль необязателен: с ним PDF шифруется (AES-256) и открывается только с паролем. Запрет печати и копирования
              выполняют программы просмотра (Acrobat, браузеры) — от снимка экрана он не защищает. В альбомной ориентации
              значения записи идут в две колонки, как на широком экране.
            </p>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={mismatch || pending}>
            {pending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : format === 'pdf' ? <FileText size={15} /> : <FileSpreadsheet size={15} />}
            {format === 'pdf' ? 'Сформировать PDF' : 'Сформировать Excel'}
          </Button>
        </div>
      </form>
      <ProcessDialog process={process} />
    </Dialog>
  );
}

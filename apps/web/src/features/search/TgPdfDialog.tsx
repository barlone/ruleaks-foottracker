import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { TG_PDF_MAX } from '@ft/shared';
import { download } from '../../lib/download.ts';
import { ProcessDialog } from '../../components/ProgressDialog.tsx';
import { isCancelled, useProcess } from '../../components/process.ts';
import { Button, Dialog, Field, Input, Spinner, Textarea } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { toast } from '../../lib/toast.ts';

// PDF-отчёт по результату поиска в Telegram — как отчёт досье: автор, примечание, необязательный пароль
// (шифрование PDF). Сообщения — все или только отмеченные; собирает сервер из сохранённого снимка поиска,
// на это время поверх окна — окно процесса (тысячи сообщений верстаются до минуты).

export function TgPdfDialog({
  jobId, total, selected, open, onOpenChange,
}: {
  jobId: string;
  /** Сообщений в результате; null — активность (сообщений нет). */
  total: number | null;
  /** Ключи отмеченных сообщений «группа:сообщение». */
  selected: string[];
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const me = trpc.auth.me.useQuery();
  const [author, setAuthor] = useState('');
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const client = trpc.useUtils().client;
  const process = useProcess();
  const pending = process.state !== null;

  // Каждое открытие — с чистыми паролями; есть отмеченные — по умолчанию только они.
  useEffect(() => {
    if (!open) return;
    setPassword('');
    setRepeat('');
    setOnlySelected(selected.length > 0);
    setAuthor((a) => a || me.data?.displayName || '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const mismatch = password !== repeat;
  const count = onlySelected ? selected.length : total ?? 0;
  const submit = async () => {
    if (mismatch || pending) return;
    try {
      const r = await process.run(
        'Отчёт поиска в PDF',
        (p) => {
          p.set({ status: 'Сервер формирует отчёт…', detail: `сообщений: ${Math.min(count, TG_PDF_MAX)}` });
          return client.search.exportTgPdf.mutate(
            {
              jobId, author, note, password,
              only: onlySelected && selected.length ? selected : undefined,
              timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            },
            { signal: p.signal },
          );
        },
        { cancellable: true },
      );
      download(r.fileName, r.data, 'application/pdf');
      toast(`Файл «${r.fileName}» сохранён`);
      onOpenChange(false);
    } catch (e) {
      if (!isCancelled(e)) toast(errorText(e), 'error');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Отчёт поиска в PDF">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Автор">
          <Input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={256} autoFocus />
        </Field>
        <Field label="Примечание">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000} placeholder="Попадёт в шапку отчёта" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Пароль">
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
        <p className="text-xs leading-relaxed text-mute">
          {mismatch && repeat
            ? <span className="text-danger">Пароли не совпадают</span>
            : 'Пароль необязателен. С паролем PDF шифруется (AES-256) и открывается только с ним.'}
        </p>
        {total !== null && (
          <div className="space-y-2 text-sm">
            <label className="flex cursor-pointer items-center gap-2">
              <input type="radio" checked={!onlySelected} onChange={() => setOnlySelected(false)} className="accent-[var(--color-mint)]" />
              Все сообщения ({total})
            </label>
            <label className={selected.length ? 'flex cursor-pointer items-center gap-2' : 'flex items-center gap-2 opacity-40'}>
              <input type="radio" disabled={!selected.length} checked={onlySelected} onChange={() => setOnlySelected(true)} className="accent-[var(--color-mint)]" />
              Только отмеченные ({selected.length})
            </label>
            {count > TG_PDF_MAX && (
              <p className="text-xs text-warn">
                В отчёт войдут первые {TG_PDF_MAX} из {count} сообщений — отметьте нужные или сузьте поиск.
              </p>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={mismatch || pending}>
            {pending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : <FileText size={15} />}
            {pending ? 'Формирую…' : 'Сформировать PDF'}
          </Button>
        </div>
      </form>
      <ProcessDialog process={process} />
    </Dialog>
  );
}

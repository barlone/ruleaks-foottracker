import { useEffect, useState, type ReactNode } from 'react';
import { FileDown, FileText } from 'lucide-react';
import { trpc } from '../lib/trpc.ts';
import { errorText } from '../lib/errors.ts';
import { toast } from '../lib/toast.ts';
import { Button, Dialog, Field, Input, Spinner, Textarea } from './ui.tsx';

// Окно экспорта: автор, примечание, необязательный пароль, опции. Файл собирает сервер.
//   file — ZIP формата обмена, зашифрованный всегда (без пароля ключ выводится из пустой строки,
//          см. packages/shared/src/export.ts);
//   pdf  — отчёт для чтения; пароль — шифрование PDF, без пароля PDF не шифруется.

const NOUN = { dossier: 'досье', investigation: 'расследования' } as const;
/** У досье связанные — участники и связанные персоны, у расследования — досье узлов графа. */
const RELATED = { dossier: 'Связанные персоны и участники группы — отдельными разделами', investigation: 'Досье персон из графа — отдельными разделами' } as const;

function download(fileName: string, base64: string, type: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--color-mint)]" />
      {children}
    </label>
  );
}

export function ExportDialog({
  kind, format, id, open, onOpenChange,
}: {
  kind: keyof typeof NOUN;
  format: 'file' | 'pdf';
  id: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const me = trpc.auth.me.useQuery();
  const [author, setAuthor] = useState('');
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [editable, setEditable] = useState(true);
  const [photos, setPhotos] = useState(true);
  const [related, setRelated] = useState(false);
  const [sources, setSources] = useState(true);

  const onSuccess = (r: { fileName: string; data: string }) => {
    download(r.fileName, r.data, format === 'pdf' ? 'application/pdf' : 'application/octet-stream');
    toast(`Файл «${r.fileName}» сохранён`);
    onOpenChange(false);
  };
  const onError = (e: unknown) => toast(errorText(e), 'error');
  const mutations = {
    dossier: {
      file: trpc.dossiers.exportFile.useMutation({ onSuccess, onError }),
      pdf: trpc.dossiers.exportPdf.useMutation({ onSuccess, onError }),
    },
    investigation: {
      file: trpc.investigations.exportFile.useMutation({ onSuccess, onError }),
      pdf: trpc.investigations.exportPdf.useMutation({ onSuccess, onError }),
    },
  };
  const pending = mutations[kind][format].isPending;

  // Каждое открытие — с чистыми паролями; автор по умолчанию — имя пользователя.
  useEffect(() => {
    if (!open) return;
    setPassword('');
    setRepeat('');
    setAuthor((a) => a || me.data?.displayName || '');
  }, [open, me.data?.displayName]);

  const mismatch = password !== repeat;
  const submit = () => {
    if (mismatch || pending) return;
    const base = { id, author, note, password };
    if (format === 'file') mutations[kind].file.mutate({ ...base, options: { editable } });
    else {
      mutations[kind].pdf.mutate({
        ...base, options: { photos, related, sources }, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={format === 'pdf' ? `Отчёт ${NOUN[kind]} в PDF` : `Экспорт ${NOUN[kind]} в файл`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Автор">
          <Input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={256} autoFocus />
        </Field>
        <Field label="Примечание">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={4000}
            placeholder={format === 'pdf' ? 'Попадёт в шапку отчёта' : 'Для кого и зачем этот файл'}
          />
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
            : format === 'pdf'
              ? 'Пароль необязателен. С паролем PDF шифруется (AES-256) и открывается только с ним; без пароля его прочтёт любой, у кого есть файл.'
              : 'Пароль необязателен. Файл шифруется всегда, но без пароля его откроет любая установка Следопыта; с паролем — только тот, кто его знает.'}
        </p>
        {format === 'file' ? (
          <Check checked={editable} onChange={setEditable}>Доступно редактирование</Check>
        ) : (
          <div className="space-y-2">
            <Check checked={photos} onChange={setPhotos}>Фотографии и изображения</Check>
            <Check checked={sources} onChange={setSources}>Источники и их оценка</Check>
            <Check checked={related} onChange={setRelated}>{RELATED[kind]}</Check>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={mismatch || pending}>
            {pending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : format === 'pdf' ? <FileText size={15} /> : <FileDown size={15} />}
            {format === 'pdf' ? 'Сформировать PDF' : 'Экспортировать'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

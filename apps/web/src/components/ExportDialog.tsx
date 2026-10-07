import { useEffect, useState } from 'react';
import { FileDown } from 'lucide-react';
import { trpc } from '../lib/trpc.ts';
import { errorText } from '../lib/errors.ts';
import { toast } from '../lib/toast.ts';
import { Button, Dialog, Field, Input, Spinner, Textarea } from './ui.tsx';

// Окно «Экспорт в файл»: автор, примечание, необязательный пароль, опции. Файл собирает сервер
// (ZIP, зашифрованный всегда — без пароля ключ выводится из пустой строки, см. packages/shared/src/export.ts).

const NOUN = { dossier: 'досье', investigation: 'расследования' } as const;

function download(fileName: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function ExportDialog({
  kind, id, open, onOpenChange,
}: {
  kind: keyof typeof NOUN;
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

  const onSuccess = (r: { fileName: string; data: string }) => {
    download(r.fileName, r.data);
    toast(`Файл «${r.fileName}» сохранён`);
    onOpenChange(false);
  };
  const onError = (e: unknown) => toast(errorText(e), 'error');
  const dossier = trpc.dossiers.exportFile.useMutation({ onSuccess, onError });
  const investigation = trpc.investigations.exportFile.useMutation({ onSuccess, onError });
  const mutation = kind === 'dossier' ? dossier : investigation;

  // Каждое открытие — с чистыми паролями; автор по умолчанию — имя пользователя.
  useEffect(() => {
    if (!open) return;
    setPassword('');
    setRepeat('');
    setAuthor((a) => a || me.data?.displayName || '');
  }, [open, me.data?.displayName]);

  const mismatch = password !== repeat;
  const submit = () => {
    if (mismatch || mutation.isPending) return;
    mutation.mutate({ id, author, note, password, options: { editable } });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Экспорт ${NOUN[kind]} в файл`}>
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
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={4000} placeholder="Для кого и зачем этот файл" />
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
            : 'Пароль необязателен. Файл шифруется всегда, но без пароля его откроет любая установка Следопыта; с паролем — только тот, кто его знает.'}
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={editable} onChange={(e) => setEditable(e.target.checked)} className="accent-[var(--color-mint)]" />
          Доступно редактирование
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={mismatch || mutation.isPending}>
            {mutation.isPending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : <FileDown size={15} />} Экспортировать
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

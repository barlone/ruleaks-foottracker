import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, FileUp } from 'lucide-react';
import { EXPORT_EXTENSION } from '@ft/shared';
import { trpc, type RouterOutputs } from '../lib/trpc.ts';
import { errorCode, errorText } from '../lib/errors.ts';
import { fmtDate } from '../lib/format.ts';
import { toast } from '../lib/toast.ts';
import { Button, Dialog, Field, FilePicker, Input, Spinner, Tag } from './ui.tsx';

// Окно «Импорт из файла»: выбрать файл экспорта (.ftx) и, если нужно, пароль → сервер показывает, что внутри
// и что уже было импортировано раньше (будет перезаписано целиком) → подтверждение → переход к объекту.
// Файл уходит на сервер частями (у сервера предел размера запроса).

type Preview = RouterOutputs['imports']['inspect'];

/** Длина части в символах base64 (кратна 4 — каждая часть декодируется отдельно). */
const CHUNK = 6_000_000;

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error ?? new Error('Не удалось прочитать файл'));
    r.readAsDataURL(file);
  });
}

const NOUN = { dossier: 'досье', investigation: 'расследование' } as const;

export function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const upload = trpc.imports.upload.useMutation();
  const inspect = trpc.imports.inspect.useMutation();
  const commit = trpc.imports.commit.useMutation();

  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [needPassword, setNeedPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setFile(null);
    setPassword('');
    setUploadId(null);
    setPreview(null);
    setNeedPassword(false);
    setError(null);
  };
  const close = (v: boolean) => {
    if (busy) return;
    if (!v) reset();
    onOpenChange(v);
  };

  const sendFile = async (f: File): Promise<string> => {
    const data = await readBase64(f);
    let id: string | undefined;
    for (let at = 0; at < data.length; at += CHUNK) {
      id = (await upload.mutateAsync({ uploadId: id, chunk: data.slice(at, at + CHUNK) })).uploadId;
    }
    setUploadId(id!);
    return id!;
  };

  const open_ = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      let id = uploadId ?? (await sendFile(file));
      let p: Preview;
      try {
        p = await inspect.mutateAsync({ uploadId: id, password });
      } catch (e) {
        // Сервер перезапускался или файл пролежал дольше получаса — загружаем заново.
        if (errorCode(e) !== 'UPLOAD_EXPIRED') throw e;
        id = await sendFile(file);
        p = await inspect.mutateAsync({ uploadId: id, password });
      }
      setPreview(p);
    } catch (e) {
      const code = errorCode(e);
      setNeedPassword(code === 'NEED_PASSWORD' || code === 'BAD_PASSWORD');
      // Файл не подошёл — следующий выбор загружается заново.
      if (code !== 'NEED_PASSWORD' && code !== 'BAD_PASSWORD') setUploadId(null);
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!uploadId) return;
    setBusy(true);
    try {
      const r = await commit.mutateAsync({ uploadId });
      await Promise.all([utils.dossiers.invalidate(), utils.investigations.invalidate(), utils.tags.invalidate(), utils.relations.invalidate()]);
      toast(`Импортировано: ${preview?.root.title ?? ''}`);
      setBusy(false);
      close(false);
      if (r.type === 'dossier') void navigate({ to: '/dossiers/$id', params: { id: r.id } });
      else void navigate({ to: '/investigations/$id', params: { id: r.id } });
    } catch (e) {
      setBusy(false);
      setError(errorText(e));
      // Загрузка израсходована (сервер её забыл) — начать с выбора файла.
      setUploadId(null);
      setPreview(null);
    }
  };

  const overwrites = preview
    ? [
        ...(preview.investigation?.existing ? [{ title: preview.investigation.existing.title, noun: 'расследование' }] : []),
        ...preview.dossiers.flatMap((d) => (d.existing ? [{ title: d.existing.title, noun: 'досье' }] : [])),
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={close} title="Импорт из файла">
      {!preview ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void open_();
          }}
        >
          <Field label="Файл экспорта">
            <FilePicker
              accept={`.${EXPORT_EXTENSION}`}
              disabled={busy}
              onFiles={([f]) => {
                setFile(f ?? null);
                setUploadId(null);
                setNeedPassword(false);
                setError(null);
              }}
            />
          </Field>
          <Field label="Пароль" hint={needPassword ? undefined : 'Только если его задали при экспорте.'}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={256}
              autoComplete="off"
              autoFocus={needPassword}
              className={needPassword ? 'border-warn/60' : undefined}
            />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => close(false)} disabled={busy}>Отмена</Button>
            <Button type="submit" variant="primary" disabled={!file || busy}>
              {busy ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : <FileUp size={15} />} Открыть
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="dim">{NOUN[preview.root.type]}</Tag>
              {preview.passwordProtected && <Tag tone="dim">с паролем</Tag>}
              <Tag tone={preview.editable ? 'mint' : 'warn'}>{preview.editable ? 'редактирование доступно' : 'автор: без редактирования'}</Tag>
            </div>
            <div className="mt-2 text-lg font-bold">{preview.root.title}</div>
            <div className="mt-1 font-mono text-[11px] text-mute">
              {preview.author ? `${preview.author} · ` : ''}экспорт {fmtDate(preview.exportedAt, true)}
            </div>
            {preview.note && <p className="mt-2 whitespace-pre-wrap text-sm text-dim">{preview.note}</p>}
          </div>

          <div className="rounded-xl border border-line-soft p-3 text-sm">
            <div className="label-mono mb-2">В файле</div>
            <ul className="space-y-1">
              {preview.investigation && (
                <li>
                  Расследование: узлов {preview.investigation.nodes}, фактов {preview.investigation.facts}, гипотез {preview.investigation.hypotheses}
                </li>
              )}
              {preview.dossiers.length > 0 && (
                <li>
                  Досье ({preview.dossiers.length}): {preview.dossiers.map((d) => d.title).join(', ')}
                </li>
              )}
              <li className="font-mono text-xs text-dim">
                связей {preview.relations} · фото {preview.media} · снимков поиска {preview.searches}
              </li>
            </ul>
          </div>

          {overwrites.length > 0 && (
            <div className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm">
              <div className="mb-1.5 flex items-center gap-2 font-semibold text-danger"><AlertTriangle size={15} /> Полная перезапись</div>
              <p className="text-text">
                Эти объекты у вас уже есть — из прошлого импорта или это оригиналы, из которых сделан файл. Их содержимое
                будет полностью заменено данными из файла, правки после экспорта пропадут (видимость и доступы сохранятся):
              </p>
              <ul className="mt-2 list-disc space-y-0.5 pl-5">
                {overwrites.map((o, i) => <li key={i}>{o.noun} «{o.title}»</li>)}
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => { setPreview(null); setError(null); }} disabled={busy}>Назад</Button>
            <Button variant={overwrites.length ? 'danger' : 'primary'} onClick={() => void run()} disabled={busy}>
              {busy ? <Spinner /> : <FileUp size={15} />} {overwrites.length ? 'Перезаписать' : 'Импортировать'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

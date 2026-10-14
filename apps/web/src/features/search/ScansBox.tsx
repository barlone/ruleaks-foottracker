import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import * as RDialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { Check, ChevronLeft, ChevronRight, Copy, Download, ExternalLink, FileImage, FolderPlus, RotateCcw, RotateCw, X } from 'lucide-react';
import type { LeakCard } from '@ft/shared';
import { Card, Spinner, Tag } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { SaveScanDialog } from './SaveScanDialog.tsx';

// Сканы документов из результатов поиска ([scanstore-api]): в записи утечки ключ scans — uuid сканов,
// картинку сервер отдаёт по /scans/<uuid> (scans.config.imagePath), подписи — из scans.meta.

type Meta = NonNullable<RouterOutputs['scans']['meta'][string]>;

/** Коды типов DocScanSort (TYPE_CODES в docsplit.py) → подписи. */
const DOCTYPES: Record<string, string> = {
  passport: 'Паспорт',
  passport_reg: 'Паспорт · прописка',
  passport_other: 'Паспорт · разворот',
  snils: 'СНИЛС',
  inn: 'ИНН',
  driverlic: 'Водительское удостоверение',
  driverlic_back: 'ВУ · оборот',
  drivercard: 'Карта водителя',
  card: 'Карта',
  unknown: 'Документ',
};
const doctypeLabel = (t: string | undefined) => (t ? DOCTYPES[t] ?? t : 'Документ');

/** Сканы одной записи утечки (одна папка документов одного человека). */
interface ScanGroup {
  key: string;
  person: string | null;
  leak: string;
  ids: string[];
}

/** uuid сканов из записей утечек; скан, уже показанный в другой записи, не повторяется. */
function scanGroups(leaks: LeakCard[]): ScanGroup[] {
  const seen = new Set<string>();
  const out: ScanGroup[] = [];
  for (const card of leaks) for (const t of card.tuples ?? []) {
    const ids = (t.scans ?? []).map((s) => s.toLowerCase()).filter((s) => !seen.has(s) && seen.add(s));
    if (ids.length) out.push({ key: `${card.leak}:${t.tuple}`, person: t.names?.[0] ?? null, leak: card.leak, ids });
  }
  return out;
}

/**
 * Один и тот же файл бывает загружен в хранилище несколько раз (разные uuid, один sha256) и привязан к разным
 * записям утечки — показывается только первая копия; запись, у которой не осталось сканов, не показывается.
 */
function dropDuplicates(groups: ScanGroup[], meta: Record<string, Meta | null> | undefined): ScanGroup[] {
  if (!meta) return groups;
  const seen = new Set<string>();
  const out: ScanGroup[] = [];
  for (const g of groups) {
    const ids = g.ids.filter((id) => {
      const sha = meta[id]?.sha256;
      return !sha || (!seen.has(sha) && !!seen.add(sha));
    });
    if (ids.length) out.push(ids.length === g.ids.length ? g : { ...g, ids });
  }
  return out;
}

export interface FoundScans {
  /** Путь картинок (/scans); null — хранилище сканов выключено. */
  path: string | null;
  groups: ScanGroup[];
  count: number;
  meta: Record<string, Meta | null> | undefined;
  metaError: boolean;
}

/**
 * Сканы из результатов простого поиска (leaks = null — их нет). Хук, а не часть бокса: число сканов без дублей
 * нужно ещё и фильтру атрибутов, поэтому метаданные (там sha256) запрашиваются здесь.
 */
export function useFoundScans(leaks: LeakCard[] | null): FoundScans {
  const cfg = trpc.scans.config.useQuery(undefined, { staleTime: Infinity });
  const path = cfg.data?.imagePath ?? null;
  const raw = useMemo(() => (path && leaks ? scanGroups(leaks) : []), [path, leaks]);
  const ids = useMemo(() => raw.flatMap((g) => g.ids), [raw]);
  const meta = trpc.scans.meta.useQuery({ ids }, { enabled: ids.length > 0, staleTime: Infinity, retry: 1 });
  const groups = useMemo(() => dropDuplicates(raw, meta.data), [raw, meta.data]);
  return { path, groups, count: groups.reduce((n, g) => n + g.ids.length, 0), meta: meta.data, metaError: meta.isError };
}

/** Бокс с превью сканов документов; клик открывает скан целиком. */
export function ScansBox({ scans }: { scans: FoundScans }) {
  const { groups, meta: metaData, path } = scans;
  const all = useMemo(() => groups.flatMap((g) => g.ids.map((id) => ({ id, group: g }))), [groups]);
  // Номер открытого скана в all. Новый результат поиска — новый бокс (key), окно закрывается само.
  const [open, setOpen] = useState<number | null>(null);

  if (!all.length || !path) return null;
  const src = (id: string) => `${path}/${id}`;
  const index = new Map(all.map((s, i) => [s.id, i]));
  // Подпись группы нужна, только когда записей несколько.
  const titled = groups.length > 1;

  return (
    <Card title="Сканы документов" actions={<Tag tone="dim">{all.length}</Tag>}>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g.key}>
            {titled && (
              <div className="mb-2 font-mono text-[11px] text-dim">
                {g.person && <span className="text-text">{g.person}</span>}
                {g.person && ' · '}
                {g.leak}
              </div>
            )}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {g.ids.map((id) => (
                <ScanThumb
                  key={id}
                  src={src(id)}
                  meta={metaData?.[id] ?? undefined}
                  missing={metaData !== undefined && metaData[id] === null}
                  onOpen={() => setOpen(index.get(id)!)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      {scans.metaError && <p className="mt-3 font-mono text-[11px] text-warn">Не удалось получить описания сканов — показаны только изображения</p>}
      <ScanViewer
        scans={all.map((s) => ({ id: s.id, src: src(s.id), meta: metaData?.[s.id] ?? undefined, person: s.group.person, leak: s.group.leak }))}
        index={open}
        onIndex={setOpen}
      />
    </Card>
  );
}

function ScanThumb({ src, meta, missing, onOpen }: { src: string; meta: Meta | undefined; missing: boolean; onOpen: () => void }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const failed = missing || state === 'error';
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={failed}
      // Описание есть, а картинка не загрузилась — это не «нет скана», а сбой выдачи картинки (/scans не проксируется, хранилище недоступно).
      title={missing ? 'Скан не найден в хранилище' : failed ? 'Не удалось загрузить изображение скана' : 'Открыть скан'}
      className={clsx(
        'group flex flex-col overflow-hidden rounded-lg border border-line bg-bg-soft text-left transition',
        failed ? 'cursor-default opacity-60' : 'cursor-zoom-in hover:border-mint/60 hover:shadow-glow-sm',
      )}
    >
      <div className="relative grid h-36 place-items-center bg-black">
        {failed ? (
          <FileImage size={28} className="text-mute" />
        ) : (
          <>
            {state === 'loading' && <Spinner className="absolute size-5" />}
            <img
              src={src}
              alt={doctypeLabel(meta?.doctype)}
              loading="lazy"
              decoding="async"
              onLoad={() => setState('ok')}
              onError={() => setState('error')}
              className={clsx('max-h-full max-w-full object-contain transition', state === 'ok' ? 'opacity-100' : 'opacity-0')}
            />
          </>
        )}
      </div>
      <div className="space-y-0.5 border-t border-line-soft px-2 py-1.5">
        <div className="truncate font-mono text-[10px] uppercase tracking-wide text-mint">{meta ? doctypeLabel(meta.doctype) : failed ? 'Нет файла' : 'Скан'}</div>
        {meta?.docnum && <div className="truncate font-mono text-[11px] text-dim">{meta.docnum}</div>}
      </div>
    </button>
  );
}

interface ViewerScan {
  id: string;
  src: string;
  meta: Meta | undefined;
  person: string | null;
  leak: string;
}

/**
 * Скан, повёрнутый на deg (кратно 90°), в PNG или JPEG; maxSide — уменьшить до этого размера по большей стороне.
 * Картинка с того же origin — canvas не «загрязняется».
 */
async function renderScan(src: string, deg: number, type: 'image/png' | 'image/jpeg', maxSide = Infinity): Promise<Blob> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k);
  const h = Math.round(img.naturalHeight * k);
  const quarter = deg % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = quarter ? h : w;
  canvas.height = quarter ? w : h;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('не удалось подготовить изображение'))), type, 0.92));
}

/** Исходный файл скана (из кэша браузера). */
const fetchScan = (src: string) => fetch(src).then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`скан не загрузился (${r.status})`))));

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

/** Больше этого по большей стороне скан в досье уменьшается: пока нет S3, медиа досье хранятся в БД как data URL. */
const MEDIA_MAX_SIDE = 2400;

/** Имя файла скана: тип_номер.jpg (или uuid, если номера нет). */
const scanFileName = (scan: ViewerScan) => `${scan.meta?.doctype ?? 'scan'}_${scan.meta?.docnum ?? scan.id}`.replace(/[^\p{L}\p{N}._-]+/gu, '_') + '.jpg';

/**
 * Окно со сканом целиком: ←/→ — соседние сканы, Esc — закрыть. Поворот — на экране и в сохраняемом/копируемом
 * изображении; без поворота сохраняется исходный файл как есть.
 */
function ScanViewer({ scans, index, onIndex }: { scans: ViewerScan[]; index: number | null; onIndex: (i: number | null) => void }) {
  const scan = index === null ? null : scans[index];
  // Естественный размер картинки (после загрузки) и угол поворота: накапливается (−90, 360…), чтобы анимация шла в нужную сторону.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ ok: boolean; text: string; dossierId?: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [lastDossierId, setLastDossierId] = useState('');
  useEffect(() => {
    setNatural(null);
    setRotation(0);
    setFlash(null);
  }, [scan?.src]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), flash.dossierId ? 8000 : flash.ok ? 1500 : 4000);
    return () => clearTimeout(t);
  }, [flash]);

  // Поле под картинкой: повёрнутая картинка вписывается в него своим повёрнутым габаритом.
  const [field, setField] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!field) return;
    const ro = new ResizeObserver(() => setBox({ w: field.clientWidth - 32, h: field.clientHeight - 32 }));
    ro.observe(field);
    return () => ro.disconnect();
  }, [field]);

  const step = (d: number) => index !== null && scans.length > 1 && onIndex((index + d + scans.length) % scans.length);
  const deg = ((rotation % 360) + 360) % 360;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try {
      setFlash({ ok: true, text: await fn() });
    } catch (e) {
      setFlash({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  const save = (s: ViewerScan) =>
    run(async () => {
      const blob = deg === 0 ? await fetchScan(s.src) : await renderScan(s.src, deg, 'image/jpeg');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = scanFileName(s);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return 'Сохранено';
    });
  const copy = (s: ViewerScan) =>
    run(async () => {
      // Буфер обмена принимает картинки только в PNG и только в безопасном контексте (HTTPS, localhost).
      if (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
        throw new Error('Копирование картинок недоступно: сайт открыт не по HTTPS');
      }
      // Промис, а не готовый Blob: Safari требует вызвать write сразу в обработчике клика.
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderScan(s.src, deg, 'image/png') })]);
      } catch (e) {
        if (e instanceof DOMException && e.name === 'NotAllowedError') throw new Error('Браузер не разрешил запись в буфер обмена');
        throw e;
      }
      return 'Скопировано';
    });

  /** Картинка для досье: исходный файл, а повёрнутая или слишком большая — перекодированная в JPEG. */
  const mediaDataUrl = async (s: ViewerScan) => {
    const big = !natural || Math.max(natural.w, natural.h) > MEDIA_MAX_SIDE;
    return blobToDataUrl(deg === 0 && !big ? await fetchScan(s.src) : await renderScan(s.src, deg, 'image/jpeg', MEDIA_MAX_SIDE));
  };

  // Пока размеры неизвестны — обычное вписывание; дальше — явные размеры с учётом поворота.
  let imgStyle: CSSProperties | undefined;
  if (natural && box.w > 0 && box.h > 0) {
    const quarter = deg % 180 !== 0;
    const k = Math.min(box.w / (quarter ? natural.h : natural.w), box.h / (quarter ? natural.w : natural.h), 1);
    imgStyle = { width: natural.w * k, height: natural.h * k, maxWidth: 'none', maxHeight: 'none', transform: `rotate(${rotation}deg)` };
  }

  const m = scan?.meta;
  const person = m?.personName ?? scan?.person;
  return (
    <RDialog.Root open={scan != null} onOpenChange={(v) => !v && onIndex(null)}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-black/85 backdrop-blur-sm" />
        <RDialog.Content
          onOpenAutoFocus={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (!e.currentTarget.contains(e.target as Node)) return;
            if (e.key === 'ArrowLeft') step(-1);
            else if (e.key === 'ArrowRight') step(1);
            else return;
            e.preventDefault();
          }}
          className="fixed inset-0 z-50 flex flex-col outline-none"
        >
          {scan && (
            <>
              <header className="flex items-center gap-3 border-b border-line bg-panel/90 px-4 py-2">
                <RDialog.Title className="label-mono truncate">{doctypeLabel(m?.doctype)}</RDialog.Title>
                <RDialog.Description className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-dim">
                  {m?.docnum && <span className="text-text">{m.docnum}</span>}
                  {person && <span>{person}</span>}
                  {m?.personBday && <span>{m.personBday}</span>}
                  {m && m.width > 0 && <span className="text-mute">{m.width}×{m.height}</span>}
                  <span className="text-mute">{scan.leak}</span>
                </RDialog.Description>
                {flash && (
                  <span className={clsx('font-mono text-[11px]', flash.ok ? 'text-mint' : 'text-danger')}>
                    {flash.text}
                    {flash.dossierId && (
                      <Link to="/dossiers/$id" params={{ id: flash.dossierId }} className="ml-2 text-dim underline hover:text-mint">
                        открыть
                      </Link>
                    )}
                  </span>
                )}
                {scans.length > 1 && <span className="font-mono text-[11px] text-dim">{index! + 1} / {scans.length}</span>}
                <div className="flex items-center gap-1">
                  <ToolButton title="Повернуть против часовой стрелки" onClick={() => setRotation((r) => r - 90)}>
                    <RotateCcw size={16} />
                  </ToolButton>
                  <ToolButton title="Повернуть по часовой стрелке" onClick={() => setRotation((r) => r + 90)}>
                    <RotateCw size={16} />
                  </ToolButton>
                  <span className="mx-1 h-4 w-px bg-line" />
                  <ToolButton title={deg ? 'Сохранить в медиа досье (с поворотом)' : 'Сохранить в медиа досье'} disabled={busy || !natural} onClick={() => setSaveOpen(true)}>
                    <FolderPlus size={16} />
                  </ToolButton>
                  <ToolButton title={deg ? 'Сохранить в файл (с поворотом)' : 'Сохранить в файл'} disabled={busy} onClick={() => save(scan)}>
                    <Download size={16} />
                  </ToolButton>
                  <ToolButton title="Скопировать изображение в буфер обмена" disabled={busy} onClick={() => copy(scan)}>
                    {flash?.ok && flash.text === 'Скопировано' ? <Check size={16} className="text-mint" /> : <Copy size={16} />}
                  </ToolButton>
                  <a href={scan.src} target="_blank" rel="noreferrer" title="Открыть в новой вкладке" className={TOOL_CLASS}>
                    <ExternalLink size={16} />
                  </a>
                  <span className="mx-1 h-4 w-px bg-line" />
                  <RDialog.Close className={TOOL_CLASS} aria-label="Закрыть" title="Закрыть (Esc)">
                    <X size={18} />
                  </RDialog.Close>
                </div>
              </header>
              {/* Клик по полю вокруг картинки закрывает окно. */}
              <div
                ref={setField}
                className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4"
                onClick={(e) => e.target === e.currentTarget && onIndex(null)}
              >
                {!natural && <Spinner className="absolute size-7" />}
                <img
                  key={scan.src}
                  src={scan.src}
                  alt={doctypeLabel(m?.doctype)}
                  onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                  style={imgStyle}
                  className={clsx(
                    'max-h-full max-w-full shrink-0 rounded-md object-contain shadow-glow-sm transition-transform duration-200',
                    !natural && 'opacity-0',
                  )}
                />
                {scans.length > 1 && (
                  <>
                    <NavButton side="left" onClick={() => step(-1)} />
                    <NavButton side="right" onClick={() => step(1)} />
                  </>
                )}
              </div>
              <SaveScanDialog
                open={saveOpen}
                onOpenChange={setSaveOpen}
                image={() => mediaDataUrl(scan)}
                caption={[doctypeLabel(m?.doctype), m?.docnum].filter(Boolean).join(' ')}
                personGuess={scan.person ?? m?.personName ?? ''}
                scanId={scan.id}
                leak={scan.leak}
                lastDossierId={lastDossierId}
                onSaved={(d) => {
                  setLastDossierId(d.id);
                  setFlash({ ok: true, text: `Сохранено в досье «${d.title}»`, dossierId: d.id });
                }}
              />
            </>
          )}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

const TOOL_CLASS =
  'grid size-8 cursor-pointer place-items-center rounded-md text-dim transition hover:bg-mint/10 hover:text-mint disabled:cursor-wait disabled:opacity-50';

function ToolButton({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled} className={TOOL_CLASS}>
      {children}
    </button>
  );
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      title={side === 'left' ? 'Предыдущий скан (←)' : 'Следующий скан (→)'}
      className={clsx(
        'absolute top-1/2 grid size-10 -translate-y-1/2 cursor-pointer place-items-center rounded-full border border-line bg-panel/80 text-dim transition hover:border-mint hover:text-mint',
        side === 'left' ? 'left-4' : 'right-4',
      )}
    >
      <Icon size={20} />
    </button>
  );
}

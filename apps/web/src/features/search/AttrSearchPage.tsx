import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import clsx from 'clsx';
import { ArrowLeft, Check, Expand, ChevronDown, ChevronUp, CornerDownRight, FileSpreadsheet, FileText, Filter, Layers, List, ListChecks, Network, Save, Search as SearchIcon, SearchCheck, ShieldCheck, Undo2, Zap } from 'lucide-react';
import {
  FIELD_TO_KIND, SCANS_FIELD, STEP2_FIELDS, STEP2_KINDS, STEP2_MAX_SEARCHES, STEP2_SOURCES, attrCopyValue, attrDisplayValue, parseGeoloc, LEAK_FIELDS, SEARCH_KINDS, detectKinds,
  isUkrainianPhone, leakLive, removeSavedValues, restoreSavedValues, step2ByText, step2Summary, tupleLive, type DeepRow, type LeakCard, type LeakField, type LeakTuple, type SavedValueRestore, type Step2Info,
} from '@ft/shared';
import { Button, Card, ConfirmDeleteBtn, CopyButton, Empty, Input, Select, Spinner, Tag } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { toast } from '../../lib/toast.ts';
import { t, tc, tj, tn, tx } from '../../lib/i18n.ts';
import { AddToDossierDialog, type PendingValue } from './AddToDossierDialog.tsx';
import { AttrExportDialog } from './AttrExportDialog.tsx';
import { JobStatus, ResultBar, SearchLayout } from './common.tsx';
import { isEditingJob, useRunOnMount, useSearchJob } from './job.ts';
import { ValueActions } from './ValueActions.tsx';
import { BackToDossier } from './BackToDossier.tsx';
import type { FoundGeoPoint } from './GeoPointsMap.tsx';
import { ScansBox } from './ScansBox.tsx';
import { useFoundScans } from './foundScans.ts';

type Job = RouterOutputs['search']['job'];

/** «Поиск по атрибутам» — /search и /deepsearch бота. */
export function AttrSearchPage() {
  const params = useSearch({ from: '/search' });
  const navigate = useNavigate({ from: '/search' });
  const me = trpc.auth.me.useQuery();
  const [value, setValue] = useState(params.q ?? '');
  const [kind, setKind] = useState<string>(params.kind ?? 'auto');
  const [deep, setDeep] = useState(params.deep ?? false);
  // Дополнительный поиск вторым шагом (взаимоисключающий с глубоким): по каким найденным атрибутам искать
  // и какие атрибуты брать из его записей.
  const [step2, setStep2] = useState(false);
  const [step2By, setStep2By] = useState<Set<string>>(() => new Set(STEP2_KINDS));
  const [step2Fields, setStep2Fields] = useState<Set<string>>(() => new Set(STEP2_FIELDS));
  const [jobId, setJobId] = useState<string | null>(null);
  const utils = trpc.useUtils();

  // Варианты «Авто: …» — подходящие по маске виды поиска в порядке вероятности (как кнопки в боте).
  // kind: 'auto' — самый вероятный; 'auto:<вид>' — выбранный вариант «Авто»; '<вид>' — выбран вручную.
  const detected = useMemo(() => detectKinds(value), [value]);
  const autoPick = kind.startsWith('auto:') ? kind.slice(5) : null;
  const effectiveKind = kind === 'auto' || autoPick ? (autoPick && detected.includes(autoPick) ? autoPick : detected[0] ?? null) : kind;
  const selectValue = kind === 'auto' || autoPick ? (effectiveKind ? `auto:${effectiveKind}` : 'auto') : kind;
  const kindInfo = SEARCH_KINDS.find((k) => k.id === effectiveKind);
  const label = (id: string) => t(SEARCH_KINDS.find((k) => k.id === id)?.label ?? id);

  const start = trpc.search.start.useMutation({
    onSuccess: (j) => {
      setJobId(j.id);
      void utils.search.recent.invalidate({ section: 'attr' });
    },
  });
  const job = useSearchJob(jobId);

  // Сохранённые данные во весь экран (?full): только пока открыт результат в режиме редактирования. Адрес с ?full,
  // открытый заново (задача не выбрана) или с обычным результатом, возвращается к обычному виду.
  const editing = !!jobId && isEditingJob(job.data);
  const full = !!params.full && editing;
  const fullStale = !!params.full && (!jobId || (!!job.data && !editing) || !!job.error);
  useEffect(() => {
    if (fullStale) void navigate({ search: (prev) => ({ ...prev, full: undefined }), replace: true });
  }, [fullStale, navigate]);
  // Вход добавляет запись в историю браузера («назад» выходит из режима), выход её заменяет — как в редакторе связей.
  const setFull = (on: boolean) => void navigate({ search: (prev) => ({ ...prev, full: on || undefined }), replace: !on });

  function run(k = effectiveKind, v = value, d = deep) {
    if (!k || !v.trim()) return;
    void navigate({ search: { kind: k, q: v, deep: d } });
    start.mutate({
      section: 'attr', kind: k, value: v.trim(), deep: d && !step2,
      ...(step2 ? { step2: [...step2Fields], step2by: [...step2By] } : {}),
    });
  }

  // Переход по ссылке /search?kind=..&q=.. (из досье или «провалиться» в значение) запускает поиск.
  useRunOnMount(() => {
    setValue(params.q!);
    setKind(params.kind!);
    setDeep(params.deep ?? false);
    start.mutate({ section: 'attr', kind: params.kind!, value: params.q!, deep: params.deep ?? false });
  }, !!(params.q && params.kind), !!me.data?.access.active);

  const pivot = (k: string, v: string) => {
    setValue(v);
    setKind(k);
    run(k, v, deep);
  };

  const disabled = !me.data?.access.active;
  // Второй шаг невозможен, пока не выбрано, по чему искать и что брать.
  const noStep2Fields = step2 && (!step2By.size || !step2Fields.size);

  return (
    <SearchLayout
      section="attr"
      title={t('Поиск по атрибутам')}
      titleExtra={params.from && <BackToDossier id={params.from} />}
      subtitle={t('Телефон, email, ФИО, документы, авто, Telegram ID… Найденное можно сразу перенести в досье.')}
      activeId={jobId}
      onOpen={setJobId}
      full={full}
    >

        <Card className={clsx('animate-fade-up', full && 'hidden')}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <div className="flex gap-3 max-md:flex-col">
              <div className="relative flex-1">
                <SearchIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mint/70" />
                <Input
                  autoFocus
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={kindInfo?.placeholder ? t(kindInfo.placeholder) : t('Телефон, email, ФИО, ИНН, госномер, Telegram ID…')}
                  className="h-12 pl-10 font-mono text-base"
                  disabled={disabled}
                />
              </div>
              <Select value={selectValue} onChange={(e) => setKind(e.target.value)} className="h-12 md:w-60" disabled={disabled}>
                {detected.length === 0 && <option value="auto">{t('Авто')}</option>}
                {detected.map((id) => (
                  <option key={`auto:${id}`} value={`auto:${id}`}>{t('Авто: {kind}', { kind: label(id) })}</option>
                ))}
                <option disabled>──────────────</option>
                {SEARCH_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>{t(k.label)}</option>
                ))}
              </Select>
              <Button type="submit" variant="primary" className="h-12 px-6" disabled={disabled || !effectiveKind || !value.trim() || noStep2Fields || start.isPending}>
                {start.isPending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : t('Искать')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className={clsx('flex cursor-pointer items-center gap-2', !kindInfo?.deep && 'opacity-40')}>
                <input
                  type="checkbox"
                  checked={deep && !step2}
                  onChange={(e) => {
                    setDeep(e.target.checked);
                    if (e.target.checked) setStep2(false);
                  }}
                  disabled={!kindInfo?.deep}
                  className="accent-[var(--color-mint)]"
                />
                <Layers size={14} className="text-mint" /> {t('Глубокий поиск со связями')}
              </label>
              <label
                className="flex cursor-pointer items-center gap-2"
                title={t('После обычного поиска — простые поиски по найденным атрибутам ({kinds}; до {max} поисков); из их записей добавляются отмеченные атрибуты с пометкой ²', {
                  kinds: STEP2_BY_OPTIONS.map((o) => fieldLabel(o.field)).join(', '),
                  max: STEP2_MAX_SEARCHES,
                })}
              >
                <input
                  type="checkbox"
                  checked={step2}
                  onChange={(e) => {
                    setStep2(e.target.checked);
                    if (e.target.checked) setDeep(false);
                  }}
                  className="accent-[var(--color-mint)]"
                />
                <ListChecks size={14} className="text-mint" /> {t('Дополнительный поиск вторым шагом')}
              </label>
              {(kind === 'auto' || autoPick) && value.trim() && !detected.length && (
                <Tag tone="warn">{isUkrainianPhone(value) ? t('поиск только по номерам РФ') : t('тип не распознан — выберите вручную')}</Tag>
              )}
              {start.error && <Tag tone="danger">{errorText(start.error)}</Tag>}
            </div>
            {step2 && (
              <div className="space-y-2">
                <ChipSet
                  title={t('Искать вторым шагом по:')}
                  icon={<SearchCheck size={13} className="text-mint" />}
                  options={STEP2_BY_OPTIONS}
                  value={step2By}
                  onChange={setStep2By}
                  empty={t('второй шаг поиска невозможен — отметьте, по каким атрибутам искать')}
                />
                <ChipSet
                  title={t('Брать из второго шага:')}
                  icon={<ListChecks size={13} className="text-mint" />}
                  options={STEP2_FIELD_OPTIONS}
                  value={step2Fields}
                  onChange={setStep2Fields}
                  empty={t('второй шаг поиска невозможен — отметьте хотя бы один атрибут')}
                />
              </div>
            )}
          </form>
        </Card>

      {jobId && (
        <JobView job={job.data} loading={job.isLoading} error={job.error ? errorText(job.error) : null} onPivot={pivot} fullscreen={full} onFullscreen={setFull} />
      )}
      {!jobId && (
        <Empty>
          {t('Введите значение — тип определится автоматически.')}
          <br />
          {t('Из любого найденного значения можно сделать следующий шаг поиска.')}
        </Empty>
      )}
    </SearchLayout>
  );
}

/** Результат raw/deep-поиска по утечкам: и «Поиск по атрибутам», и «Поиск по геоданным» (у шлюза ответ того же вида). */
export function JobView({
  job, loading, error, onPivot, fullscreen, onFullscreen,
}: {
  job: Job | undefined;
  loading: boolean;
  error?: string | null;
  onPivot: (kind: string, value: string) => void;
  /** Сохранённые данные открыты во весь экран (страница убрала всё, кроме результата). */
  fullscreen?: boolean;
  /** Страница умеет показывать результат во весь экран: в режиме редактирования есть кнопка. */
  onFullscreen?: (on: boolean) => void;
}) {
  const [selected, setSelected] = useState<Map<string, PendingValue>>(new Map());
  const [dialog, setDialog] = useState(false);
  const [exportFormat, setExportFormat] = useState<'pdf' | 'xlsx'>('pdf');
  const [exportOpen, setExportOpen] = useState(false);
  // Сохранённый результат глубокого поиска во весь экран можно смотреть графом связей вместо списка боксов.
  const [graph, setGraph] = useState(false);
  const exportAs = (f: 'pdf' | 'xlsx') => {
    setExportFormat(f);
    setExportOpen(true);
  };
  // Сохранённые для редактирования данные: копия результата у строки истории.
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const save = trpc.search.save.useMutation({
    onSuccess: (_r, { id }) => {
      void utils.search.job.invalidate({ id });
      void utils.search.recent.invalidate();
      toast(t('Результат сохранён — его можно редактировать'));
    },
    onError: (e) => toast(errorText(e), 'error'),
  });
  const remove = trpc.search.savedRemove.useMutation({
    // Значение пропадает сразу, не дожидаясь сервера; при ошибке данные перечитываются.
    onMutate: ({ id, ...del }) => {
      utils.search.job.setData({ id }, (prev) => (prev ? { ...prev, result: removeSavedValues(prev.result, del) } : prev));
    },
    onError: (e, { id }) => {
      toast(errorText(e), 'error');
      // Что из удалений дошло до сервера, неизвестно — отменять по памяти нечего.
      setUndo([]);
      void utils.search.job.invalidate({ id });
    },
  });
  // Отмена удаления: помнятся три последних хода (ход — одно удаление: значение или карточка графа целиком).
  const [undo, setUndo] = useState<UndoMove[]>([]);
  const restore = trpc.search.savedRestore.useMutation({
    onMutate: ({ id, ...back }) => {
      utils.search.job.setData({ id }, (prev) => (prev ? { ...prev, result: restoreSavedValues(prev.result, back) } : prev));
    },
    onError: (e, { id }) => {
      toast(errorText(e), 'error');
      void utils.search.job.invalidate({ id });
    },
  });
  // Сканы — до ранних return: хуки. Ссылка на leaks стабильна между опросами (structural sharing react-query).
  const scanLeaks = job?.state === 'done' && !job.deep ? ((job.result as { job?: { leaks?: LeakCard[] } } | null)?.job?.leaks ?? null) : null;
  const scans = useFoundScans(scanLeaks);
  // Фильтр по найденным атрибутам: пусто — показывать всё.
  const [fields, setFields] = useState<Set<string>>(new Set());
  // Свёрнутые карточки утечек — по индексу в leaks.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  useEffect(() => {
    setSelected(new Map());
    setFields(new Set());
    setCollapsed(new Set());
    setUndo([]);
  }, [job?.id]);
  const toggleCollapsed = (i: number) => {
    const next = new Set(collapsed);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setCollapsed(next);
  };

  if (job?.state === 'choose') {
    return (
      <Card title={t('Ник принадлежит нескольким пользователям')}>
        <p className="mb-3 text-sm text-dim">{t('Выберите Telegram ID для запроса «{query}»:', { query: job.query })}</p>
        <div className="flex flex-wrap gap-2">
          {job.candidates?.map((id) => (
            <Button key={id} onClick={() => onPivot('tgid', id)}>{id}</Button>
          ))}
        </div>
      </Card>
    );
  }
  const status = <JobStatus job={job} loading={loading} error={error} />;
  if (!job || job.state !== 'done') return status;

  const res = job.result as { job?: { leaks?: LeakCard[]; rows?: DeepRow[] } } | null;
  const leaks = res?.job?.leaks ?? [];
  // После правок сохранённых данных утечка может опустеть: она остаётся в leaks (номера не сдвигаются), но не считается.
  const liveLeaks = leaks.filter(leakLive).length;
  const allRows = res?.job?.rows ?? [];
  // Удалённые из сохранённых данных строки не показываются, но остаются для «найдено через».
  const rows = allRows.filter((r) => !r.removed);
  const editing = !!job.saved;
  /** Удалить значения из сохранённых данных и запомнить ход для отмены. */
  const removeMove = (move: UndoMove) => {
    setUndo((prev) => [...prev, move].slice(-UNDO_DEPTH));
    remove.mutate({ id: job.id, ...move });
  };
  const undoLast = () => {
    const move = undo.at(-1);
    if (!move) return;
    setUndo(undo.slice(0, -1));
    restore.mutate({ id: job.id, ...move });
  };
  const graphAllowed = editing && job.deep && !!fullscreen;
  const asGraph = graphAllowed && graph;
  /** Удалённое из сохранённых данных значение больше не отмечено для досье. */
  const unselect = (f: string, v: string) => {
    if (!selected.has(`${f}:${v}`)) return;
    const next = new Map(selected);
    next.delete(`${f}:${v}`);
    setSelected(next);
  };
  const step2 = (job.result as { step2?: Step2Info } | null)?.step2 ?? null;
  const step2Added = step2?.queries.reduce((n, q) => n + (q.added ?? 0), 0) ?? 0;
  const summary = job.deep
    ? tn(rows.length, '{n} связанное значение|{n} связанных значения|{n} связанных значений')
    : tn(liveLeaks, '{n} утечка|{n} утечки|{n} утечек') + (step2 ? t(', вторым шагом добавлено значений: {n}', { n: step2Added }) : '');

  // Атрибуты, которые есть в результатах, и сколько у каждого значений.
  const counts = new Map<string, number>();
  if (job.deep) for (const r of rows) counts.set(r.prm, (counts.get(r.prm) ?? 0) + 1);
  else for (const c of leaks) for (const t of c.tuples ?? []) for (const f of Object.keys(LEAK_FIELDS) as LeakField[]) {
    const n = (t[f]?.length ?? 0) + (t.step2?.filter((x) => x.f === f).length ?? 0);
    if (n) counts.set(f, (counts.get(f) ?? 0) + n);
  }
  // Сканы документов — не атрибут, а картинки (отдельный бокс), но в фильтре включаются так же.
  if (scans.count) counts.set(SCANS_FIELD, scans.count);
  const fieldOrder = Object.keys(LEAK_FIELDS);
  const found = [...counts.keys()].sort((a, b) => (fieldOrder.indexOf(a) + 1 || 999) - (fieldOrder.indexOf(b) + 1 || 999));
  const active = new Set([...fields].filter((f) => counts.has(f)));
  const shown = (f: string) => !active.size || active.has(f);
  const toggleField = (f: string) => {
    const next = new Set(active);
    if (next.has(f)) next.delete(f);
    else next.add(f);
    setFields(next);
  };
  // В записи есть что показать: свои значения или найденные вторым шагом.
  const tupleShown = (t: LeakTuple) => fieldOrder.some((f) => shown(f) && t[f as LeakField]?.length) || !!t.step2?.some((x) => shown(x.f));
  const visibleLeaks = leaks.filter((c) => c.tuples?.some(tupleShown));

  const toggle = (key: string, label: string, value: string) => {
    const id = `${key}:${value}`;
    const next = new Map(selected);
    if (next.has(id)) next.delete(id);
    else next.set(id, { key, label, value });
    setSelected(next);
  };

  return (
    <>
      {job.params.via && (
        <div className="font-mono text-xs text-dim">
          {tj('Telegram ID {id} · найден по {via}', { id: <span className="text-mint">{job.params.tgid}</span>, via: tx(job.params.via) })}
        </div>
      )}
      {step2 && (
        <div className="font-mono text-xs text-dim" title={step2Errors(step2)}>
          {t('Второй шаг')}<sup className="text-mint">2</sup>: {tx(step2Summary(step2))}
        </div>
      )}
      <ResultBar
        summary={summary}
        selected={selected.size}
        onAdd={() => setDialog(true)}
        extra={
          editing ? (
            <>
              <Tag tone="warn" className="shrink-0"><Save size={12} /> {t('редактирование')}</Tag>
              <Button
                size="sm"
                onClick={undoLast}
                disabled={!undo.length}
                title={undo.length ? t('Вернуть последнее удалённое (помнится ходов: {n} из {max})', { n: undo.length, max: UNDO_DEPTH }) : t('Отменять нечего: помнятся три последних удаления')}
              >
                <Undo2 size={14} /> {t('Отменить')}{undo.length > 0 && <span className="font-mono text-[11px] text-warn">{undo.length}</span>}
              </Button>
              {graphAllowed && (
                <Button size="sm" onClick={() => setGraph(!graph)} title={graph ? t('Показать значения списком по атрибутам') : t('Показать значения графом связей: что через что найдено')}>
                  {graph ? <><List size={14} /> {tc('вид', 'Список')}</> : <><Network size={14} /> {t('Граф')}</>}
                </Button>
              )}
              {/* Во весь экран и обратно — как в редакторе связей. */}
              {onFullscreen && (fullscreen ? (
                <Button size="sm" onClick={() => onFullscreen(false)} className="!text-mint">
                  <ArrowLeft size={14} /> {t('вернуться к поиску')}
                </Button>
              ) : (
                <Button size="sm" onClick={() => onFullscreen(true)} title={t('Сохранённые данные во весь экран')}>
                  <Expand size={14} /> {t('Во весь экран')}
                </Button>
              ))}
            </>
          ) : me.data?.access.active ? (
            <Button
              size="sm"
              onClick={() => save.mutate({ id: job.id })}
              disabled={save.isPending}
              title={t('Сохранить результат у строки истории и перейти к его редактированию')}
            >
              <Save size={15} className="text-warn" /> {t('Сохранить для редактирования')}
            </Button>
          ) : null
        }
        lead={
          <>
            <Button size="sm" onClick={() => exportAs('pdf')} title={selected.size ? t('Отмеченное — в PDF') : t('Весь результат — в PDF')}>
              <FileText size={15} /> PDF
            </Button>
            <Button size="sm" onClick={() => exportAs('xlsx')} title={selected.size ? t('Отмеченное — в Excel') : t('Весь результат — в Excel')}>
              <FileSpreadsheet size={15} /> Excel
            </Button>
          </>
        }
      />

      {found.length > 0 && !asGraph && (
        <FieldFilter found={found} counts={counts} active={active} onToggle={toggleField} onReset={() => setFields(new Set())} />
      )}

      {!job.deep && shown('geolocs') && counts.has('geolocs') && <FoundGeoMap leaks={leaks} />}

      {scans.count > 0 && shown(SCANS_FIELD) && <ScansBox key={job.id} scans={scans} />}

      {asGraph ? (
        <Suspense fallback={<Empty><Spinner /></Empty>}>
          <DeepGraph
            rows={allRows}
            className="h-[calc(100dvh-6.5rem)] min-h-[420px]"
            onRemove={(list) => {
              const next = new Map(selected);
              for (const r of list) next.delete(`${r.prm}:${r.val}`);
              if (next.size !== selected.size) setSelected(next);
              removeMove({ valIds: list.map((r) => r.val_id) });
            }}
          />
        </Suspense>
      ) : job.deep ? (
        <DeepResult
          rows={rows.filter((r) => shown(r.prm))}
          all={allRows}
          selected={selected}
          onToggle={toggle}
          onPivot={onPivot}
          onRemove={editing ? (r) => {
            unselect(r.prm, r.val);
            removeMove({ valIds: [r.val_id] });
          } : undefined}
        />
      ) : (
        <div className="space-y-4">
          {liveLeaks === 0 && <Empty>{t('Ничего не найдено')}</Empty>}
          {visibleLeaks.map((card) => {
            const i = leaks.indexOf(card);
            const folded = collapsed.has(i);
            // Режим редактирования сохранённых данных: у значения — иконка удаления.
            const remover = (tuple: LeakTuple, f: string, v: string, step2?: boolean) => (editing ? () => {
              unselect(f, v);
              // Место значения и (второй шаг) по чему оно найдено — чтобы отмена вернула его как было.
              const at = step2 ? (tuple.step2 ?? []).findIndex((x) => x.f === f && x.v === v) : (tuple[f as LeakField] ?? []).indexOf(v);
              const by = step2 ? tuple.step2?.[at]?.by : undefined;
              removeMove({ values: [{ leak: i, tuple: tuple.tuple, f, v, at: Math.max(0, at), ...(step2 ? { step2, by } : {}) }] });
            } : undefined);
            return (
              <Card
                key={i}
                editing={editing}
                className={folded ? '[&>header]:mb-0' : undefined}
                title={<>{card.leak} {card.trusted && <ShieldCheck size={13} className="text-mint" />}</>}
                actions={
                  <>
                    <Tag tone="dim">{t('{n} зап.', { n: card.tuples?.filter(tupleLive).length ?? 0 })}</Tag>
                    <button
                      type="button"
                      onClick={() => toggleCollapsed(i)}
                      title={folded ? t('Развернуть') : t('Свернуть')}
                      className="cursor-pointer rounded-md p-1 text-mute transition hover:bg-mint/10 hover:text-mint"
                    >
                      {folded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                    </button>
                  </>
                }
              >
                {/* Записи одной утечки разделены тонкой серой чертой. Две колонки — только когда сам бокс
                    достаточно широк (container query), иначе значения с иконками действий не помещаются. */}
                {!folded && (
                  <div className="@container divide-y divide-text/10">
                    {card.tuples?.filter(tupleShown).map((t) => {
                      const own = (Object.keys(LEAK_FIELDS) as LeakField[]).filter(shown).flatMap((f) =>
                        (t[f] ?? []).map((v) => (
                          <ValueRow key={f + v} field={f} value={v} checked={selected.has(`${f}:${v}`)} onToggle={toggle} onPivot={onPivot} onRemove={remover(t, f, v)} />
                        )),
                      );
                      const extra = (t.step2 ?? []).filter((x) => shown(x.f));
                      return (
                        <div key={t.tuple} className="grid gap-x-6 gap-y-1.5 py-3 first:pt-0 last:pb-0 @4xl:grid-cols-2">
                          {own}
                          {/* Найденное вторым шагом по идентификаторам этой записи — под пунктирной чертой. */}
                          {extra.length > 0 && own.length > 0 && <div className="col-span-full my-1 border-t border-dashed border-text/15" />}
                          {extra.map((x) => (
                            <ValueRow
                              key={`2:${x.f}${x.v}`}
                              field={x.f}
                              value={x.v}
                              by={x.by}
                              checked={selected.has(`${x.f}:${x.v}`)}
                              onToggle={toggle}
                              onPivot={onPivot}
                              onRemove={remover(t, x.f, x.v, true)}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <AttrExportDialog
        format={exportFormat}
        job={job}
        selected={[...selected.keys()]}
        fields={[...active]}
        scans={scans.count}
        open={exportOpen}
        onOpenChange={setExportOpen}
      />
      <AddToDossierDialog
        open={dialog}
        onOpenChange={setDialog}
        values={[...selected.values()]}
        search={{ id: job.id, section: job.section, kind: job.kind, query: job.query, deep: job.deep, summary }}
      />
    </>
  );
}

/** Сколько последних удалений из сохранённых данных можно отменить. */
const UNDO_DEPTH = 3;
/** Один ход удаления: строки глубокого поиска (val_id) или значения простого с местом в записи. */
interface UndoMove {
  valIds?: number[];
  values?: SavedValueRestore[];
}

// React Flow — только когда сохранённый результат глубокого поиска открыли графом.
const DeepGraph = lazy(() => import('./DeepGraph.tsx').then((m) => ({ default: m.DeepGraph })));

// MapLibre тяжёлый — грузится, только когда в результатах есть геолокации.
const GeoPointsMap = lazy(() => import('./GeoPointsMap.tsx').then((m) => ({ default: m.GeoPointsMap })));

/** «широта, долгота» → числа; null — не координаты. */
function latLon(coords: string): { lat: number; lon: number } | null {
  const m = coords.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

/**
 * Бокс с картой найденных геолокаций (простой поиск). Одинаковые точки объединяются, в подписи —
 * утечка и «Прочее» каждой записи. Карта есть, только если раздел геопоиска включён: от него — настройки тайлов.
 */
function FoundGeoMap({ leaks }: { leaks: LeakCard[] }) {
  const geo = trpc.geo.config.useQuery(undefined, { staleTime: Infinity });
  // Выбранная дата геосканирования; null — «Все».
  const [date, setDate] = useState<string | null>(null);
  // Выключенные базы (утечки); пусто — на карте точки всех баз.
  const [off, setOff] = useState<Set<string>>(new Set());
  useEffect(() => {
    setDate(null);
    setOff(new Set());
  }, [leaks]);
  const toggleLeak = (leak: string) => {
    const next = new Set(off);
    if (next.has(leak)) next.delete(leak);
    else next.add(leak);
    setOff(next);
  };

  // Каждая геолокация каждой записи — отдельно: при выборе даты точка и её подпись собираются только из записей этой даты.
  const records = useMemo(() => {
    const out: { key: string; leak: string; lat: number; lon: number; radiusM: number | null; value: string; line: string; date: string | null }[] = [];
    for (const card of leaks) for (const t of card.tuples ?? []) {
      const date = scanDate(t.infos ?? []);
      for (const v of t.geolocs ?? []) {
        const g = parseGeoloc(v);
        const ll = latLon(g.coords);
        if (!ll) continue;
        out.push({ key: `${ll.lat},${ll.lon},${g.radiusM ?? ''}`, leak: card.leak, ...ll, radiusM: g.radiusM, value: attrDisplayValue('geolocs', v), line: [card.leak, ...(t.infos ?? [])].join(' · '), date });
      }
    }
    return out;
  }, [leaks]);

  // Фильтры перекрёстные: счётчики дат — по включённым базам, счётчики баз — по выбранной дате.
  const byLeak = useMemo(() => records.filter((r) => !off.has(r.leak)), [records, off]);
  const byDate = useMemo(() => (date ? records.filter((r) => r.date === date) : records), [records, date]);

  // Даты по возрастанию и сколько точек у каждой.
  const dates = useMemo(() => {
    const n = new Map<string, Set<string>>();
    for (const r of records) if (r.date) n.set(r.date, n.get(r.date) ?? new Set());
    for (const r of byLeak) if (r.date) n.get(r.date)!.add(r.key);
    return [...n].map(([d, keys]) => ({ d, count: keys.size })).sort((x, y) => dateKey(x.d).localeCompare(dateKey(y.d)));
  }, [records, byLeak]);

  // Базы с геолокациями — в порядке карточек результата, у каждой — число точек.
  const bases = useMemo(() => {
    const n = new Map<string, Set<string>>();
    for (const r of records) n.set(r.leak, n.get(r.leak) ?? new Set());
    for (const r of byDate) n.get(r.leak)!.add(r.key);
    return [...n].map(([leak, keys]) => ({ leak, count: keys.size }));
  }, [records, byDate]);

  const points = useMemo(() => {
    const byKey = new Map<string, FoundGeoPoint>();
    for (const r of byLeak) {
      if (date && r.date !== date) continue;
      let p = byKey.get(r.key);
      if (!p) byKey.set(r.key, (p = { lat: r.lat, lon: r.lon, radiusM: r.radiusM, lines: [r.value] }));
      p.lines.push(r.line);
    }
    return [...byKey.values()];
  }, [byLeak, date]);
  const total = useMemo(() => new Set(byLeak.map((r) => r.key)).size, [byLeak]);
  const totalBases = useMemo(() => new Set(byDate.map((r) => r.key)).size, [byDate]);

  if (!geo.data || !records.length) return null;
  return (
    <Card title={t('Геолокации на карте')} actions={<Tag tone="dim">{points.length}</Tag>}>
      {/* isolate — z-index элементов управления карты не выходят за её пределы. */}
      <div className="isolate overflow-hidden rounded-xl border border-line">
        <Suspense fallback={<div className="grid h-[560px] place-items-center"><Spinner className="size-6" /></div>}>
          <GeoPointsMap config={geo.data} points={points} className="ft-map h-[560px] w-full" />
        </Suspense>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[11px] text-dim">{t('Базы:')}</span>
        <button type="button" onClick={() => setOff(new Set())} className={chip(off.size === 0)} title={t('Показать точки всех баз')}>
          {t('Все')} <span className={off.size === 0 ? 'text-mint/70' : 'text-mute'}>{totalBases}</span>
        </button>
        {bases.map(({ leak, count }) => {
          const on = !off.has(leak);
          return (
            <button key={leak} type="button" onClick={() => toggleLeak(leak)} className={chip(on)} title={on ? t('Скрыть точки этой базы') : t('Показать точки этой базы')}>
              {leak} <span className={on ? 'text-mint/70' : 'text-mute'}>{count}</span>
            </button>
          );
        })}
      </div>
      {dates.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[11px] text-dim">{t('Геосканирование:')}</span>
          <button type="button" onClick={() => setDate(null)} className={chip(date === null)}>
            {t('Все')} <span className={date === null ? 'text-mint/70' : 'text-mute'}>{total}</span>
          </button>
          {dates.map(({ d, count }) => (
            <button key={d} type="button" onClick={() => setDate(d)} className={chip(date === d)}>
              {d} <span className={date === d ? 'text-mint/70' : 'text-mute'}>{count}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

/** Дата из примечания «геосканирование от 17.01.2023»; null — нет такого примечания. */
function scanDate(infos: string[]): string | null {
  for (const s of infos) {
    const m = s.match(/геосканирован\S*\s+от\s+(\d{2})\.(\d{2})\.(\d{4})/i);
    if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  }
  return null;
}

/** ДД.ММ.ГГГГ → ГГГГММДД для сортировки. */
const dateKey = (d: string) => d.split('.').reverse().join('');

/** Подпись атрибута на текущем языке (вызывать при отрисовке). */
const fieldLabel = (f: string) => (f === SCANS_FIELD ? t('Сканы документов') : t(LEAK_FIELDS[f as LeakField] ?? f));

/** Кнопка-переключатель (фильтр результата, атрибуты второго шага, базы и даты на карте). */
const chip = (on: boolean) =>
  clsx(
    'inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px] uppercase tracking-wide transition',
    on ? 'border-mint bg-mint/15 text-mint' : 'border-line-soft text-dim hover:border-line hover:text-text',
  );

/** Ошибки поисков второго шага — подсказкой к его итогу. */
function step2Errors(info: Step2Info): string | undefined {
  const failed = info.queries.filter((q) => q.state === 'failed');
  return failed.length ? failed.map((q) => `${q.value}: ${q.error ? tx(q.error) : t('ошибка')}`).join('\n') : undefined;
}

/** По каким найденным атрибутам искать вторым шагом и какие брать из его записей (подпись — fieldLabel(field) при отрисовке). */
const STEP2_BY_OPTIONS = STEP2_SOURCES.map((s) => ({ id: s.kind as string, field: s.field as string }));
const STEP2_FIELD_OPTIONS = STEP2_FIELDS.map((f) => ({ id: f, field: f }));

/** Набор переключателей второго шага: изначально всё включено; «Все» включает или снимает разом. */
function ChipSet({
  title, icon, options, value, onChange, empty,
}: {
  title: string;
  icon: ReactNode;
  options: { id: string; field: string }[];
  value: Set<string>;
  onChange: (v: Set<string>) => void;
  /** Предупреждение, когда ничего не выбрано. */
  empty: string;
}) {
  const all = value.size === options.length;
  const toggle = (id: string) => {
    const next = new Set(value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line-soft bg-bg-soft px-3 py-2.5">
      <span className="mr-1 flex items-center gap-1.5 font-mono text-xs text-dim">
        {icon} {title}
      </span>
      <button type="button" onClick={() => onChange(all ? new Set() : new Set(options.map((o) => o.id)))} className={chip(all)}>
        {t('Все')}
      </button>
      {options.map((o) => (
        <button key={o.id} type="button" onClick={() => toggle(o.id)} className={chip(value.has(o.id))}>
          {fieldLabel(o.field)}
        </button>
      ))}
      {!value.size && <span className="font-mono text-[11px] text-warn">{empty}</span>}
    </div>
  );
}

/** Бокс фильтра: только атрибуты, найденные в результатах; клик включает/выключает атрибут. */
function FieldFilter({
  found, counts, active, onToggle, onReset,
}: {
  found: string[];
  counts: Map<string, number>;
  active: Set<string>;
  onToggle: (f: string) => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2.5">
      <span className="mr-1 flex items-center gap-1.5 font-mono text-xs text-dim">
        <Filter size={13} className="text-mint" /> {t('Атрибуты:')}
      </span>
      {found.map((f) => {
        const on = active.has(f);
        return (
          <button key={f} type="button" onClick={() => onToggle(f)} className={chip(on)}>
            {fieldLabel(f)}
            <span className={on ? 'text-mint/70' : 'text-mute'}>{counts.get(f)}</span>
          </button>
        );
      })}
      {active.size > 0 && (
        <button type="button" onClick={onReset} className="ml-1 cursor-pointer font-mono text-[11px] text-mute hover:text-mint">
          {t('показать все')}
        </button>
      )}
    </div>
  );
}

export function ValueRow({
  field, value, by, checked, onToggle, onPivot, via, onRemove,
}: {
  field: string;
  value: string;
  /** Значение найдено вторым шагом по этим идентификаторам записи: у подписи «²» и «найден по …». */
  by?: readonly string[];
  checked: boolean;
  onToggle: (key: string, label: string, value: string) => void;
  onPivot: (kind: string, value: string) => void;
  via?: string;
  /** Режим редактирования сохранённых данных: у значения есть иконка удаления. */
  onRemove?: () => void;
}) {
  // Русская подпись уходит в досье вместе со значением (хранимые данные), на экране — перевод.
  const label = LEAK_FIELDS[field as LeakField] ?? field;
  const shownLabel = t(label);
  const pivotKind = FIELD_TO_KIND[field as LeakField];
  return (
    <div className="group flex flex-wrap items-center gap-2 rounded-md px-1.5 py-1 hover:bg-mint/5">
      <button
        onClick={() => onToggle(field, label, value)}
        className={clsx('grid size-4 shrink-0 cursor-pointer place-items-center rounded border', checked ? 'border-mint bg-mint text-mint-ink' : 'border-line')}
        title={t('Отметить для досье')}
      >
        {checked && <Check size={11} strokeWidth={3} />}
      </button>
      <span className="w-32 shrink-0 font-mono text-[11px] uppercase tracking-wide text-mute">
        {shownLabel}
        {by && (
          <>
            <sup className="ml-0.5 text-mint" title={t('Найдено дополнительным поиском вторым шагом')}>2</sup>
            <span className="block text-[10px] normal-case tracking-normal text-mute/80">({tx(step2ByText(by))})</span>
          </>
        )}
      </span>
      <span className="min-w-[7rem] flex-1 break-words font-mono text-sm">{field === 'geolocs' ? attrDisplayValue(field, value) : value}</span>
      {via && <span className="hidden truncate font-mono text-[10px] text-mute md:inline">{t('через {via}', { via })}</span>}
      {/* Иконки держатся вместе: в узкой колонке они переносятся под значение, а не ломают его по символам. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {pivotKind && (
          <button
            onClick={() => onPivot(pivotKind, value)}
            className="cursor-pointer text-mute opacity-0 transition hover:text-mint group-hover:opacity-100"
            title={t('Искать по этому значению')}
          >
            <Zap size={14} />
          </button>
        )}
        <ValueActions field={field} value={value} />
        <CopyButton value={attrCopyValue(field, value)} title={t('Скопировать: {label}', { label: shownLabel })} />
        {/* Удаление в два нажатия, как у атрибутов досье; в режиме редактирования корзина видна и без наведения. */}
        {onRemove && <ConfirmDeleteBtn onConfirm={onRemove} title={t('Удалить значение из сохранённых данных')} className="!opacity-100" />}
      </div>
    </div>
  );
}

/** Подпись «найдено через …» под строкой deep-поиска: имя и значение родительского атрибута с копированием. */
function FoundVia({ row, parent }: { row: DeepRow; parent?: DeepRow }) {
  const via = parent?.val ?? '';
  const label = t(LEAK_FIELDS[(parent?.prm ?? row.link4) as LeakField] ?? row.link4);
  return (
    <div className="ml-8 flex min-w-0 flex-wrap items-center gap-x-1.5 font-mono text-[10px] text-mute">
      <CornerDownRight size={10} className="shrink-0" />
      <span className="shrink-0">{t('найдено через {field}', { field: row.link4 })}</span>
      {via && (
        <>
          <span className="break-all text-text/70">{via}</span>
          <CopyButton
            value={attrCopyValue(parent?.prm ?? '', via)}
            title={t('Скопировать: {label}', { label })}
            className="[&>svg]:size-3"
          />
        </>
      )}
    </div>
  );
}

function DeepResult({
  rows, all, selected, onToggle, onPivot, onRemove,
}: {
  rows: DeepRow[];
  /** Все строки ответа — для «найдено через» (родитель может быть скрыт фильтром или удалён). */
  all: DeepRow[];
  /** Режим редактирования сохранённых данных: жёлтые боксы и удаление значений. */
  onRemove?: (row: DeepRow) => void;
  selected: Map<string, PendingValue>;
  onToggle: (key: string, label: string, value: string) => void;
  onPivot: (kind: string, value: string) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, DeepRow[]>();
    for (const r of rows) m.set(r.prm, [...(m.get(r.prm) ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  // link4_id — это val_id родительской строки в том же ответе: по нему достаём значение, через которое найдена эта.
  const byId = useMemo(() => new Map(all.map((r) => [r.val_id, r] as const)), [all]);
  if (!rows.length) return <Empty>{t('Ничего не найдено')}</Empty>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {groups.map(([prm, list]) => (
        <Card key={prm} editing={!!onRemove} title={t(LEAK_FIELDS[prm as LeakField] ?? prm)} actions={<Tag tone="dim">{list.length}</Tag>}>
          {list.map((r) => (
            <div key={r.val_id}>
              <ValueRow
                field={prm}
                value={r.val}
                checked={selected.has(`${prm}:${r.val}`)}
                onToggle={onToggle}
                onPivot={onPivot}
                onRemove={onRemove && (() => onRemove(r))}
              />
              {r.link4_id > 0 && <FoundVia row={r} parent={byId.get(r.link4_id)} />}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

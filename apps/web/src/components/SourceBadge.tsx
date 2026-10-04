import clsx from 'clsx';
import { CREDIBILITY_LABELS, RELIABILITY_LABELS, type Source } from '@ft/shared';
import { fmtDate } from '../lib/format.ts';

const KIND_LABELS: Record<Source['kind'], string> = {
  search: 'поиск',
  url: 'веб',
  manual: 'вручную',
  humint: 'HUMINT',
  document: 'документ',
};

/** Код оценки по системе Адмиралтейства: надёжность источника (A–F) + достоверность (1–6). */
export function SourceBadge({ source, className }: { source: Source | undefined; className?: string }) {
  if (!source) return null;
  const good = 'AB'.includes(source.reliability) && '12'.includes(source.credibility);
  const bad = 'DE'.includes(source.reliability) || '45'.includes(source.credibility);
  const title = [
    `Источник: ${KIND_LABELS[source.kind]}${source.ref ? ` — ${source.ref}` : ''}`,
    `${source.reliability}: ${RELIABILITY_LABELS[source.reliability]}`,
    `${source.credibility}: ${CREDIBILITY_LABELS[source.credibility]}`,
    `Получено: ${fmtDate(source.capturedAt)}`,
    source.note,
  ].filter(Boolean).join('\n');
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex shrink-0 cursor-help items-center gap-1 rounded border px-1.5 font-mono text-[10px] leading-4',
        good ? 'border-mint/40 text-mint' : bad ? 'border-danger/40 text-danger' : 'border-warn/40 text-warn',
        className,
      )}
    >
      {source.reliability}{source.credibility}
      <span className="text-mute">{KIND_LABELS[source.kind]}</span>
    </span>
  );
}

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Check, CornerDownRight, ExternalLink, MessagesSquare, Search as SearchIcon, User } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { WEEK_DAYS, type TgComment, type TgGroup, type TgMonthActivity, type TgUserMsgs, type TgWeekActivity } from '@ft/shared';
import { Card, Empty, Segmented, Tag } from '../../components/ui.tsx';
import { fmtDate } from '../../lib/format.ts';

// Отрисовка ответов /tgcmnts/v1/*: комментарии одного пользователя, многих, счётчики активности.

/** Ключ комментария: msg_id уникален только внутри группы. */
export const ckey = (c: TgComment) => `${c.grp_id}:${c.msg_id}`;

/** Комментарий как Markdown-цитата для заметки досье. */
export function commentToMarkdown(c: TgComment, group: TgGroup | undefined): string {
  const head = c.r2text ? `> ↪ *${c.r2text}*\n>\n` : '';
  return `${head}> ${c.text}\n\n— [${group?.name ?? 'Telegram'}](${c.url}), ${fmtDate(c.dt, true)}`;
}

export function CommentList({
  comments, groups, selected, onToggle,
}: {
  comments: TgComment[];
  groups: TgGroup[];
  selected: Set<string>;
  onToggle: (c: TgComment) => void;
}) {
  const byId = useMemo(() => new Map(groups.map((g) => [g.grp_id, g])), [groups]);
  const [group, setGroup] = useState<number | null>(null);
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of comments) m.set(c.grp_id, (m.get(c.grp_id) ?? 0) + 1);
    return m;
  }, [comments]);
  const shown = group ? comments.filter((c) => c.grp_id === group) : comments;

  if (!comments.length) return <Empty>Комментариев не найдено</Empty>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setGroup(null)} className={clsx('cursor-pointer rounded-md px-2 py-1 font-mono text-xs', !group ? 'bg-mint/15 text-mint' : 'text-dim hover:text-mint')}>
          все · {comments.length}
        </button>
        {[...counts].map(([gid, n]) => (
          <button key={gid} onClick={() => setGroup(gid)} className={clsx('cursor-pointer rounded-md px-2 py-1 font-mono text-xs', group === gid ? 'bg-mint/15 text-mint' : 'text-dim hover:text-mint')}>
            {byId.get(gid)?.name ?? gid} · {n}
          </button>
        ))}
      </div>
      {shown.map((c) => {
        const g = byId.get(c.grp_id);
        const on = selected.has(ckey(c));
        return (
          <article key={ckey(c)} className={clsx('group flex gap-3 rounded-xl border p-3 transition', on ? 'border-mint/50 bg-mint/5' : 'border-line-soft hover:border-line')}>
            <button
              onClick={() => onToggle(c)}
              title="Отметить для досье"
              className={clsx('mt-0.5 grid size-4 shrink-0 cursor-pointer place-items-center rounded border', on ? 'border-mint bg-mint text-mint-ink' : 'border-line')}
            >
              {on && <Check size={11} strokeWidth={3} />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex flex-wrap items-center gap-2 font-mono text-[11px] text-mute">
                <Tag tone="info">{g?.name ?? `группа ${c.grp_id}`}</Tag>
                <span>{fmtDate(c.dt, true)}</span>
                {c.likes?.map((l, i) => <span key={i} title={`реакция ${fmtDate(l.at, true)}`}>{l.emoji}</span>)}
                <a href={c.url} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-1 hover:text-mint">
                  #{c.msg_id} <ExternalLink size={11} />
                </a>
              </div>
              {c.r2text && (
                <div className="mb-1 flex gap-1.5 border-l-2 border-line pl-2 text-xs text-mute">
                  <CornerDownRight size={12} className="mt-0.5 shrink-0" /> <span className="line-clamp-2">{c.r2text}</span>
                </div>
              )}
              <div className="whitespace-pre-wrap text-sm">{c.text}</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function MultiUserList({
  users, selected, onToggle, onUserComments, picked, onPickUser,
}: {
  users: TgUserMsgs[];
  selected: Set<string>;
  onToggle: (c: TgComment, groups: TgGroup[]) => void;
  onUserComments: (tgid: string) => void;
  picked: Set<string>;
  onPickUser: (tgid: string, label: string) => void;
}) {
  if (!users.length) return <Empty>Ничего не найдено</Empty>;
  return (
    <div className="space-y-4">
      {users.map((u, i) => {
        const id = String(u.user?.id ?? '');
        const name = u.user?.names?.[0];
        const nik = u.user?.niks?.[0];
        return (
          <Card
            key={id || i}
            title={<><User size={13} /> {name ?? (nik ? `@${nik}` : id)}</>}
            actions={
              <>
                <Tag tone="dim">ID {id}</Tag>
                {nik && <Tag tone="dim">@{nik}</Tag>}
                <button
                  onClick={() => onPickUser(id, name ?? nik ?? id)}
                  title="Отметить Telegram ID для досье"
                  className={clsx('grid size-6 cursor-pointer place-items-center rounded border', picked.has(id) ? 'border-mint bg-mint text-mint-ink' : 'border-line text-mute hover:text-mint')}
                >
                  <Check size={12} />
                </button>
                <button onClick={() => onUserComments(id)} title="Все комментарии пользователя" className="cursor-pointer text-mute hover:text-mint">
                  <MessagesSquare size={15} />
                </button>
                <Link to="/search" search={{ kind: 'tgid', q: id }} title="Поиск по атрибутам" className="text-mute hover:text-mint">
                  <SearchIcon size={15} />
                </Link>
              </>
            }
          >
            <CommentList comments={u.comments ?? []} groups={u.groups ?? []} selected={selected} onToggle={(c) => onToggle(c, u.groups ?? [])} />
          </Card>
        );
      })}
    </div>
  );
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const heat = (v: number, max: number) => (max ? `rgba(46,224,172,${0.06 + (v / max) * 0.84})` : 'transparent');

export function MonthActivity({ years }: { years: TgMonthActivity }) {
  const ys = Object.keys(years).sort();
  const max = Math.max(0, ...ys.flatMap((y) => Object.values(years[y] ?? {})));
  if (!ys.length) return <Empty>Активности нет</Empty>;
  return (
    <Card title="Комментарии по месяцам">
      <div className="overflow-auto">
        <table className="w-full border-separate border-spacing-1 font-mono text-xs">
          <thead>
            <tr>
              <th />
              {MONTHS.map((m) => <th key={m} className="font-normal text-mute">{m}</th>)}
              <th className="font-normal text-mute">всего</th>
            </tr>
          </thead>
          <tbody>
            {ys.map((y) => {
              const row = years[y] ?? {};
              const total = Object.values(row).reduce((a, b) => a + b, 0);
              return (
                <tr key={y}>
                  <td className="pr-2 text-dim">{y}</td>
                  {MONTHS.map((_, i) => {
                    const v = row[String(i + 1)] ?? 0;
                    return (
                      <td key={i} title={`${MONTHS[i]} ${y}: ${v}`} className="h-9 min-w-10 rounded text-center" style={{ background: heat(v, max), color: v > max * 0.55 ? '#001a13' : undefined }}>
                        {v || ''}
                      </td>
                    );
                  })}
                  <td className="pl-2 text-right text-mint">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function WeekActivity({ years }: { years: TgWeekActivity }) {
  const ys = Object.keys(years).sort();
  const [year, setYear] = useState<string>('all');
  const grid = useMemo(() => {
    const pick = year === 'all' ? ys : [year];
    return WEEK_DAYS.map((d) => Array.from({ length: 24 }, (_, h) => pick.reduce((sum, y) => sum + (years[y]?.[d]?.[h] ?? 0), 0)));
  }, [years, year, ys]);
  const max = Math.max(0, ...grid.flat());
  const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((s, row) => s + row[h]!, 0));
  // Самое тихое окно из 6 часов подряд (с переходом через полночь) — оценка времени сна.
  const quiet = byHour
    .map((_, start) => ({ start, sum: Array.from({ length: 6 }, (_, k) => byHour[(start + k) % 24]!).reduce((a, b) => a + b, 0) }))
    .reduce((best, w) => (w.sum < best.sum ? w : best)).start;
  if (!ys.length) return <Empty>Активности нет</Empty>;
  return (
    <Card
      title="Активность по дням недели и часам"
      actions={<Segmented value={year} onChange={setYear} options={[{ value: 'all', label: 'все' }, ...ys.map((y) => ({ value: y, label: y }))]} />}
    >
      <div className="overflow-auto">
        <table className="border-separate border-spacing-[3px] font-mono text-[10px]">
          <thead>
            <tr>
              <th />
              {Array.from({ length: 24 }, (_, h) => <th key={h} className="w-7 font-normal text-mute">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.map((row, di) => (
              <tr key={di}>
                <td className="pr-2 text-dim">{DAYS_RU[di]}</td>
                {row.map((v, h) => (
                  <td key={h} title={`${DAYS_RU[di]} ${h}:00 — ${v}`} className="size-7 rounded-sm" style={{ background: heat(v, max) }} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 font-mono text-[11px] text-mute">
        Самые тихие часы: {quiet}:00–{(quiet + 6) % 24}:00. Ночной провал подсказывает часовой пояс и режим сна пользователя.
      </p>
    </Card>
  );
}

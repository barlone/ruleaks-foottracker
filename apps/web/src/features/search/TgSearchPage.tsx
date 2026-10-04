import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import clsx from 'clsx';
import { AtSign, Send, UserRound } from 'lucide-react';
import {
  TG_MODES, findTgMode, parseTgUser,
  type TgComment, type TgGroup, type TgModeId, type TgMonthActivity, type TgUserMsgs, type TgWeekActivity,
} from '@ft/shared';
import { Button, Card, Empty, Input, Spinner, Tag } from '../../components/ui.tsx';
import { trpc, type RouterOutputs } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { tgSearchRoute } from '../../router.tsx';
import { AddToDossierDialog, type PendingNote, type PendingValue } from './AddToDossierDialog.tsx';
import { JobStatus, ResultBar, SearchLayout, useRunOnMount, useSearchJob } from './common.tsx';
import { CommentList, MonthActivity, MultiUserList, WeekActivity, ckey, commentToMarkdown } from './TgResults.tsx';

type Job = RouterOutputs['search']['job'];

/** «Поиск в Telegram» — /tgsearch бота. */
export function TgSearchPage() {
  const params = tgSearchRoute.useSearch();
  const navigate = useNavigate({ from: '/search/telegram' });
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<TgModeId>((params.mode as TgModeId) ?? 'comments');
  const [value, setValue] = useState(params.q ?? '');
  const [jobId, setJobId] = useState<string | null>(null);
  const info = findTgMode(mode)!;

  const start = trpc.search.start.useMutation({
    onSuccess: (j) => {
      setJobId(j.id);
      void utils.search.recent.invalidate({ section: 'tg' });
    },
  });
  const job = useSearchJob(jobId);

  function run(m: TgModeId = mode, v = value) {
    if (!v.trim()) return;
    setMode(m);
    setValue(v);
    void navigate({ search: { mode: m, q: v } });
    start.mutate({ section: 'tg', mode: m, value: v.trim() });
  }

  useRunOnMount(() => run(params.mode as TgModeId, params.q!), !!(params.q && params.mode && me.data?.access.active));

  const who = info.input === 'user' && value.trim() ? parseTgUser(value) : null;
  const disabled = !me.data?.access.active;

  return (
    <SearchLayout
      section="tg"
      title="Поиск в Telegram"
      subtitle="Комментарии, реакции, ответы и активность пользователя в открытых группах и каналах."
      activeId={jobId}
      onOpen={setJobId}
    >
      <Card className="animate-fade-up">
        <div className="mb-4 flex flex-wrap gap-1.5">
          {TG_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={clsx(
                'cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition',
                mode === m.id ? 'border-mint/60 bg-mint/10 font-semibold text-mint' : 'border-line-soft text-dim hover:border-line hover:text-text',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          <div className="flex gap-3 max-md:flex-col">
            <div className="relative flex-1">
              {info.input === 'user' ? (
                <UserRound size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mint/70" />
              ) : (
                <Send size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mint/70" />
              )}
              <Input
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={info.input === 'user' ? '1143789744 · @nickname · +7 916 123-45-67' : '(орлан | о-30 | о-10) & краснополь'}
                className="h-12 pl-10 font-mono text-base"
                disabled={disabled}
              />
            </div>
            <Button type="submit" variant="primary" className="h-12 px-6" disabled={disabled || !value.trim() || start.isPending || (info.input === 'user' && !who)}>
              {start.isPending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : 'Искать'}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-dim">
            <span>{info.hint}</span>
            {info.input === 'user' && value.trim() && (
              who ? (
                <Tag>{who.kind === 'tgid' ? 'Telegram ID' : who.kind === 'nik' ? <><AtSign size={11} />ник → ID</> : 'телефон → ID'}</Tag>
              ) : (
                <Tag tone="warn">нужен Telegram ID, @ник или телефон</Tag>
              )
            )}
            {start.error && <Tag tone="danger">{errorText(start.error)}</Tag>}
          </div>
        </form>
      </Card>

      {jobId ? (
        <TgJobView job={job.data} loading={job.isLoading} onRun={run} />
      ) : (
        <Empty>
          Пользователя можно указать по ID, @нику или телефону — ник и телефон сервер
          <br />
          переведёт в Telegram ID так же, как это делает бот.
        </Empty>
      )}
    </SearchLayout>
  );
}

function TgJobView({ job, loading, onRun }: { job: Job | undefined; loading: boolean; onRun: (m: TgModeId, v: string) => void }) {
  const [notes, setNotes] = useState<Map<string, PendingNote>>(new Map());
  const [users, setUsers] = useState<Map<string, string>>(new Map());
  const [dialog, setDialog] = useState(false);
  useEffect(() => {
    setNotes(new Map());
    setUsers(new Map());
  }, [job?.id]);

  if (job?.state === 'choose') {
    return (
      <Card title="Ник принадлежит нескольким пользователям">
        <p className="mb-3 text-sm text-dim">Выберите Telegram ID для запроса «{job.query}»:</p>
        <div className="flex flex-wrap gap-2">
          {job.candidates?.map((id) => (
            <Button key={id} onClick={() => onRun(job.kind as TgModeId, id)}>{id}</Button>
          ))}
        </div>
      </Card>
    );
  }
  const status = <JobStatus job={job} loading={loading} />;
  if (!job || job.state !== 'done') return status;

  const mode = findTgMode(job.kind)!;
  const res = (job.result as { job?: Record<string, unknown> } | null)?.job ?? {};

  const toggleComment = (c: TgComment, groups: TgGroup[]) => {
    const next = new Map(notes);
    if (next.has(ckey(c))) next.delete(ckey(c));
    else next.set(ckey(c), { markdown: commentToMarkdown(c, groups.find((g) => g.grp_id === c.grp_id)), url: c.url });
    setNotes(next);
  };
  const pickUser = (id: string, label: string) => {
    const next = new Map(users);
    if (next.has(id)) next.delete(id);
    else next.set(id, label);
    setUsers(next);
  };

  // В досье: найденный Telegram ID пользователя (если запрос был по нему) + отмеченные ID + цитаты.
  const values: PendingValue[] = [
    ...(job.params.tgid ? [{ key: 'tgids', label: 'Telegram ID', value: job.params.tgid }] : []),
    ...[...users.keys()].map((id) => ({ key: 'tgids', label: 'Telegram ID', value: id })),
  ];

  let body;
  let summary = '';
  if (mode.result === 'comments') {
    const comments = (res.comments as TgComment[] | undefined) ?? [];
    summary = `${comments.length} сообщ.${res.truncated ? ' (не все)' : ''}`;
    body = <CommentList comments={comments} groups={(res.groups as TgGroup[] | undefined) ?? []} selected={new Set(notes.keys())} onToggle={(c) => toggleComment(c, (res.groups as TgGroup[]) ?? [])} />;
  } else if (mode.result === 'multi') {
    const list = (res.users as TgUserMsgs[] | undefined) ?? [];
    summary = `${list.length} польз., ${list.reduce((s, u) => s + (u.comments?.length ?? 0), 0)} сообщ.`;
    body = (
      <MultiUserList
        users={list}
        selected={new Set(notes.keys())}
        onToggle={toggleComment}
        onUserComments={(id) => onRun('comments', id)}
        picked={new Set(users.keys())}
        onPickUser={pickUser}
      />
    );
  } else if (mode.result === 'month') {
    summary = 'активность по месяцам';
    body = <MonthActivity years={(res.years as TgMonthActivity | undefined) ?? {}} />;
  } else {
    summary = 'активность по часам';
    body = <WeekActivity years={(res.years as TgWeekActivity | undefined) ?? {}} />;
  }

  return (
    <>
      {job.params.tgid && (
        <div className="font-mono text-xs text-dim">
          Пользователь: <span className="text-mint">ID {job.params.tgid}</span>
          {job.params.via && job.params.via !== 'id' && <> · найден по {job.params.via}</>}
        </div>
      )}
      <ResultBar summary={summary} selected={notes.size + users.size} onAdd={() => setDialog(true)} />
      {body}
      <AddToDossierDialog
        open={dialog}
        onOpenChange={setDialog}
        values={values}
        notes={[...notes.values()]}
        search={{ id: job.id, section: 'tg', kind: job.kind, query: job.query, deep: false, summary }}
      />
    </>
  );
}

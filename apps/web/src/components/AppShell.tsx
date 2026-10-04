import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import clsx from 'clsx';
import { Asterisk, FolderSearch, LogOut, Network, RefreshCw, Search, Send, ShieldAlert } from 'lucide-react';
import { trpc } from '../lib/trpc.ts';
import { toasts } from '../lib/toast.ts';
import { useStore } from '../lib/store.ts';
import { fmtDate } from '../lib/format.ts';
import { LoginPage } from './LoginPage.tsx';
import { Button, Spinner } from './ui.tsx';

const NAV = [
  { to: '/search', label: 'Поиск по атрибутам', icon: Search, hint: 'телефон · фио · документы' },
  { to: '/search/telegram', label: 'Поиск в Telegram', icon: Send, hint: 'комментарии · активность' },
  { to: '/search/fuzzy', label: 'Нечёткий поиск', icon: Asterisk, hint: 'маски email и номеров' },
  { to: '/dossiers', label: 'Досье', icon: FolderSearch, hint: 'личности и группы' },
  { to: '/investigations', label: 'Расследования', icon: Network, hint: 'связи · факты · гипотезы' },
] as const;

export function Root() {
  const me = trpc.auth.me.useQuery();
  const path = useRouterState({ select: (s) => s.location.pathname });

  if (me.isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  // Без сессии доступны только публичные расследования.
  if (!me.data) {
    if (/^\/investigations\/[^/]+$/.test(path)) {
      return (
        <div className="bg-grid flex h-full flex-col">
          <TopBar />
          <main className="relative z-10 min-h-0 flex-1">
            <Outlet />
          </main>
          <Toaster />
        </div>
      );
    }
    return <LoginPage />;
  }

  return (
    <div className="bg-grid flex h-full">
      <Sidebar />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <SubscriptionBanner />
        <main className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/search" className="flex items-center gap-3">
      <img src="/logo.png" alt="" className="size-9 drop-shadow-[0_0_14px_rgba(46,224,172,0.35)]" />
      {!compact && (
        <div className="leading-tight">
          <div className="font-extrabold tracking-tight">
            RuLeaks<span className="text-mint">.Следопыт</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-mint/80">humint workbench</div>
        </div>
      )}
    </Link>
  );
}

function TopBar() {
  return (
    <header className="relative z-10 flex h-14 items-center justify-between border-b border-line px-5">
      <Brand />
      <Link to="/search">
        <Button variant="primary" size="sm">Войти через Telegram</Button>
      </Link>
    </header>
  );
}

function Sidebar() {
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.invalidate() });
  const user = me.data!;

  return (
    <aside className="relative z-10 flex w-64 shrink-0 flex-col border-r border-line bg-panel/80 backdrop-blur max-lg:w-16">
      <div className="flex h-16 items-center border-b border-line px-4 max-lg:justify-center max-lg:px-0">
        <div className="max-lg:hidden"><Brand /></div>
        <div className="lg:hidden"><Brand compact /></div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {NAV.map(({ to, label, icon: Icon, hint }) => (
          <Link
            key={to}
            to={to}
            className="group flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-dim transition hover:bg-mint/5 hover:text-text max-lg:justify-center"
            activeOptions={{ exact: true, includeSearch: false }}
            activeProps={{ className: '!border-line !bg-mint/10 !text-mint' }}
          >
            <Icon size={18} className="shrink-0" />
            <span className="max-lg:hidden">
              <span className="block text-sm font-semibold">{label}</span>
              <span className="block font-mono text-[10px] uppercase tracking-wider text-mute group-hover:text-dim">{hint}</span>
            </span>
          </Link>
        ))}
      </nav>
      <div className="border-t border-line p-3 max-lg:hidden">
        <div className="mb-2 flex items-center gap-2.5">
          <div className="grid size-8 place-items-center rounded-full border border-line bg-mint/10 font-mono text-sm text-mint">
            {user.displayName.slice(0, 1)}
          </div>
          <div className="min-w-0 text-sm">
            <div className="truncate font-semibold">{user.displayName}</div>
            <div className="truncate font-mono text-[11px] text-mute">@{user.username ?? user.tgId}</div>
          </div>
        </div>
        <div className={clsx('mb-2 rounded-md border px-2 py-1 font-mono text-[11px]', user.access.active ? 'border-line text-mint' : 'border-warn/30 text-warn')}>
          {user.access.active
            ? user.access.unlimited ? '● безлимитный доступ' : `● подписка до ${fmtDate(user.access.until)}`
            : '○ подписка неактивна'}
        </div>
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => logout.mutate()}>
          <LogOut size={14} /> Выйти
        </Button>
      </div>
    </aside>
  );
}

function SubscriptionBanner() {
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const refresh = trpc.auth.refreshAccess.useMutation({ onSuccess: () => utils.auth.me.invalidate() });
  if (!me.data || me.data.access.active) return null;
  return (
    <div className="flex items-center gap-3 border-b border-warn/30 bg-warn/10 px-5 py-2.5 text-sm text-warn">
      <ShieldAlert size={16} />
      <span className="flex-1">
        {me.data.access.reason ?? 'Подписка неактивна'}. Режим только для чтения: поиск и правки недоступны.
      </span>
      <a href="https://t.me/ruleaks_bot?start=subscribe" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">
        Продлить в боте
      </a>
      <Button variant="ghost" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending} title="Проверить снова">
        <RefreshCw size={14} className={refresh.isPending ? 'animate-spin' : ''} />
      </Button>
    </div>
  );
}

function Toaster() {
  const list = useStore(toasts);
  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {list.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'animate-fade-up max-w-sm rounded-lg border bg-panel px-4 py-3 font-mono text-xs shadow-glow-sm',
            t.tone === 'ok' ? 'border-line text-mint' : 'border-danger/40 text-danger',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

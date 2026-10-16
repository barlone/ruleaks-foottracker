import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import clsx from 'clsx';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowUp, Asterisk, FolderSearch, LogOut, MapPin, Network, RefreshCw, Search, Send, ShieldAlert, UserSearch } from 'lucide-react';
import { trpc } from '../lib/trpc.ts';
import { toasts } from '../lib/toast.ts';
import { useStore } from '../lib/store.ts';
import { fmtDate } from '../lib/format.ts';
import { LoginPage } from './LoginPage.tsx';
import { Button, Spinner } from './ui.tsx';

// feature — раздел есть только если включён в config.ini (geo — [config] geo-search, pages — [config] pages-search).
const NAV = [
  { to: '/search', label: 'Поиск по атрибутам', icon: Search, hint: 'телефон · фио · документы' },
  { to: '/search/telegram', label: 'Поиск в Telegram', icon: Send, hint: 'комментарии · активность' },
  { to: '/search/geo', label: 'Поиск по геоданным', icon: MapPin, hint: 'точка · радиус', feature: 'geo' },
  { to: '/search/pages', label: 'Поиск личных страниц', icon: UserSearch, hint: 'ник · соцсети · сайты', feature: 'pages' },
  { to: '/search/fuzzy', label: 'Нечёткий поиск', icon: Asterisk, hint: 'маски email и номеров' },
  { to: '/dossiers', label: 'Досье', icon: FolderSearch, hint: 'личности и группы' },
  { to: '/investigations', label: 'Расследования', icon: Network, hint: 'связи · факты · гипотезы' },
] as const;

export function Root() {
  const me = trpc.auth.me.useQuery();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const mainRef = useRef<HTMLElement>(null);

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
        <main ref={mainRef} className="min-h-0 flex-1 overflow-auto">
          <Outlet />
        </main>
        {/* key — после перехода на другую страницу заново следим за её содержимым. */}
        <ScrollTopButton key={path} target={mainRef} />
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
  const mode = trpc.auth.mode.useQuery();
  return (
    <header className="relative z-10 flex h-14 items-center justify-between border-b border-line px-5">
      <Brand />
      <Link to="/search">
        <Button variant="primary" size="sm">{mode.data === 'bot-db' ? 'Войти через Telegram' : 'Войти'}</Button>
      </Link>
    </header>
  );
}

function Sidebar() {
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.invalidate() });
  // Без бота (auth = none | password-sha256) пользователь один и подписки нет.
  const mode = trpc.auth.mode.useQuery();
  const solo = mode.data !== undefined && mode.data !== 'bot-db';
  // Разделы, которые включаются в config.ini: пункт меню есть, только пока сервер отвечает не null.
  const geo = trpc.geo.config.useQuery(undefined, { staleTime: Infinity });
  const pages = trpc.pages.config.useQuery(undefined, { staleTime: Infinity });
  const features = { geo: !!geo.data, pages: !!pages.data };
  const nav = NAV.filter((n) => !('feature' in n) || features[n.feature]);
  const user = me.data!;

  return (
    <aside className="relative z-10 flex w-64 shrink-0 flex-col border-r border-line bg-panel/80 backdrop-blur max-lg:w-16">
      <div className="flex h-16 items-center border-b border-line px-4 max-lg:justify-center max-lg:px-0">
        <div className="max-lg:hidden"><Brand /></div>
        <div className="lg:hidden"><Brand compact /></div>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {nav.map(({ to, label, icon: Icon, hint }) => (
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
            <div className="truncate font-mono text-[11px] text-mute">{user.username ? `@${user.username}` : `ID ${user.tgId}`}</div>
          </div>
        </div>
        <div className={clsx('mb-2 rounded-md border px-2 py-1 font-mono text-[11px]', user.access.active ? 'border-line text-mint' : 'border-warn/30 text-warn')}>
          {solo
            ? '● персональный режим'
            : user.access.active
            ? user.access.unlimited ? '● безлимитный доступ' : `● подписка до ${fmtDate(user.access.until)}`
            : '○ подписка неактивна'}
        </div>
        {mode.data !== 'none' && (
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => logout.mutate()}>
            <LogOut size={14} /> Выйти
          </Button>
        )}
      </div>
    </aside>
  );
}

function SubscriptionBanner() {
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const refresh = trpc.auth.refreshAccess.useMutation({ onSuccess: () => utils.auth.me.invalidate() });
  // Бот — из настроек сервера ([telegram] bot-username), а не зашитый в интерфейс.
  const bot = trpc.auth.botUsername.useQuery(undefined, { staleTime: Infinity });
  if (!me.data || me.data.access.active) return null;
  return (
    <div className="flex items-center gap-3 border-b border-warn/30 bg-warn/10 px-5 py-2.5 text-sm text-warn">
      <ShieldAlert size={16} />
      <span className="flex-1">
        {me.data.access.reason ?? 'Подписка неактивна'}. Режим только для чтения: поиск и правки недоступны.
      </span>
      {bot.data && (
        <a href={`https://t.me/${bot.data}?start=subscribe`} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">
          Продлить в боте
        </a>
      )}
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

/**
 * Прокрутка страницы в начало — как в HTML-отчётах бота. Видна, только когда есть куда прокручивать вверх.
 * Прокручивается не окно, а <main>; кнопка — в правом нижнем углу (вверху справа при прокрутке
 * стоит закреплённая строка результатов поиска с «Снимком в досье»).
 */
function ScrollTopButton({ target }: { target: RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = target.current;
    if (!el) return;
    const update = () => setVisible(el.scrollTop > 1);
    update();
    el.addEventListener('scroll', update, { passive: true });
    // Содержимое меняется (переход на другую страницу, подгрузка результатов) — позиция тоже.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [target]);
  if (!visible) return null;
  // Обёртка держит позицию: у основной кнопки .btn-sheen задаёт position: relative (styles.css) и перебил бы absolute.
  return (
    <div className="absolute bottom-[18px] right-6 z-30">
      <Button
        variant="primary"
        size="sm"
        onClick={() => target.current?.scrollTo({ top: 0, behavior: 'smooth' })}
        title="Прокрутить в начало"
        aria-label="Прокрутить в начало"
        // p-0! — базовый px-3 кнопки size="sm" иначе сжимает значок до 8 px.
        className="size-8 p-0!"
      >
        <ArrowUp size={16} className="shrink-0" />
      </Button>
    </div>
  );
}

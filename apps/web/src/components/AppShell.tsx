import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import clsx from 'clsx';
import { Fragment, useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowUp, Asterisk, FolderSearch, LogOut, Mail, MapPin, Moon, Network, PanelLeftClose, PanelLeftOpen, RefreshCw, ScanSearch, Search, Send, ShieldAlert, Sun, UserSearch } from 'lucide-react';
import type { Lang, Theme } from '@ft/shared';
import { trpc } from '../lib/trpc.ts';
import { toasts } from '../lib/toast.ts';
import { create, useStore } from '../lib/store.ts';
import { fmtDate } from '../lib/format.ts';
import { useUserSettings } from '../lib/settings.ts';
import { applyTheme } from '../lib/theme.ts';
import { isLangReady, LANGS, loadLang, setLang, storedLang, t, tx } from '../lib/i18n.ts';
import { LoginPage } from './LoginPage.tsx';
import { Button, Dialog, Field, Segmented, Spinner } from './ui.tsx';

// feature — раздел есть только если включён в config.ini (geo — [config] geo-search, pages — [config] pages-search,
// email — [config] email-search, google — [config] google-search).
const NAV = [
  { to: '/search', label: 'Поиск по атрибутам', icon: Search, hint: 'телефон · фио · документы' },
  { to: '/search/telegram', label: 'Поиск в Telegram', icon: Send, hint: 'комментарии · активность' },
  { to: '/search/pages', label: 'Поиск личных страниц', icon: UserSearch, hint: 'ник · соцсети · сайты', feature: 'pages' },
  { to: '/search/geo', label: 'Поиск по геоданным', icon: MapPin, hint: 'точка · радиус', feature: 'geo' },
  { to: '/search/google', label: 'Поиск по Google', icon: ScanSearch, hint: 'gaia id · drive · wi-fi', feature: 'google' },
  { to: '/search/fuzzy', label: 'Нечёткий поиск', icon: Asterisk, hint: 'маски email и номеров' },
  // divider — линия-разделитель над пунктом (как граница шапки над первым): поиски, исследование адреса и рабочие
  // объекты — три группы. Если раздел Email выключен, остаётся одна линия — над «Досье».
  { to: '/search/email', label: 'Исследовать Email', icon: Mail, hint: 'аккаунты · утечки · домен', feature: 'email', divider: true },
  { to: '/dossiers', label: 'Досье', icon: FolderSearch, hint: 'личности и группы', divider: true },
  { to: '/investigations', label: 'Расследования', icon: Network, hint: 'связи · факты · гипотезы' },
] as const;

/**
 * Язык интерфейса — из настроек пользователя, без сессии — последний в этом браузере (lib/i18n.ts).
 * Смена языка перемонтирует всё дерево (key): перерисовываются и мемоизированные части, и подписи, посчитанные
 * один раз при монтировании. Словарь грузится отдельным чанком; пока он не пришёл — заставка, а не русский текст,
 * который тут же сменится.
 */
export function Root() {
  const me = trpc.auth.me.useQuery();
  const wanted: Lang = me.data?.settings.lang ?? storedLang();
  // Словарь не загрузился (сеть) — остаётся русский; новая попытка — после перезагрузки страницы.
  const [failed, setFailed] = useState<Lang | null>(null);
  const lang: Lang = failed === wanted ? 'ru' : wanted;
  const ready = isLangReady(lang);
  const [, setLoaded] = useState(0);
  useEffect(() => {
    if (!ready) loadLang(lang).then(() => setLoaded((n) => n + 1), () => setFailed(lang));
  }, [lang, ready]);
  // До отрисовки дочерних: они уже читают новый язык.
  if (ready) setLang(lang);
  useEffect(() => {
    document.title = 'd.s. Stalker';
  }, [lang, ready]);

  if (!ready) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  return <Shell key={lang} />;
}

function Shell() {
  const me = trpc.auth.me.useQuery();
  const path = useRouterState({ select: (s) => s.location.pathname });
  // Во весь экран (?full): редактор связей на странице расследования и сохранённые данные поиска по атрибутам /
  // геоданным — боковое меню и полосы над страницей убраны.
  const full = useRouterState({
    select: (s) => /^\/(investigations\/[^/]+|search|search\/geo)$/.test(s.location.pathname) && (s.location.search as { full?: unknown }).full === true,
  });
  const mainRef = useRef<HTMLElement>(null);

  // Без сессии тема не меняется: страница входа открывается в той, что была у последнего пользователя этого браузера.
  const theme = me.data?.settings.theme;
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  if (me.isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6" />
      </div>
    );
  }

  // Без сессии доступны только публичные расследования и страница входа по ссылке из бота.
  if (!me.data) {
    if (path === '/login') return <Outlet />;
    if (/^\/investigations\/[^/]+$/.test(path)) {
      return (
        <div className="bg-grid flex h-full flex-col">
          {!full && <TopBar />}
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
      {!full && <Sidebar />}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {!full && <SubscriptionBanner />}
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

// Размеры надписей подобраны: название той же ширины, что подпись, а обе строки вместе — высотой с лого (40 px).
function Brand({ compact }: { compact?: boolean }) {
  return (
    <Link to="/search" className="flex items-center gap-1.5">
      <img src="/logo-ds.png" alt="" className="size-10 drop-shadow-[0_0_14px_rgba(46,224,172,0.35)]" />
      {!compact && (
        <div className="text-center">
          <div className="text-[20.8px] font-extrabold leading-[26px] tracking-tight">
            d.s.<span className="text-mint"> Stalker</span>
          </div>
          <div className="font-mono text-[8.5px] leading-[14px] uppercase tracking-[0.22em] -mr-[0.22em] text-mint/80">humint workbench</div>
        </div>
      )}
    </Link>
  );
}

/** Квадратная кнопка окна пользователя: контур шестерни с «i» внутри. */
function UserButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={t('Пользователь')}
      aria-label={t('Пользователь')}
      className={clsx('grid shrink-0 cursor-pointer place-items-center text-dim transition hover:bg-mint/5 hover:text-mint', className)}
    >
      <GearInfoIcon size={33} />
    </button>
  );
}

/** Контур шестерни (как lucide settings) с буквой «i» вместо внутренней окружности. */
function GearInfoIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="8.4" r="0.6" fill="currentColor" stroke="none" />
      <path d="M12 11v5" />
    </svg>
  );
}

function TopBar() {
  const mode = trpc.auth.mode.useQuery();
  return (
    <header className="relative z-10 flex h-14 items-center justify-between border-b border-line px-5">
      <Brand />
      <Link to="/search">
        <Button variant="primary" size="sm">{mode.data === 'bot-db' ? t('Войти через Telegram') : t('Войти')}</Button>
      </Link>
    </header>
  );
}

/** Открыто ли окно пользователя — вне компонента: окно не закрывается, когда смена языка в нём перемонтирует дерево. */
const userDialog = create(false);

/**
 * Боковая панель свёрнута до иконок (кнопка в её нижнем левом углу). Вне компонента и в localStorage: выбор
 * переживает перезагрузку и смену языка, которая перемонтирует дерево.
 */
const SIDEBAR_KEY = 'ft.sidebar.collapsed';
const sidebarCollapsed = create((() => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
})());
function setSidebarCollapsed(v: boolean) {
  sidebarCollapsed.set(v);
  try {
    localStorage.setItem(SIDEBAR_KEY, v ? '1' : '0');
  } catch {
    // приватный режим: выбор живёт до перезагрузки
  }
}

/** Узкое окно (меньше lg): панель всегда в виде иконок, развернуть её негде. */
function useNarrowScreen() {
  const query = '(max-width: 1023px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

function Sidebar() {
  const me = trpc.auth.me.useQuery();
  const narrow = useNarrowScreen();
  const collapsed = useStore(sidebarCollapsed);
  // Только иконки: пользователь свернул панель или окно узкое.
  const compact = collapsed || narrow;
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.invalidate() });
  // Без бота (auth = none | password-sha256) пользователь один и подписки нет.
  const mode = trpc.auth.mode.useQuery();
  const solo = mode.data !== undefined && mode.data !== 'bot-db';
  // Разделы, которые включаются в config.ini: пункт меню есть, только пока сервер отвечает не null.
  const geo = trpc.geo.config.useQuery(undefined, { staleTime: Infinity });
  const pages = trpc.pages.config.useQuery(undefined, { staleTime: Infinity });
  const google = trpc.google.config.useQuery(undefined, { staleTime: Infinity });
  const email = trpc.email.config.useQuery(undefined, { staleTime: Infinity });
  const features = { geo: !!geo.data, pages: !!pages.data, google: !!google.data, email: !!email.data };
  const nav = NAV.filter((n) => !('feature' in n) || features[n.feature]);
  const user = me.data!;
  const userOpen = useStore(userDialog);
  const setUserOpen = userDialog.set;

  return (
    <aside className={clsx('relative z-10 flex shrink-0 flex-col border-r border-line bg-panel/80 backdrop-blur', compact ? 'w-16' : 'w-64')}>
      {/* Шапка: кнопка окна пользователя — квадрат справа (во всю высоту шапки), логотип с названием — по центру остатка.
          В свёрнутой панели от шапки остаётся только эта кнопка (шестерня). */}
      <div className="flex h-16 shrink-0 items-stretch border-b border-line">
        {!compact && (
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <Brand />
          </div>
        )}
        <UserButton onClick={() => setUserOpen(true)} className={compact ? 'min-w-0 flex-1' : 'aspect-square border-l border-line'} />
      </div>
      <nav className={clsx('min-h-0 flex-1 space-y-1 overflow-y-auto', compact ? 'p-2' : 'p-3')}>
        {nav.map((item) => {
          const { to, icon: Icon } = item;
          const label = t(item.label);
          const hint = t(item.hint);
          return (
            <Fragment key={to}>
              {'divider' in item && item.divider && <div className={clsx('!my-2 border-t border-line', compact ? '-mx-2' : '-mx-3')} />}
              <Link
                to={to}
                // В свёрнутой панели подписи нет — название раздела во всплывающей подсказке.
                title={compact ? label : undefined}
                className={clsx('group flex items-center gap-3 rounded-lg border border-transparent py-2.5 text-dim transition hover:bg-mint/5 hover:text-text', compact ? 'justify-center px-0' : 'px-3')}
                activeOptions={{ exact: true, includeSearch: false }}
                activeProps={{ className: '!border-line !bg-mint/10 !text-mint' }}
              >
                <Icon size={18} className="shrink-0" />
                {!compact && (
                  <span>
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="block font-mono text-[10px] uppercase tracking-wider text-mute group-hover:text-dim">{hint}</span>
                  </span>
                )}
              </Link>
            </Fragment>
          );
        })}
      </nav>
      {/* Свернуть / развернуть — в нижнем левом углу. В узком окне панель и так свёрнута, кнопки нет. */}
      {!narrow && (
        <div className={clsx('flex shrink-0 border-t border-line p-2', collapsed && 'justify-center')}>
          <button
            type="button"
            onClick={() => setSidebarCollapsed(!collapsed)}
            title={collapsed ? t('Развернуть панель') : t('Свернуть панель')}
            aria-label={collapsed ? t('Развернуть панель') : t('Свернуть панель')}
            className="grid size-9 cursor-pointer place-items-center rounded-lg text-mute transition hover:bg-mint/5 hover:text-mint"
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
      )}
      <Dialog open={userOpen} onOpenChange={setUserOpen} title={t('Пользователь')}>
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full border border-line bg-mint/10 font-mono text-base text-mint">
            {user.displayName.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <div className="truncate font-semibold">{user.displayName}</div>
            <div className="truncate font-mono text-[11px] text-mute">{user.username ? `@${user.username}` : `ID ${user.tgId}`}</div>
          </div>
        </div>
        <div className={clsx('mb-4 rounded-md border px-2.5 py-1.5 font-mono text-[11px]', user.access.active ? 'border-line text-mint' : 'border-warn/30 text-warn')}>
          {solo
            ? t('● персональный режим')
            : user.access.active
            ? user.access.forced ? t('● полный доступ') : user.access.unlimited ? t('● безлимитный доступ') : t('● подписка до {date}', { date: fmtDate(user.access.until) })
            : t('○ подписка неактивна')}
        </div>
        <UserSettingsFields />
        {mode.data !== 'none' && (
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setUserOpen(false); logout.mutate(); }}>
            <LogOut size={14} /> {t('Выйти')}
          </Button>
        )}
      </Dialog>
    </aside>
  );
}

/** Настройки в окне пользователя: хранятся в БД у пользователя и работают и без подписки. */
function UserSettingsFields() {
  const { settings, update } = useUserSettings();
  return (
    <div className="mb-4 space-y-3">
      <Field label={t('Тема оформления')}>
        <Segmented<Theme>
          value={settings.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { value: 'dark', label: <span className="inline-flex items-center gap-1.5"><Moon size={13} /> {t('Тёмная')}</span> },
            { value: 'light', label: <span className="inline-flex items-center gap-1.5"><Sun size={13} /> {t('Светлая')}</span> },
          ]}
        />
      </Field>
      {/* Названия языков — на них самих, и в русской подписи есть «Language»: их ищут, не понимая текущего. */}
      <Field label={t('Язык интерфейса · Language')}>
        <Segmented<Lang> value={settings.lang} onChange={(lang) => update({ lang })} options={LANGS} />
      </Field>
    </div>
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
        {me.data.access.reason ? tx(me.data.access.reason) : t('Подписка неактивна')}. {t('Режим только для чтения: поиск и правки недоступны.')}
      </span>
      {bot.data && (
        <a href={`https://t.me/${bot.data}?start=subscribe`} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-4">
          {t('Продлить в боте')}
        </a>
      )}
      <Button variant="ghost" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending} title={t('Проверить снова')}>
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
        title={t('Прокрутить в начало')}
        aria-label={t('Прокрутить в начало')}
        // p-0! — базовый px-3 кнопки size="sm" иначе сжимает значок до 8 px.
        className="size-8 p-0!"
      >
        <ArrowUp size={16} className="shrink-0" />
      </Button>
    </div>
  );
}

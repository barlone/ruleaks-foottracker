import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { ReactNode } from 'react';
import { KeyRound, Send } from 'lucide-react';
import { trpc } from '../lib/trpc.ts';
import { errorText } from '../lib/errors.ts';
import { Button, Input, Spinner } from './ui.tsx';

// Вход зависит от [config] auth на сервере:
// bot-db — одноразовая deep-link ссылка в бота; страница опрашивает статус,
//          после подтверждения в боте сервер ставит httpOnly-cookie сессии;
// password-sha256 — пароль единственного пользователя; none — страница входа не показывается.

/** Временный быстрый вход (dev, только с реальной БД бота на localhost). */
const QUICK_LOGIN_TG_ID = '8787072107';

export function LoginPage() {
  const mode = trpc.auth.mode.useQuery();
  if (mode.isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  return mode.data === 'password-sha256' ? <PasswordLogin /> : <BotLogin />;
}

function LoginFrame({ footer, children }: { footer: string; children: ReactNode }) {
  return (
    <div className="bg-grid bg-glow relative flex min-h-full items-center justify-center px-6 py-12">
      <div className="relative z-10 w-full max-w-[760px] animate-fade-up">
        <div className="mb-9 flex flex-col items-center text-center">
          <img src="/logo.png" alt="" className="mb-4 size-40 drop-shadow-[0_0_40px_rgba(46,224,172,0.25)]" />
          <h1 className="text-4xl font-extrabold tracking-tight">
            RuLeaks<span className="text-mint">.Следопыт</span>
          </h1>
          <p className="mt-3 font-mono text-sm uppercase tracking-[0.22em] text-mint/95">
            humint · досье · расследования<span className="animate-blink">_</span>
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-gradient-to-b from-mint/[0.05] to-mint/[0.01] p-8">{children}</div>

        <p className="mt-8 border-t border-line pt-5 text-center font-mono text-xs tracking-wide text-mute">{footer}</p>
      </div>
    </div>
  );
}

function PasswordLogin() {
  const utils = trpc.useUtils();
  const [password, setPassword] = useState('');
  const login = trpc.auth.password.useMutation({ onSuccess: () => utils.auth.me.invalidate() });

  return (
    <LoginFrame footer="Персональный режим: один пользователь">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (password) login.mutate({ password });
        }}
      >
        <h2 className="label-mono mb-4 flex items-center justify-center gap-2.5">
          <span className="size-1.5 rounded-full bg-mint shadow-[0_0_10px_var(--color-mint)]" />
          Вход по паролю
        </h2>
        <div className="flex justify-center gap-2">
          <Input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            className="max-w-sm"
          />
          <Button type="submit" variant="primary" disabled={!password || login.isPending}>
            {login.isPending ? <Spinner /> : <KeyRound size={16} />} Войти
          </Button>
        </div>
        {login.error && <div className="mt-3 text-center font-mono text-xs text-danger">{errorText(login.error)}</div>}
      </form>
    </LoginFrame>
  );
}

function BotLogin() {
  const utils = trpc.useUtils();
  const start = trpc.auth.start.useMutation();
  const devLogin = trpc.auth.devLogin.useQuery();
  const [tgId, setTgId] = useState('');
  const devConfirm = trpc.auth.devConfirm.useMutation();
  const [expired, setExpired] = useState(false);
  const nonce = start.data?.nonce;

  // Один запрос входа на монтирование: сервер привязывает nonce к cookie браузера, и второй запрос
  // (StrictMode вызывает эффект дважды) перебил бы cookie первого — опрос статуса получал бы «expired».
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    start.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = trpc.auth.status.useQuery(
    { nonce: nonce ?? '' },
    // Опрос и в фоне: пользователь в это время в Telegram, вкладка часто скрыта.
    { enabled: !!nonce && !expired, refetchInterval: 1500, refetchIntervalInBackground: true, gcTime: 0 },
  );

  useEffect(() => {
    if (status.data?.status === 'confirmed') void utils.auth.me.invalidate();
    if (status.data?.status === 'expired') setExpired(true);
  }, [status.data?.status, utils]);

  const restart = () => {
    setExpired(false);
    start.mutate();
  };

  return (
    <LoginFrame footer="Доступ по действующей подписке бота RuLeaks">
      <div className="grid items-center gap-8 md:grid-cols-[1fr_auto]">
        <div>
          <h2 className="label-mono mb-3 flex items-center gap-2.5">
            <span className="size-1.5 rounded-full bg-mint shadow-[0_0_10px_var(--color-mint)]" />
            Вход через Telegram-бот
          </h2>
          <ol className="space-y-2 text-dim">
            <li><span className="font-mono text-mint">01</span> Нажмите кнопку или отсканируйте QR-код</li>
            <li><span className="font-mono text-mint">02</span> В боте нажмите <b className="text-text">«Войти на сайт»</b></li>
            <li><span className="font-mono text-mint">03</span> Эта страница откроется автоматически</li>
          </ol>
          <div className="mt-7">
            {start.data && !expired ? (
              <a href={start.data.deepLink} target="_blank" rel="noreferrer">
                <Button variant="primary" size="lg">
                  <Send size={22} /> Открыть бота
                </Button>
              </a>
            ) : (
              <Button variant="primary" size="lg" onClick={restart} disabled={start.isPending}>
                {start.isPending ? <Spinner /> : 'Получить новую ссылку'}
              </Button>
            )}
          </div>
          <p className="mt-4 font-mono text-xs text-mute">
            {expired ? 'Ссылка устарела.' : start.data ? <>Ожидаю подтверждения в боте <Spinner className="ml-1 size-3 align-middle" /></> : ' '}
          </p>
        </div>
        {start.data && !expired && (
          <div className="rounded-xl border border-line bg-black p-3">
            <QRCodeSVG value={start.data.deepLink} size={168} bgColor="#000000" fgColor="#2EE0AC" level="M" />
          </div>
        )}
      </div>

      {devLogin.data === 'profiles' && nonce && !expired && (
        <div className="mt-8 border-t border-dashed border-line pt-5">
          <div className="mb-3 font-mono text-[11px] uppercase tracking-widest text-warn">dev · имитация подтверждения ботом</div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => devConfirm.mutate({ nonce, profile: 'active' })}>Следопыт (подписка)</Button>
            <Button size="sm" onClick={() => devConfirm.mutate({ nonce, profile: 'colleague' })}>Коллега (безлимит)</Button>
            <Button size="sm" variant="danger" onClick={() => devConfirm.mutate({ nonce, profile: 'expired' })}>Без подписки</Button>
          </div>
        </div>
      )}

      {/* Реальная БД бота, но бот ещё не подтверждает вход: входим как существующий пользователь бота. */}
      {devLogin.data === 'tgid' && nonce && !expired && (
        <form
          className="mt-8 border-t border-dashed border-line pt-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (tgId.trim()) devConfirm.mutate({ nonce, tgId: tgId.trim() });
          }}
        >
          <div className="mb-1 font-mono text-[11px] uppercase tracking-widest text-warn">dev · вход по Telegram ID пользователя бота</div>
          <p className="mb-3 text-xs text-mute">Подписка и токен API берутся из базы бота. Доступно только при запуске на localhost.</p>
          <div className="flex gap-2">
            <Input value={tgId} onChange={(e) => setTgId(e.target.value)} placeholder="Telegram ID (chat_id)" inputMode="numeric" className="max-w-xs font-mono" />
            <Button type="submit" disabled={!tgId.trim() || devConfirm.isPending}>Войти</Button>
            {/* TODO: временная кнопка быстрого входа — убрать, когда вход пойдёт через бота. */}
            <Button
              type="button"
              variant="primary"
              disabled={devConfirm.isPending}
              onClick={() => devConfirm.mutate({ nonce, tgId: QUICK_LOGIN_TG_ID })}
            >
              Войти как {QUICK_LOGIN_TG_ID}
            </Button>
          </div>
          {devConfirm.error && <div className="mt-2 font-mono text-xs text-danger">{errorText(devConfirm.error)}</div>}
        </form>
      )}
    </LoginFrame>
  );
}

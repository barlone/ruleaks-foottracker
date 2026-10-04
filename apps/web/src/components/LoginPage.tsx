import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Send } from 'lucide-react';
import { trpc } from '../lib/trpc.ts';
import { Button, Spinner } from './ui.tsx';

// Вход: одноразовая deep-link ссылка в бота. Страница опрашивает статус,
// после подтверждения в боте сервер ставит httpOnly-cookie сессии.

export function LoginPage() {
  const utils = trpc.useUtils();
  const start = trpc.auth.start.useMutation();
  const devMode = trpc.auth.devMode.useQuery();
  const devConfirm = trpc.auth.devConfirm.useMutation();
  const [expired, setExpired] = useState(false);
  const nonce = start.data?.nonce;

  useEffect(() => {
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

        <div className="rounded-2xl border border-line bg-gradient-to-b from-mint/[0.05] to-mint/[0.01] p-8">
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

          {devMode.data && nonce && !expired && (
            <div className="mt-8 border-t border-dashed border-line pt-5">
              <div className="mb-3 font-mono text-[11px] uppercase tracking-widest text-warn">dev · имитация подтверждения ботом</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => devConfirm.mutate({ nonce, profile: 'active' })}>Следопыт (подписка)</Button>
                <Button size="sm" onClick={() => devConfirm.mutate({ nonce, profile: 'colleague' })}>Коллега (безлимит)</Button>
                <Button size="sm" variant="danger" onClick={() => devConfirm.mutate({ nonce, profile: 'expired' })}>Без подписки</Button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-8 border-t border-line pt-5 text-center font-mono text-xs tracking-wide text-mute">
          Доступ по действующей подписке бота RuLeaks
        </p>
      </div>
    </div>
  );
}

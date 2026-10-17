import { useEffect, useRef } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { trpc } from '../lib/trpc.ts';
import { errorText } from '../lib/errors.ts';
import { loginRoute } from '../router.tsx';
import { Button, Spinner } from './ui.tsx';

// /login?tg=…&ts=…&n=…&sig=… — ссылка входа из бота. Страница один раз отдаёт параметры серверу
// (auth.loginWithLink); после входа переходит в поиск, заменяя адрес в истории — ссылка одноразовая,
// хранить её в истории браузера незачем.

export function LoginLinkPage() {
  const params = loginRoute.useSearch();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const login = trpc.auth.loginWithLink.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
      void navigate({ to: '/search', replace: true });
    },
  });
  const started = useRef(false);
  const complete = !!(params.tg && params.ts && params.n && params.sig);

  useEffect(() => {
    if (!complete || started.current || me.isLoading) return;
    started.current = true;
    // Уже вошли (например, ссылку открыли второй раз) — просто в поиск.
    if (me.data) {
      void navigate({ to: '/search', replace: true });
      return;
    }
    login.mutate({ tg: params.tg!, ts: params.ts!, n: params.n!, sig: params.sig!, name: params.name, nick: params.nick });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, me.isLoading]);

  const problem = !complete ? 'В ссылке не хватает параметров — запросите в боте новую.' : login.error ? errorText(login.error) : null;

  return (
    <div className="bg-grid bg-glow relative flex min-h-full items-center justify-center px-6 py-12">
      <div className="relative z-10 w-full max-w-md animate-fade-up rounded-2xl border border-line bg-gradient-to-b from-mint/[0.05] to-mint/[0.01] p-8 text-center">
        <img src="/logo.png" alt="" className="mx-auto mb-4 size-24 drop-shadow-[0_0_30px_rgba(46,224,172,0.25)]" />
        <h1 className="text-2xl font-extrabold tracking-tight">
          RuLeaks<span className="text-mint">.Следопыт</span>
        </h1>
        {problem ? (
          <>
            <p className="mt-4 font-mono text-sm text-danger">{problem}</p>
            <Link to="/search" className="mt-6 inline-block">
              <Button variant="primary">На страницу входа</Button>
            </Link>
          </>
        ) : (
          <p className="mt-4 flex items-center justify-center gap-2 font-mono text-sm text-dim">
            <Spinner /> Вход по ссылке из бота…
          </p>
        )}
      </div>
    </div>
  );
}

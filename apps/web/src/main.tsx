import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, TRPCClientError } from '@trpc/client';
import { RouterProvider } from '@tanstack/react-router';
import { trpc } from './lib/trpc.ts';
import { loadLang, setLang, storedLang } from './lib/i18n.ts';
import { router } from './router.tsx';
import './styles.css';

function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: (n, e) => !(e instanceof TRPCClientError && e.data?.httpStatus && e.data.httpStatus < 500) && n < 2,
          },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({ links: [httpBatchLink({ url: '/trpc', fetch: (u, o) => fetch(u, { ...o, credentials: 'include' }) })] }),
  );
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </trpc.Provider>
  );
}

// Язык последнего пользователя этого браузера — до первой отрисовки, чтобы страница не мигнула русским.
// Словарь не загрузился — русский; язык из настроек пользователя потом применит Root (AppShell).
const lang = storedLang();
loadLang(lang)
  .then(() => setLang(lang), () => {})
  .finally(() =>
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );

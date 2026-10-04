import { router } from './trpc.ts';
import { authRouter } from './routers/auth.ts';
import { searchRouter } from './routers/search.ts';
import { dossiersRouter } from './routers/dossiers.ts';
import { investigationsRouter } from './routers/investigations.ts';

export const appRouter = router({
  auth: authRouter,
  search: searchRouter,
  dossiers: dossiersRouter,
  investigations: investigationsRouter,
});

/** Тип импортирует фронтенд (только тип — код сервера в бандл не попадает). */
export type AppRouter = typeof appRouter;

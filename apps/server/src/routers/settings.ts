import { UserSettingsPatch, settingsChanges } from '@ft/shared';
import { authedProcedure, router } from '../trpc.ts';

// Индивидуальные настройки пользователя. Читаются вместе с пользователем (auth.me).
// authedProcedure, а не activeProcedure: оформление — личное дело, а не правка данных, подписка для него не нужна.
export const settingsRouter = router({
  /** Меняет только переданные ключи; ответ — полные настройки. */
  update: authedProcedure.input(UserSettingsPatch).mutation(({ ctx, input }) => {
    const { set, reset } = settingsChanges(input);
    return ctx.deps.users.updateSettings(ctx.user.id, set, reset);
  }),
});

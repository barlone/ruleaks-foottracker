import { DEFAULT_USER_SETTINGS, type UserSettingsPatch } from '@ft/shared';
import { errorText } from './errors.ts';
import { toast } from './toast.ts';
import { trpc } from './trpc.ts';

/**
 * Настройки текущего пользователя (без сессии — значения по умолчанию). Изменение видно сразу, не дожидаясь сервера;
 * если сохранить не удалось, значение возвращается назад.
 */
export function useUserSettings() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const mutation = trpc.settings.update.useMutation({
    onMutate: async (patch: UserSettingsPatch) => {
      await utils.auth.me.cancel();
      const before = utils.auth.me.getData();
      if (before) utils.auth.me.setData(undefined, { ...before, settings: { ...before.settings, ...patch } });
      return { before };
    },
    onError: (e, _patch, context) => {
      if (context?.before) utils.auth.me.setData(undefined, context.before);
      toast(errorText(e), 'error');
    },
    onSuccess: (settings) => {
      utils.auth.me.setData(undefined, (user) => user && { ...user, settings });
    },
  });
  return { settings: me.data?.settings ?? DEFAULT_USER_SETTINGS, update: mutation.mutate };
}

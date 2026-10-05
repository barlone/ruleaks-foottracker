import { TRPCClientError } from '@trpc/client';

const MESSAGES: Record<string, string> = {
  NO_SESSION: 'Сессия истекла — войдите снова',
  SUBSCRIPTION_INACTIVE: 'Подписка неактивна: доступен только просмотр. Продлите её в боте',
  VERSION_CONFLICT: 'Объект изменил кто-то другой — данные обновлены, повторите правку',
  NO_RIGHTS: 'Недостаточно прав',
  NOT_FOUND: 'Не найдено или нет доступа',
  USER_NOT_FOUND: 'Исследователь с таким @username не найден (он должен хотя бы раз войти на сайт)',
  SELF_SHARE: 'Нельзя поделиться с владельцем',
  TAG_EXISTS: 'Такой тег уже есть в вашем словаре',
  BAD_TAGS: 'Можно ставить только теги из своего словаря',
  NO_API_TOKEN: 'У аккаунта нет токена API — получите его в боте',
};

export function errorText(e: unknown): string {
  if (e instanceof TRPCClientError) return MESSAGES[e.message] ?? e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function errorCode(e: unknown): string | null {
  return e instanceof TRPCClientError ? e.message : null;
}

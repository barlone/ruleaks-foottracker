import { TRPCClientError } from '@trpc/client';

const MESSAGES: Record<string, string> = {
  NO_SESSION: 'Сессия истекла — войдите снова',
  SUBSCRIPTION_INACTIVE: 'Подписка неактивна: доступен только просмотр. Продлите её в боте',
  VERSION_CONFLICT: 'Объект изменил кто-то другой — данные обновлены, повторите правку',
  NO_RIGHTS: 'Недостаточно прав',
  NOT_FOUND: 'Не найдено или нет доступа',
  INTERNAL: 'Ошибка на сервере — подробности в его журнале',
  USER_NOT_FOUND: 'Исследователь с таким @username не найден (он должен хотя бы раз войти на сайт)',
  SELF_SHARE: 'Нельзя поделиться с владельцем',
  TAG_EXISTS: 'Такой тег уже есть в вашем словаре',
  BAD_TAGS: 'Можно ставить только теги из своего словаря',
  BAD_MEMBERS: 'В группу можно добавить только досье, доступное вам для чтения',
  BAD_NODE_DOSSIER: 'К узлу можно привязать только досье, доступное вам для чтения',
  RELATION_TYPE_EXISTS: 'Такой тип связи уже есть',
  BAD_RELATION: 'Связь возможна только между разными досье персон, доступными вам',
  BAD_RELATION_TYPE: 'Можно выбрать только предопределённый тип связи или тип из своего словаря',
  NO_API_TOKEN: 'У аккаунта нет токена API — получите его в боте',
  BAD_PASSWORD: 'Неверный пароль',
  BAD_LINK: 'Ссылка входа повреждена или подписана не этим ботом — запросите в боте новую',
  LINK_EXPIRED: 'Срок ссылки входа истёк — запросите в боте новую',
  LINK_USED: 'Эта ссылка входа уже использована — запросите в боте новую',
  LINK_LOGIN_DISABLED: 'Вход по ссылке из бота выключен в настройках сервера',
  TOO_MANY_ATTEMPTS: 'Слишком много неудачных попыток — подождите минуту',
  BAD_FILE: 'Файл повреждён или это не файл экспорта Следопыта',
  UNSUPPORTED_VERSION: 'Файл сделан более новой версией Следопыта — обновите сайт',
  NEED_PASSWORD: 'Файл защищён паролем — введите пароль, заданный при экспорте',
  FILE_TOO_LARGE: 'Файл слишком большой',
  UPLOAD_EXPIRED: 'Загруженный файл устарел — выберите его снова',
  IMPORT_BUSY: 'Сервер сейчас занят другими импортами — повторите через несколько минут',
  SCANSTORE_UNAVAILABLE: 'Хранилище сканов документов недоступно',
  PAGES_DISABLED: 'Поиск личных страниц выключен в настройках сервера',
  PAGES_BUSY: 'Сервер сейчас выполняет слишком много поисков страниц — повторите через минуту',
};

export function errorText(e: unknown): string {
  if (e instanceof TRPCClientError) {
    // «КОД: подробность» (BAD_FILE: нет meta.info).
    const [code, detail] = e.message.split(/: (.*)/s);
    if (detail && MESSAGES[code!]) return `${MESSAGES[code!]} (${detail})`;
    return MESSAGES[e.message] ?? e.message;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

export function errorCode(e: unknown): string | null {
  return e instanceof TRPCClientError ? e.message.split(':')[0]! : null;
}

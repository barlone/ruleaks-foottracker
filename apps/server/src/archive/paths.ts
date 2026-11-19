// Адреса архивов страниц — все под /site-archive/, который уже проксируют Vite и nginx.

export const ARCHIVE_FILES_PATH = '/site-archive';
/** Подключение Google Диска: сюда браузер уходит со страницы досье. */
export const DRIVE_CONNECT_PATH = '/site-archive/google/connect';
/** Возврат из Google (тот же адрес — [google-drive] redirect-url). Единственный адрес, куда приходят с чужого сайта. */
export const DRIVE_CALLBACK_PATH = '/site-archive/google/callback';
/** Файл сохранённого архива: /site-archive/saved/<досье>/<ссылка>/<архив>/<pdf|wacz>. */
export const SAVED_FILES_PATH = '/site-archive/saved';

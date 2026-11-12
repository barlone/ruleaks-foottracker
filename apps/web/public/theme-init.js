// До первой отрисовки: настройки пользователя придут с сервера позже, и светлая тема мигнула бы тёмной (lib/theme.ts).
// Отдельным файлом, а не inline-скриптом в index.html: Content-Security-Policy в nginx разрешает только script-src 'self'.
try {
  if (localStorage.getItem('ft-theme') === 'light') document.documentElement.dataset.theme = 'light';
} catch {}

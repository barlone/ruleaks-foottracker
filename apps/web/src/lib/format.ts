export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', withTime
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function ago(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'только что';
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} дн назад`;
  return fmtDate(iso);
}

/**
 * Время из сервиса Telegram-комментариев шлюза — в UTC, в одном из форматов:
 * «ДД.ММ.ГГГГ ЧЧ:ММ:СС» (время сообщения, JSONTime шлюза) или ISO 8601 (время реакции).
 * Показывается как есть в UTC, без пересчёта в пояс браузера: «ДД.ММ.ГГГГ ЧЧ:ММ».
 * new Date() для первого формата не годится — браузер читает его как «месяц.день».
 */
export function fmtUtc(s: string | null | undefined): string {
  if (!s) return '—';
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2})/.exec(s);
  if (ru) return `${ru[1]}.${ru[2]}.${ru[3]} ${ru[4]}:${ru[5]}`;
  const isoNoTz = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s);
  const d = new Date(isoNoTz ? `${s}Z` : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('ru-RU', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
}

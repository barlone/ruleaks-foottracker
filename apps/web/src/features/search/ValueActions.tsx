import clsx from 'clsx';
import { ExternalLink, Globe, MailCheck, MapPin, MapPinned, MessageCircle, Phone, Send, type LucideIcon } from 'lucide-react';

// Быстрые переходы по значению атрибута — как кнопки в HTML-отчётах бота
// (pyruleaks-bot: app/reports/templates/template_rawsearch.html, openInTelegram/openGoogleMaps/…).

interface ValueAction {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Цвет иконки при наведении — чтобы мессенджеры различались не только подсказкой. */
  hover: string;
}

/** Телефон в цифрах международного формата: 8XXXXXXXXXX → 7XXXXXXXXXX (в утечках РФ встречаются оба). */
function phoneDigits(raw: string): string | null {
  let d = raw.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('8')) d = `7${d.slice(1)}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/** Только абсолютные http(s)-ссылки, как фильтр report_url бота: иначе javascript: и прочие схемы. */
function webUrl(raw: string): string | null {
  const v = raw.trim();
  if (!/^https?:\/\//i.test(v) || /[\x00-\x20\x7f\\]/.test(v)) return null;
  try {
    const u = new URL(v);
    return u.hostname ? u.href : null;
  } catch {
    return null;
  }
}

/** Поля шлюза во множественном числе (phones), у глубокого поиска иногда в единственном (phone). */
function actionsFor(field: string, value: string): ValueAction[] {
  const v = value.trim();
  if (!v) return [];
  switch (field) {
    case 'phones':
    case 'phone': {
      const d = phoneDigits(v);
      if (!d) return [];
      return [
        { title: 'Открыть чат в Telegram', href: `https://t.me/+${d}`, icon: Send, hover: 'hover:text-[#27A5E7]' },
        { title: 'Открыть чат в WhatsApp', href: `https://wa.me/${d}`, icon: MessageCircle, hover: 'hover:text-[#25D366]' },
        { title: 'Открыть чат в Viber', href: `viber://chat?number=%2B${d}`, icon: Phone, hover: 'hover:text-[#8F7CF7]' },
      ];
    }
    case 'emails':
    case 'email':
      return [{ title: 'Проверить email (mailmeteor)', href: `https://mailmeteor.com/email-checker?${new URLSearchParams({ email: v })}`, icon: MailCheck, hover: 'hover:text-mint' }];
    case 'geolocs': {
      const coords = v.replace(/\s+/g, '');
      return [{ title: 'Открыть геолокацию в Google Maps', href: `https://www.google.com/maps/place/${encodeURIComponent(coords)}`, icon: MapPinned, hover: 'hover:text-mint' }];
    }
    case 'addrs':
      return [{ title: 'Найти адрес в Google Maps', href: `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query: v })}`, icon: MapPin, hover: 'hover:text-mint' }];
    case 'weblinks':
    case 'link': {
      const url = webUrl(v);
      return url ? [{ title: 'Перейти по ссылке', href: url, icon: ExternalLink, hover: 'hover:text-mint' }] : [];
    }
    case 'ips':
    case 'ip':
      return [{ title: 'Сведения об IP-адресе (ipgeolocation.io)', href: `https://ipgeolocation.io/what-is-my-ip/${encodeURIComponent(v)}`, icon: Globe, hover: 'hover:text-mint' }];
    case 'tgids':
    case 'tgid':
      // tg:// открывает профиль, только если клиент Telegram «знает» пользователя (общий чат, контакт).
      return /^\d+$/.test(v) ? [{ title: 'Открыть профиль в Telegram', href: `tg://user?id=${v}`, icon: Send, hover: 'hover:text-[#27A5E7]' }] : [];
    default:
      return [];
  }
}

/** Иконки-ссылки справа от значения, перед кнопкой копирования. */
export function ValueActions({ field, value }: { field: string; value: string }) {
  const actions = actionsFor(field, value);
  if (!actions.length) return null;
  return (
    <>
      {actions.map((a) => {
        const web = /^https?:/i.test(a.href);
        return (
          <a
            key={a.title}
            href={a.href}
            // Веб-ссылки — в новой вкладке; схемы приложений (tg://, viber://) открываются без пустой вкладки.
            {...(web ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            title={a.title}
            aria-label={a.title}
            className={clsx('shrink-0 text-mute transition', a.hover)}
          >
            <a.icon size={14} />
          </a>
        );
      })}
    </>
  );
}

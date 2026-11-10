// Справочные данные GHunt (ghunt/knowledge/*, ghunt/config.py): ключи публичных веб-клиентов Google,
// подписи Android-пакетов и шаблоны запросов. Это не секреты — они зашиты в приложения и сайты Google.

/** Заголовки веб-запросов (ghunt/config.py headers). */
export const WEB_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; rv:68.0) Gecko/20100101 Firefox/68.0',
};

/** User-Agent Android-клиента для gRPC (ghunt/config.py android_headers). */
export const androidUserAgent = (pkg: string) =>
  `${pkg}/323710070 (Linux; U; Android 11; fr_FR; Pixel 5; Build/RD2A.211001.002; Cronet/97.0.4692.70) grpc-java-cronet/1.44.0-SNAPSHOT`;

/** Ключи API веб-клиентов Google и источник (Origin), с которого ключ принимается (knowledge/keys.py). */
export const API_KEYS = {
  photos: { key: 'AIzaSyAa2odBewW-sPJu3jMORr0aNedh3YlkiQc', origin: 'https://photos.google.com' },
  calendar: { key: 'AIzaSyBNlYH01_9Hc5S1J9vuFmu2nUqBZJNAXxs', origin: 'https://calendar.google.com' },
} as const;
export type ApiKeyName = keyof typeof API_KEYS;

/** SHA-1 сертификата, которым подписан Android-пакет (knowledge/sig.py). */
export const PACKAGE_SIGS: Record<string, string> = {
  'com.google.android.play.games': '38918a453d07199354f8b19af05ec6562ced5788',
  'com.google.android.gms': '38918a453d07199354f8b19af05ec6562ced5788',
  'com.android.chrome': '38918a453d07199354f8b19af05ec6562ced5788',
};

/** От чьего имени (пакет + права) запрашивается токен OAuth по мастер-токену. */
export interface OAuthApp {
  /** Имя для кэша токенов. */
  name: string;
  pkg: string;
  scopes: string[];
}

/** apis/accounts.py: обмен на uberauth → cookie веб-сессии. */
export const CHROME_APP: OAuthApp = {
  name: 'chrome',
  pkg: 'com.android.chrome',
  scopes: ['https://www.google.com/accounts/OAuthLogin'],
};

/** apis/playgames.py, apis/playgateway.py. */
export const PLAYGAMES_APP: OAuthApp = {
  name: 'playgames',
  pkg: 'com.google.android.play.games',
  scopes: ['https://www.googleapis.com/auth/games.firstparty', 'https://www.googleapis.com/auth/googleplay'],
};

/** config.py templates.gmaps_pb.stats: {} — Gaia ID. */
export const GMAPS_STATS_PB =
  '!1s{}!2m3!1sYE3rYc2rEsqOlwSHx534DA!7e81!15i14416!6m2!4b1!7b1!9m0!16m4!1i100!4b1!5b1!6BQ0FFU0JrVm5TVWxEenc9PQ!17m28!1m6!1m2!1i0!2i0!2m2!1i458!2i736!1m6!1m2!1i1868!2i0!2m2!1i1918!2i736!1m6!1m2!1i0!2i0!2m2!1i1918!2i20!1m6!1m2!1i0!2i716!2m2!1i1918!2i736!18m12!1m3!1d806313.5865720833!2d150.19484835!3d-34.53825215!2m3!1f0!2f0!3f0!3m2!1i1918!2i736!4f13.1';

/** apis/playgateway.py ext_metadata: описание устройства и версии клиента Play Игр (заголовки X-Goog-Ext-…-Bin). */
export const PLAYGATEWAY_EXT: Record<string, string> = {
  '158709649': 'CggaBgj22K2aARo4EgoI+aKnlZf996E/GhcQHhoPUkQyQS4yMTEwMDEuMDAyIgIxMToICgZJZ0pHVWdCB1BpeGVsIDU',
  '173715354': 'CgEx',
};

/**
 * Средние хеши стандартных картинок профиля. Первый — из GHunt (helpers/utils.py is_default_profile_pic): светлый
 * силуэт на тёмном фоне, каким он был раньше. Второй — нынешняя …/a/default-user: тёмно-синий силуэт на голубом
 * фоне; с эталоном GHunt он не совпадает (46 бит из 64), и без него стандартная картинка считалась бы своей.
 */
export const DEFAULT_PHOTO_FLATHASHES = ['000018183c3c0000', 'ffffc3c3e7c38181'];

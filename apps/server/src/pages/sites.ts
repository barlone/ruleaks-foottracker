import { readFileSync } from 'node:fs';
import { z } from 'zod';

// Список сайтов для поиска личных страниц — манифест проекта Sherlock (sites.json рядом, лицензия MIT —
// LICENSE.sherlock). Обновление: npm run pages-sites-update. Поля — как в data.json Sherlock:
//   url        — адрес страницы пользователя, {} заменяется на имя;
//   urlProbe   — адрес, который на самом деле запрашивается (API вместо HTML-страницы), иначе url;
//   errorType  — как понять, что пользователя нет:
//                message      — в ответе есть одна из строк errorMsg;
//                status_code  — код ответа из errorCode или вне 2xx;
//                response_url — сайт перенаправляет (редиректы не следуются, нужен 2xx);
//   regexCheck — имена, не подходящие под выражение, на этом сайте не проверяются;
//   request_method / request_payload / headers — особенности запроса; isNSFW — сайт 18+.

const RawSite = z.looseObject({
  url: z.string().min(1),
  urlMain: z.string().min(1),
  errorType: z.enum(['message', 'status_code', 'response_url']),
  errorMsg: z.union([z.string(), z.array(z.string())]).optional(),
  errorCode: z.union([z.number().int(), z.array(z.number().int())]).optional(),
  regexCheck: z.string().optional(),
  urlProbe: z.string().optional(),
  request_method: z.enum(['GET', 'HEAD', 'POST', 'PUT']).optional(),
  request_payload: z.unknown().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  isNSFW: z.boolean().optional(),
});

export interface Site {
  name: string;
  url: string;
  urlMain: string;
  urlProbe: string | null;
  errorType: 'message' | 'status_code' | 'response_url';
  errorMsg: string[];
  /** null — любой код вне 2xx значит «нет такого пользователя». */
  errorCode: number[] | null;
  regexCheck: RegExp | null;
  requestMethod: 'GET' | 'HEAD' | 'POST' | 'PUT' | null;
  /** JSON тела запроса ({} в строках заменяется на имя). */
  requestPayload: unknown;
  headers: Record<string, string>;
  nsfw: boolean;
}

const asList = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Разбирает манифест Sherlock. Ключи с «$» (schema, служебные) пропускаются. */
export function parseSites(json: unknown): Site[] {
  const entries = z.record(z.string(), z.unknown()).parse(json);
  const sites: Site[] = [];
  for (const [name, raw] of Object.entries(entries)) {
    if (name.startsWith('$')) continue;
    const r = RawSite.parse(raw);
    sites.push({
      name,
      url: r.url,
      urlMain: r.urlMain,
      urlProbe: r.urlProbe ?? null,
      errorType: r.errorType,
      errorMsg: asList(r.errorMsg),
      errorCode: r.errorCode === undefined ? null : asList(r.errorCode),
      regexCheck: r.regexCheck ? new RegExp(r.regexCheck) : null,
      requestMethod: r.request_method ?? null,
      requestPayload: r.request_payload,
      headers: r.headers ?? {},
      nsfw: r.isNSFW ?? false,
    });
  }
  return sites.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export const SITES_FILE = new URL('./sites.json', import.meta.url);

let cache: Site[] | null = null;

/** Все сайты манифеста (файл читается один раз). */
export function allSites(): Site[] {
  cache ??= parseSites(JSON.parse(readFileSync(SITES_FILE, 'utf8')));
  return cache;
}

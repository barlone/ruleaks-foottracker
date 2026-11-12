import type { EmailWeb, WebMention } from '@ft/shared';
import { BROWSER_USER_AGENT, readText, statusError, xfetch, type Ctx } from './http.ts';

// Упоминания адреса в вебе — модуль googlesearch MOSINT (v3/pkg/scrape/googlesearch: выдача Google по
// intext:"адрес", разбор colly). Google с 2025 года без JavaScript выдачу не отдаёт, а от сервера получил бы капчу,
// поэтому автоматически ищем в HTML-выдаче DuckDuckGo (она работает без JavaScript) точной фразой; ручной поиск
// в Google, Яндексе и Bing — ссылками на странице отчёта.

const MAX_HITS = 20;

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Ссылка результата: DuckDuckGo заворачивает её в //duckduckgo.com/l/?uddg=<адрес>. Рекламу (y.js) пропускаем. */
function resultUrl(href: string): string | null {
  const h = decode(href);
  try {
    const u = new URL(h, 'https://duckduckgo.com');
    if (u.hostname.endsWith('duckduckgo.com')) {
      if (u.pathname === '/l/') return u.searchParams.get('uddg');
      return null;
    }
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** Разбор HTML-выдачи: заголовок (a.result__a) и фрагмент (.result__snippet) каждого результата. */
export function parseDuckHtml(html: string, email: string): WebMention[] {
  const hits: WebMention[] = [];
  const re = /<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const starts = [...html.matchAll(re)];
  for (let i = 0; i < starts.length && hits.length < MAX_HITS; i++) {
    const m = starts[i]!;
    const url = resultUrl(m[1]!);
    if (!url || hits.some((h) => h.url === url)) continue;
    const tail = html.slice(m.index! + m[0].length, starts[i + 1]?.index ?? html.length);
    const sn = /class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|td|div)>/.exec(tail)?.[1];
    const title = decode(m[2]!);
    const snippet = sn ? decode(sn) : null;
    const hay = `${title} ${snippet ?? ''} ${url}`.toLowerCase();
    hits.push({ title: title || url, url, snippet, exact: hay.includes(email) });
  }
  return hits;
}

export async function webMentions(email: string, ctx: Ctx): Promise<EmailWeb> {
  const res = await xfetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'text/html',
      'Accept-Language': 'ru,en;q=0.8',
      Referer: 'https://html.duckduckgo.com/',
    },
    body: `q=${encodeURIComponent(`"${email}"`)}&kl=wt-wt`,
  }, ctx, 'DuckDuckGo');
  // 202 + страница проверки (anomaly) — DuckDuckGo принял сервер за бота.
  if (res.status === 202 || res.status === 403 || res.status === 429) {
    await res.body?.cancel().catch(() => undefined);
    return { engine: 'DuckDuckGo', state: 'blocked', hits: [] };
  }
  if (res.status !== 200) throw await statusError(res, ctx, 'DuckDuckGo');
  const html = await readText(res, ctx, 'DuckDuckGo');
  if (/anomaly-modal|challenge-form|id="captcha/i.test(html)) return { engine: 'DuckDuckGo', state: 'blocked', hits: [] };
  return { engine: 'DuckDuckGo', state: 'ok', hits: parseDuckHtml(html, email) };
}

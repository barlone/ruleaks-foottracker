import { writeFileSync } from 'node:fs';
import { EMAIL_SITES_FILE, parseEmailSites } from '../pages/email-sites.ts';

// Обновляет список почтовых сайтов поиска личных страниц из репозитория blackbird:
//   npm run pages-email-update
// Файл проверяется той же схемой, что при запуске сервера, и записывается с пометкой, откуда и когда взят.
// Проверки в стиле holehe добавляются в коде (EMAIL_SITES EXTRA в pages/email-sites.ts), здесь не трогаются.

const UPSTREAM = 'https://raw.githubusercontent.com/p1ngul1n0/blackbird/main/data/email-data.json';

const res = await fetch(UPSTREAM, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) {
  console.error(`${UPSTREAM} → HTTP ${res.status}`);
  process.exit(1);
}
const json = (await res.json()) as Record<string, unknown>;
const sites = parseEmailSites(json);
const out = { $upstream: { url: UPSTREAM, fetchedAt: new Date().toISOString(), sites: sites.length }, ...json };
writeFileSync(EMAIL_SITES_FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${EMAIL_SITES_FILE.pathname}: сайтов ${sites.length}`);

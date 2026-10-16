import { writeFileSync } from 'node:fs';
import { parseSites, SITES_FILE } from '../pages/sites.ts';

// Обновляет список сайтов поиска личных страниц из репозитория Sherlock:
//   npm run pages-sites-update
// Файл проверяется той же схемой, что при запуске сервера, и записывается с пометкой, откуда и когда взят.

const UPSTREAM = 'https://raw.githubusercontent.com/sherlock-project/sherlock/master/sherlock_project/resources/data.json';

const res = await fetch(UPSTREAM, { signal: AbortSignal.timeout(60_000) });
if (!res.ok) {
  console.error(`${UPSTREAM} → HTTP ${res.status}`);
  process.exit(1);
}
const json = (await res.json()) as Record<string, unknown>;
const sites = parseSites(json);
const { $schema: _schema, ...rest } = json;
const out = { $upstream: { url: UPSTREAM, fetchedAt: new Date().toISOString(), sites: sites.length }, ...rest };
writeFileSync(SITES_FILE, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${SITES_FILE.pathname}: сайтов ${sites.length}`);

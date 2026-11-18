import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { TextReader, Uint8ArrayWriter, ZipWriter } from '@zip.js/zip.js';
import type { ArchiveFormat } from '@ft/shared';
import type { ArchiveFile, ArchivePoll, SiteArchiver } from '../../ports.ts';
import { renderPdf } from '../../pdf/render.ts';

// Имитация службы архивации ([config] site-archive = true без [site-archive] api-key): служба не нужна, страница
// никуда не открывается. Захват «идёт» ~15 секунд по этапам, файлы вымышленные: PDF с адресом страницы и WACZ с
// пустой записью. Адрес со словом fail — PDF «не получается» (проверка показа ошибки формата).

const QUEUED_MS = 3000;
const DONE_MS: Record<ArchiveFormat, number> = { pdf: 8000, wacz: 13_000 };
const SEAL_MS = 15_000;

interface Capture {
  url: string;
  formats: ArchiveFormat[];
  at: number;
  files: Partial<Record<ArchiveFormat, Promise<Buffer>>>;
}

export class DemoSiteArchiver implements SiteArchiver {
  readonly demo = true;
  private captures = new Map<string, Capture>();

  async start(url: string, formats: ArchiveFormat[]): Promise<string> {
    const ref = randomUUID();
    this.captures.set(ref, { url, formats, at: Date.now(), files: {} });
    return ref;
  }

  async poll(ref: string): Promise<ArchivePoll> {
    const c = this.captures.get(ref);
    if (!c) return { stage: 'done', parts: {} };
    const t = Date.now() - c.at;
    if (t < QUEUED_MS) return { stage: 'queued', parts: {} };
    const parts: ArchivePoll['parts'] = {};
    for (const f of c.formats) {
      if (t < DONE_MS[f]) {
        parts[f] = { status: 'running', error: null, file: null };
      } else if (f === 'pdf' && /fail/i.test(c.url)) {
        parts[f] = { status: 'failed', error: 'demo: page.pdf() timed out', file: null };
      } else {
        const body = await (c.files[f] ??= f === 'pdf' ? demoPdf(c.url) : demoWacz(c.url));
        parts[f] = { status: 'ok', error: null, file: memFile(body) };
      }
    }
    return { stage: t < SEAL_MS ? 'capturing' : 'done', parts };
  }

  async remove(ref: string): Promise<void> {
    this.captures.delete(ref);
  }
}

const memFile = (body: Buffer): ArchiveFile => ({ size: body.length, open: () => Readable.from(body) });

function demoPdf(url: string): Promise<Buffer> {
  const at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  return renderPdf({
    title: 'Демо-архив страницы',
    footerTitle: 'Демо-архив страницы',
    author: 'RuLeaks.Следопыт',
    note: '',
    password: '',
    content: [
      { text: 'Демо-архив страницы', style: 'h1' },
      { text: 'Это имитация: служба архивации не настроена ([site-archive] api-key пуст), страница не открывалась.', margin: [0, 6, 0, 12] },
      { text: `Адрес: ${url}` },
      { text: `Время (UTC): ${at}` },
    ],
  });
}

/** Минимальный WACZ: datapackage.json, список страниц и одна запись WARC с заглушкой ответа. */
async function demoWacz(url: string): Promise<Buffer> {
  const now = new Date().toISOString();
  const html = `<!doctype html><meta charset="utf-8"><title>Демо-архив</title><p>Демо-архив страницы ${url.replace(/[<&]/g, '')}</p>`;
  const http = `HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(html)}\r\n\r\n${html}`;
  const warc = `WARC/1.1\r\nWARC-Type: response\r\nWARC-Record-ID: <urn:uuid:${randomUUID()}>\r\nWARC-Date: ${now}\r\nWARC-Target-URI: ${url}\r\n`
    + `Content-Type: application/http; msgtype=response\r\nContent-Length: ${Buffer.byteLength(http)}\r\n\r\n${http}\r\n\r\n`;
  const pages = `${JSON.stringify({ format: 'json-pages-1.0', id: 'pages', title: 'All Pages' })}\n${JSON.stringify({ id: randomUUID(), url, ts: now, title: 'Демо-архив' })}\n`;
  const files: Array<[string, string]> = [['archive/data.warc', warc], ['pages/pages.jsonl', pages]];
  const resources = files.map(([path, text]) => ({
    name: path.split('/').pop(), path, hash: `sha256:${createHash('sha256').update(text).digest('hex')}`, bytes: Buffer.byteLength(text),
  }));
  const datapackage = JSON.stringify({ profile: 'data-package', wacz_version: '1.1.1', title: 'Демо-архив', created: now, software: 'RuLeaks.Следопыт (имитация)', resources }, null, 2);
  const zip = new ZipWriter(new Uint8ArrayWriter());
  for (const [path, text] of files) await zip.add(path, new TextReader(text), { level: 0 });
  await zip.add('datapackage.json', new TextReader(datapackage), { level: 0 });
  return Buffer.from(await zip.close());
}

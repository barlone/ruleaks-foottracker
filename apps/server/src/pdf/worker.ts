import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { parentPort } from 'node:worker_threads';
import type { TDocumentDefinitions, TFontDictionary } from 'pdfmake/interfaces';
import { EMOJI_DIR, EMOJI_FONT, emojiFontDef } from './emoji.ts';
import type { PdfJob, WorkerRequest, WorkerResponse } from './render.ts';
import { APP, MINT, TABLE_LAYOUTS } from './theme.ts';

// Вёрстка PDF в отдельном потоке (worker_threads). pdfmake раскладывает документ синхронно и на большом отчёте
// (тысячи сообщений Telegram) занимает процессор десятками секунд — в главном потоке это остановило бы все запросы
// всех пользователей. Сюда приходит готовое содержимое (Content[], без функций), отсюда — байты PDF.
// Шрифт Roboto — из пакета pdfmake (с кириллицей), эмодзи — Noto Emoji (emoji.ts). Внешние адреса и локальные
// файлы вне каталогов шрифтов pdfmake открывать запрещено (политики доступа ниже).

const require = createRequire(import.meta.url);
const pdfmake = require('pdfmake') as typeof import('pdfmake');
const ROBOTO = (require('pdfmake/fonts/Roboto.js') as TFontDictionary).Roboto!;
const FONT_DIR = resolve(dirname(String(ROBOTO.normal)));
pdfmake.addFonts({ Roboto: ROBOTO, [EMOJI_FONT]: emojiFontDef });
pdfmake.addTableLayouts(TABLE_LAYOUTS);
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((p) => resolve(p).startsWith(FONT_DIR) || resolve(p).startsWith(EMOJI_DIR));

const PRINTING = { none: undefined, low: 'lowResolution', high: 'highResolution' } as const;

/**
 * Пароль — штатное шифрование PDF (AES-256, PDF 1.7 ext 3); без пароля и без ограничений PDF не шифруется.
 * Ограничения печати и копирования соблюдают программы просмотра, а не шифр: поэтому пароль владельца, снимающий
 * их, случайный и нигде не сохраняется (совпади он с паролем на открытие — тот снимал бы и ограничения).
 */
function security({ password, permissions: p }: PdfJob): Partial<TDocumentDefinitions> {
  const restricted = !!p && (p.printing !== 'high' || !p.copying);
  if (!password && !restricted) return {};
  return {
    userPassword: password || undefined,
    ownerPassword: restricted ? randomBytes(24).toString('base64url') : password,
    version: '1.7ext3',
    permissions: {
      printing: p ? PRINTING[p.printing] : 'highResolution',
      copying: p?.copying ?? true,
      contentAccessibility: p?.copying ?? true,
      modifying: false,
      annotating: true,
    },
  };
}

function document(job: PdfJob): TDocumentDefinitions {
  const { title, footerTitle, author, note, content } = job;
  return {
    pageSize: 'A4',
    pageOrientation: job.landscape ? 'landscape' : 'portrait',
    ...(job.watermark ? { watermark: { text: job.watermark, color: '#888888', opacity: 0.1, bold: true } } : {}),
    pageMargins: [40, 40, 40, 50],
    info: { title, author: author || undefined, subject: note || undefined, creator: APP, producer: APP },
    defaultStyle: { font: 'Roboto', fontSize: 9.5, lineHeight: 1.2 },
    styles: {
      h1: { fontSize: 18, bold: true, margin: [0, 0, 0, 2] },
      h2: { fontSize: 12, bold: true, color: MINT, margin: [0, 12, 0, 5] },
      th: { bold: true, fontSize: 8, color: '#555' },
      muted: { color: '#777', fontSize: 9 },
      small: { fontSize: 7.5, color: '#666' },
      quote: { fontSize: 8.5, color: '#555', italics: true, margin: [0, 1, 0, 0] },
    },
    footer: (page, pages) => ({
      columns: [
        { text: `${APP} · ${footerTitle}`, fontSize: 7, color: '#999' },
        { text: `${page} / ${pages}`, alignment: 'right', fontSize: 7, color: '#999' },
      ],
      margin: [40, 20, 40, 0],
    }),
    content,
    // Заголовок раздела, после которого на странице ничего не помещается, переносится на следующую.
    pageBreakBefore: (node, following) => node.headlineLevel === 1 && following.getFollowingNodesOnPage().length === 0,
    ...security(job),
  };
}

const port = parentPort!;
port.on('message', async ({ id, job }: WorkerRequest) => {
  try {
    const buf = await pdfmake.createPdf(document(job)).getBuffer();
    // Копия в своём ArrayBuffer: Buffer из пула нельзя передать (transfer) целиком.
    const data = new Uint8Array(buf);
    port.postMessage({ id, data } satisfies WorkerResponse, [data.buffer]);
  } catch (e) {
    port.postMessage({ id, error: e instanceof Error ? e.message : String(e) } satisfies WorkerResponse);
  }
});

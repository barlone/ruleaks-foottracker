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

function document(job: PdfJob): TDocumentDefinitions {
  const { title, footerTitle, author, note, password, content } = job;
  return {
    pageSize: 'A4',
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
    // Пароль — штатное шифрование PDF (AES-256, PDF 1.7 ext 3); без пароля PDF не шифруется.
    ...(password
      ? { userPassword: password, ownerPassword: password, version: '1.7ext3' as const, permissions: { printing: 'highResolution' as const, copying: true, modifying: false, annotating: true } }
      : {}),
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

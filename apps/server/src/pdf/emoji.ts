import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { Content } from 'pdfmake/interfaces';

// Эмодзи в PDF. В Roboto их нет — без отдельного шрифта реакции и эмодзи в сообщениях пропали бы.
// Noto Emoji (монохромный, @fontsource/noto-emoji: файл «emoji» содержит все символы); цветные эмодзи
// pdfmake не умеет. Текст режется на куски: эмодзи — шрифтом NotoEmoji, остальное — основным.

const require = createRequire(import.meta.url);

export const EMOJI_FONT = 'NotoEmoji';
export const EMOJI_DIR = resolve(dirname(require.resolve('@fontsource/noto-emoji/package.json')), 'files');
// WOFF, не WOFF2: pdfkit встраивает WOFF2 с ошибкой («Offset is outside the bounds of the DataView»).
const FILE = join(EMOJI_DIR, 'noto-emoji-emoji-400-normal.woff');

/** Описание шрифта для pdfmake.addFonts (все начертания — один файл). */
export const emojiFontDef = { normal: FILE, bold: FILE, italics: FILE, bolditalics: FILE };

// Кластер с пиктограммой, флагом (региональные индикаторы) или keycap — эмодзи.
const PICTO = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|⃣/u;
const segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' });

/** Есть ли в строке эмодзи (быстрая проверка перед разбиением). */
export const hasEmoji = (s: string) => PICTO.test(s);

type Run = { text: string; font?: string } & Record<string, unknown>;

/** Текст → куски для вставки в строку pdfmake (text: [...]): эмодзи шрифтом NotoEmoji, у всех кусков style. */
export function emojiRuns(text: string, style: Record<string, unknown> = {}): Run[] {
  if (!hasEmoji(text)) return [{ text, ...style }];
  const parts: Run[] = [];
  for (const { segment } of segmenter.segment(text)) {
    const emoji = PICTO.test(segment);
    const last = parts.at(-1);
    if (last && !!last.font === emoji) last.text += segment;
    else parts.push(emoji ? { ...style, text: segment, font: EMOJI_FONT } : { ...style, text: segment });
  }
  return parts;
}

/** Текст → блок pdfmake с эмодзи шрифтом NotoEmoji. Без эмодзи — строка как есть. */
export function withEmoji(text: string, style: Record<string, unknown> = {}): Content {
  return hasEmoji(text) ? { text: emojiRuns(text), ...style } : { text, ...style };
}

import { mediaBytes } from '@ft/shared';
import { t } from './i18n.ts';

// Скриншот страницы для ссылки досье: картинка из буфера обмена или файла ужимается до лимита встроенных медиа
// (файлового хранилища нет — снимок лежит в самом элементе досье как data URL).

function load(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t('Не удалось прочитать изображение')));
    };
    img.src = url;
  });
}

/**
 * Изображение → data URL не больше maxBytes: ширина до 1920, WebP (браузер без него отдаёт PNG — тогда JPEG),
 * качество и размер снижаются, пока снимок не уложится.
 */
export async function fitShot(blob: Blob, maxBytes: number): Promise<string> {
  const img = await load(blob);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  for (let width = Math.min(img.naturalWidth, 1920); width >= 480; width = Math.round(width * 0.8)) {
    canvas.width = width;
    canvas.height = Math.round((img.naturalHeight * width) / img.naturalWidth);
    // Подложка: у JPEG нет прозрачности.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.9, 0.8, 0.65]) {
      let url = canvas.toDataURL('image/webp', quality);
      if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', quality);
      if (mediaBytes(url) <= maxBytes) return url;
    }
  }
  throw new Error(t('Не удалось ужать снимок до допустимого размера'));
}

/** Сегодняшняя дата по местному времени: ГГГГ-ММ-ДД (значение поля date). */
export function todayIso(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** ГГГГ-ММ-ДД → ДД.ММ.ГГГГ (дата снимка — календарная, без часового пояса). */
export const shotDate = (iso: string) => iso.split('-').reverse().join('.');

/** Изображение из события вставки (Ctrl+V); null — в буфере не картинка. */
export const pastedImage = (e: ClipboardEvent): File | null =>
  [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile() ?? null;

/**
 * Изображение из буфера обмена по кнопке (Clipboard API: только HTTPS или localhost, браузер может спросить
 * разрешение). null — в буфере не картинка; исключение — браузер буфер не отдал.
 */
export async function clipboardImage(): Promise<Blob | null> {
  for (const item of await navigator.clipboard.read()) {
    const type = item.types.find((x) => x.startsWith('image/'));
    if (type) return item.getType(type);
  }
  return null;
}

/** Изображение → data URL: что укладывается в maxBytes — как есть (без потери качества), остальное ужимается. */
export function imageDataUrl(blob: Blob, maxBytes: number): Promise<string> {
  if (blob.size > maxBytes) return fitShot(blob, maxBytes);
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(t('Не удалось прочитать изображение')));
    r.readAsDataURL(blob);
  });
}

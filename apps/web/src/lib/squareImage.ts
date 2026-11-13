// Квадратные картинки узлов графа: любое изображение приводится к 128×128. Квадратное — сразу, остальное —
// через редактор обрезки (components/SquareCropDialog.tsx), который отдаёт сюда вырезаемый квадрат исходника.

import { t } from './i18n.ts';

export const NODE_IMAGE_SIZE = 128;

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(t('Не удалось прочитать изображение')));
    };
    img.src = url;
  });
}

/**
 * Квадрат исходника (sx, sy, side — в его пикселях) → data URL size×size. WebP: мал и держит прозрачность
 * (логотипы); браузер без кодирования WebP сам отдаст PNG.
 */
export function cropSquare(img: HTMLImageElement, sx: number, sy: number, side: number, size = NODE_IMAGE_SIZE): string {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return c.toDataURL('image/webp', 0.85);
}

/** Почти квадратное (разница сторон до 2 %) обрезается по центру без редактора. */
export const isSquare = (img: HTMLImageElement) => Math.abs(img.naturalWidth - img.naturalHeight) <= Math.max(img.naturalWidth, img.naturalHeight) * 0.02;

export function centerSquare(img: HTMLImageElement): string {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  return cropSquare(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side);
}

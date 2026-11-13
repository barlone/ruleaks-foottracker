import { attrTypeLabel } from '@ft/shared';
import { t } from '../../lib/i18n.ts';

/** Альбом медиа досье с фото персоны (группы). */
export const PHOTO_ALBUM = 'Фото персоны';
/** Альбом, в который сохраняются сканы документов из поиска (SaveScanDialog). */
const SCANS_ALBUM = 'Сканы документов';

/** Подписи платформ соцсетей и постов. */
export const PLATFORM_LABELS: Record<string, string> = {
  vk: 'VK', telegram: 'Telegram', ok: 'OK', instagram: 'Instagram', facebook: 'Facebook', x: 'X', youtube: 'YouTube', web: 'Веб', other: 'Другое',
};

/** Подпись платформы для показа (переведённая); неизвестная — как есть. */
export const platformLabel = (p: string) => (PLATFORM_LABELS[p] ? t(PLATFORM_LABELS[p]) : p);

/**
 * Название альбома для показа. Альбомы, которые заводит сам сайт, хранятся по-русски (по ним сравнивают) и
 * переводятся только при показе; альбомы пользователя — его текст, как есть.
 */
export const albumLabel = (album: string) => (album === PHOTO_ALBUM || album === SCANS_ALBUM ? t(album) : album);

/**
 * Подпись атрибута для показа. Хранится подпись на момент добавления (по-русски у типов из каталога);
 * у типа из каталога показывается перевод его подписи, у «своего» атрибута — текст пользователя.
 */
export function attrLabelOf(a: { key: string; label: string }): string {
  const known = a.key !== 'custom' ? attrTypeLabel(a.key) : undefined;
  return known !== undefined ? t(known) : a.label;
}

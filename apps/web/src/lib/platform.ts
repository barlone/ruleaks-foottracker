import type { DossierItem } from '@ft/shared';

type Platform = Extract<DossierItem, { type: 'link' }>['platform'];

/** Платформа ссылки по адресу — для элемента «Соцсети и ссылки» досье. */
export function guessPlatform(url: string): Platform {
  if (/vk\.com/.test(url)) return 'vk';
  if (/t\.me|telegram/.test(url)) return 'telegram';
  if (/ok\.ru/.test(url)) return 'ok';
  if (/instagram/.test(url)) return 'instagram';
  if (/facebook|fb\.com/.test(url)) return 'facebook';
  if (/x\.com|twitter/.test(url)) return 'x';
  if (/youtu/.test(url)) return 'youtube';
  return 'web';
}

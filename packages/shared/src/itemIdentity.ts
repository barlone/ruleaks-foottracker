import type { DossierItem } from './domain.ts';
import { LEAK_FIELDS } from './search.ts';

// Что считать дубликатом элемента досье. Правило одно на сервер (он запрещает) и интерфейс (он предупреждает заранее).
// Сравниваются значения, а не строки: один телефон или паспорт в разной записи — дубликат. Адреса и прочий свободный
// текст сравниваются только без учёта регистра и пробелов: ошибочно запретить новое значение хуже, чем пропустить дубль.

type Of<T extends DossierItem['type']> = Extract<DossierItem, { type: T }>;

/** Новый или сохранённый элемент: id, позиция и источник на сравнение не влияют. */
export type ItemLike =
  | Pick<Of<'attribute'>, 'type' | 'key' | 'label' | 'value'>
  | Pick<Of<'link'>, 'type' | 'url'>
  | Pick<Of<'snapshot'>, 'type' | 'searchId'>
  | Pick<Of<'post'>, 'type' | 'extId'>
  | Pick<Of<'media'> | Of<'note'>, 'type'>;

/** Номера и документы: разделители в записи ничего не значат («45 10 123456» = «4510123456»). */
const COMPACT_FIELDS = new Set(['inns', 'snilss', 'pasps', 'forpasps', 'bsvids', 'ogrnips', 'tgids', 'bankcards', 'milpns', 'plates']);

const text = (s: string) => s.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ').trim();

const compact = (s: string) => text(s).replace(/[^\p{L}\p{N}]/gu, '');

/** Российский номер — к виду 7XXXXXXXXXX: так он приходит из поиска, а вручную его записывают как угодно. */
function phone(s: string) {
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits || text(s);
}

/** Без схемы, www и завершающего «/»; регистр важен только в пути (страницы vk.com/Ivan и vk.com/ivan могут различаться). */
function url(s: string) {
  const m = s.trim().match(/^(?:https?:\/\/)?(?:www\.)?([^/?#]+)(.*)$/i);
  return m ? `${m[1]!.toLowerCase()}${m[2]!.replace(/\/+(?=$|[?#])/, '')}` : text(s);
}

function attributeValue(key: string, value: string) {
  if (key === 'phones') return phone(value);
  if (key === 'weblinks') return url(value);
  if (key === 'niks') return text(value).replace(/^@/, '');
  return COMPACT_FIELDS.has(key) ? compact(value) : text(value);
}

/** Ключ для сравнения; null — у элемента нет признака повтора (заметка, медиа, пост без внешнего id, пустое значение). */
export function itemIdentity(item: ItemLike): string | null {
  switch (item.type) {
    case 'attribute': {
      const value = attributeValue(item.key, item.value);
      if (!value) return null;
      // Свои атрибуты различаются ещё и названием: «Хобби: шахматы» и «Клуб: шахматы» — разные значения.
      const field = Object.hasOwn(LEAK_FIELDS, item.key) ? item.key : `${item.key}/${text(item.label)}`;
      return `attribute:${field}:${value}`;
    }
    case 'link':
      return `link:${url(item.url)}`;
    case 'snapshot':
      return `snapshot:${item.searchId}`;
    case 'post':
      return item.extId ? `post:${item.extId}` : null;
    default:
      return null;
  }
}

/** Элемент досье, который повторяет item; undefined — повтора нет. */
export function findDuplicate<T extends ItemLike>(existing: readonly T[], item: ItemLike): T | undefined {
  const identity = itemIdentity(item);
  return identity === null ? undefined : existing.find((i) => itemIdentity(i) === identity);
}

/** По флагу на элемент items: он уже есть в existing или повторяет элемент выше по самому списку. */
export function markDuplicates(existing: readonly ItemLike[], items: readonly ItemLike[]): boolean[] {
  const seen = new Set(existing.map(itemIdentity));
  return items.map((item) => {
    const identity = itemIdentity(item);
    if (identity === null) return false;
    if (seen.has(identity)) return true;
    seen.add(identity);
    return false;
  });
}

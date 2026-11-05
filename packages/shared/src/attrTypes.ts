import { LEAK_FIELDS, type LeakField } from './search.ts';

// Типы атрибутов досье для ручного ввода — в порядке, в каком их показывает форма «Новый атрибут».
// Ключ — поле шлюза из LEAK_FIELDS, где такое есть (атрибут из поиска и введённый вручную тогда один и тот же тип:
// общий дубликат, «Искать»), иначе — собственный ключ сайта. Подписи — свои, понятнее подписей поиска.

export type AttrTypeKey = LeakField | 'birthaddrs' | 'regaddrs' | 'liveaddrs' | 'vins';

export const ATTR_TYPES: readonly { key: AttrTypeKey; label: string }[] = [
  { key: 'names', label: 'ФИО' },
  { key: 'bdays', label: 'Дата рождения' },
  { key: 'ddays', label: 'Дата смерти' },
  { key: 'inns', label: 'ИНН' },
  { key: 'snilss', label: 'СНИЛС' },
  { key: 'pasps', label: 'Паспорт РФ' },
  { key: 'forpasps', label: 'Загранпаспорт РФ' },
  { key: 'phones', label: 'Телефон' },
  { key: 'emails', label: 'Email' },
  { key: 'bsvids', label: 'Свидетельство о рождении' },
  { key: 'ogrnips', label: 'ОГРНИП' },
  { key: 'tgids', label: 'Telegram ID' },
  { key: 'niks', label: 'Никнейм' },
  { key: 'pbnames', label: 'Записан в тел. книгах' },
  { key: 'addrs', label: 'Адрес' },
  { key: 'birthaddrs', label: 'Адрес рождения' },
  { key: 'regaddrs', label: 'Адрес регистрации' },
  { key: 'liveaddrs', label: 'Адрес проживания' },
  { key: 'weblinks', label: 'Веб-ссылка' },
  { key: 'skypes', label: 'Skype' },
  { key: 'ips', label: 'IP адрес' },
  { key: 'plates', label: 'Номер авто' },
  { key: 'vehicles', label: 'Марка авто' },
  { key: 'vins', label: 'VIN код авто' },
  { key: 'bankcards', label: 'Банковская карта / расч.счет' },
  { key: 'works', label: 'Место работы' },
  { key: 'positions', label: 'Рабочая специальность' },
  { key: 'educs', label: 'Место учебы' },
  { key: 'geolocs', label: 'Геолокация (широта, долгота)' },
  { key: 'milpns', label: 'Личный военный номер' },
  { key: 'milranks', label: 'Военн. звание' },
  { key: 'milposs', label: 'Военн. должность' },
  { key: 'milunits', label: 'Военн. подразделение' },
  { key: 'regdates', label: 'Дата регистрации' },
  { key: 'infos', label: 'Прочее' },
];

/**
 * Связанные пары атрибутов (AttributeItem.parentId): какой тип может быть подчинён какому. ФИО + дата рождения —
 * ещё и готовый запрос поиска «ФИО дд.мм.гггг»; паспорт + «Прочее» — кем и когда выдан.
 */
export const ATTR_PAIRS: readonly { parent: AttrTypeKey; child: AttrTypeKey }[] = [
  { parent: 'names', child: 'bdays' },
  { parent: 'pasps', child: 'infos' },
];

export const pairAllowed = (parentKey: string, childKey: string) => ATTR_PAIRS.some((p) => p.parent === parentKey && p.child === childKey);

export const ATTR_TYPE_LABELS: Readonly<Record<string, string>> = Object.fromEntries(ATTR_TYPES.map((t) => [t.key, t.label]));

/** Подпись типа для формы: из списка ручного ввода, иначе из каталога поиска (поле есть в шлюзе, но в список не вошло). */
export const attrTypeLabel = (key: string): string | undefined => ATTR_TYPE_LABELS[key] ?? LEAK_FIELDS[key as LeakField];

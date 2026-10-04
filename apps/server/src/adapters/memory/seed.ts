import type { Dossier, Investigation, User } from '@ft/shared';

// Демонстрационные данные. Все лица, организации и события вымышлены.

export const U_ME = 'u-sledopyt';
export const U_COLLEAGUE = 'u-colleague';

export const seedUsers: Omit<User, 'access'>[] = [
  { id: U_ME, tgId: '100000001', displayName: 'Следопыт', username: 'sledopyt_dev' },
  { id: 'u-nosub', tgId: '100000002', displayName: 'Без подписки', username: 'nosub_dev' },
  { id: U_COLLEAGUE, tgId: '100000003', displayName: 'Коллега', username: 'colleague_dev' },
];

const t = (d: string) => new Date(d).toISOString();

/** Заглушка «фотографии»: SVG data URI, чтобы не тянуть внешние картинки. */
function photo(label: string, hue: number): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue},45%,22%)"/><stop offset="1" stop-color="hsl(${hue + 40},40%,8%)"/></linearGradient></defs>
<rect width="640" height="480" fill="url(#g)"/>
<circle cx="320" cy="200" r="80" fill="hsla(${hue},60%,70%,.18)"/><rect x="200" y="300" width="240" height="120" rx="60" fill="hsla(${hue},60%,70%,.18)"/>
<text x="24" y="456" font-family="monospace" font-size="22" fill="#2EE0AC">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const src = (kind: 'search' | 'url' | 'manual' | 'humint', ref: string | undefined, r: string, c: string, at: string) => ({
  kind, ref, reliability: r as 'A', credibility: c as '1', capturedAt: t(at),
});

export const seedDossiers: Dossier[] = [
  {
    id: 'd-petrov',
    ownerId: U_ME,
    kind: 'person',
    title: 'Петров Аркадий Сергеевич',
    summaryMd:
      '**Директор** ООО «Северный ветер» с 2019 г. Ранее — замначальника отдела закупок администрации г. Энска.\n\n' +
      '- Активен в Telegram под ником `@arkady_n`\n- Владеет двумя автомобилями (см. снимок поиска)\n\n' +
      '> Связь с [@Соколова И. В.](/dossiers/d-sokolova) подтверждается двумя независимыми источниками.',
    tags: ['закупки', 'Энск', 'ключевая фигура'],
    visibility: 'shared',
    shares: [{ userId: U_COLLEAGUE, displayName: 'Коллега', role: 'viewer' }],
    memberIds: [],
    coverMediaUrl: photo('PETROV_A_S.jpg', 160),
    version: 3,
    updatedAt: t('2026-10-02T18:20:00Z'),
    items: [
      { id: 'it-1', type: 'attribute', key: 'bdays', label: 'Дата рождения', value: '14.03.1979', position: 0, createdAt: t('2026-09-28'), source: src('search', 's-demo', 'B', '2', '2026-09-28') },
      { id: 'it-2', type: 'attribute', key: 'phones', label: 'Телефон', value: '+7 900 123-45-67', position: 1, createdAt: t('2026-09-28'), source: src('search', 's-demo', 'B', '2', '2026-09-28') },
      { id: 'it-3', type: 'attribute', key: 'emails', label: 'Email', value: 'a.petrov@mail.example', position: 2, createdAt: t('2026-09-28'), source: src('search', 's-demo', 'C', '3', '2026-09-28') },
      { id: 'it-4', type: 'attribute', key: 'works', label: 'Работа', value: 'ООО «Северный ветер», директор', position: 3, createdAt: t('2026-09-29'), source: src('url', 'https://egrul.example/7701234567', 'A', '1', '2026-09-29') },
      { id: 'it-5', type: 'link', url: 'https://vk.com/id000000001', title: 'Аркадий Петров', platform: 'vk', position: 4, createdAt: t('2026-09-29') },
      { id: 'it-6', type: 'link', url: 'https://t.me/arkady_n', title: '@arkady_n', platform: 'telegram', position: 5, createdAt: t('2026-09-29') },
      { id: 'it-7', type: 'media', mediaId: 'm-1', url: photo('vk_avatar_2024.jpg', 160), caption: 'Аватар VK, 2024', album: 'Соцсети', position: 6, createdAt: t('2026-09-29') },
      { id: 'it-8', type: 'media', mediaId: 'm-2', url: photo('corp_party_2023.jpg', 200), caption: 'Корпоратив «Северного ветра», 2023', album: 'Соцсети', position: 7, createdAt: t('2026-09-30') },
      { id: 'it-9', type: 'media', mediaId: 'm-3', url: photo('car_A123BC777.jpg', 30), caption: 'Автомобиль у офиса', album: 'Наблюдение', position: 8, createdAt: t('2026-10-01'), source: src('humint', 'Источник «Ворон»', 'C', '2', '2026-10-01') },
      { id: 'it-10', type: 'note', markdown: '### Беседа с источником «Ворон», 01.10\n\nПо словам источника, Петров **лично** согласовывает все контракты свыше 5 млн ₽.\n\n- [ ] Проверить по ЕИС\n- [x] Сверить номер авто', position: 9, createdAt: t('2026-10-01'), source: src('humint', 'Источник «Ворон»', 'C', '3', '2026-10-01') },
      { id: 'it-11', type: 'snapshot', searchId: 's-demo', section: 'attr', kind: 'phone', query: '+7 900 123-45-67', deep: true, summary: '4 утечки, 23 связанных значения', position: 10, createdAt: t('2026-09-28') },
    ],
  },
  {
    id: 'd-sokolova',
    ownerId: U_ME,
    kind: 'person',
    title: 'Соколова Ирина Викторовна',
    summaryMd: 'Учредитель ИП-подрядчика. Однокурсница Петрова (ЭГУ, 2001).',
    tags: ['Энск', 'подрядчик'],
    visibility: 'private',
    shares: [],
    memberIds: [],
    coverMediaUrl: photo('SOKOLOVA_I_V.jpg', 300),
    version: 1,
    updatedAt: t('2026-10-01T10:00:00Z'),
    items: [
      { id: 'it-20', type: 'attribute', key: 'inns', label: 'ИНН', value: '770000000001', position: 0, createdAt: t('2026-10-01') },
      { id: 'it-21', type: 'link', url: 'https://ok.ru/profile/000000002', title: 'Ирина Соколова', platform: 'ok', position: 1, createdAt: t('2026-10-01') },
    ],
  },
  {
    id: 'd-group-sv',
    ownerId: U_ME,
    kind: 'group',
    title: 'Руководство ООО «Северный ветер»',
    summaryMd: 'Группа лиц, связанных с управлением компанией.',
    tags: ['закупки'],
    visibility: 'private',
    shares: [],
    memberIds: ['d-petrov', 'd-sokolova'],
    coverMediaUrl: null,
    version: 1,
    updatedAt: t('2026-09-30T09:00:00Z'),
    items: [],
  },
  {
    id: 'd-colleague-1',
    ownerId: U_COLLEAGUE,
    kind: 'person',
    title: 'Морозов Олег Андреевич',
    summaryMd: 'Досье коллеги, открытое мне на редактирование.',
    tags: ['логистика'],
    visibility: 'shared',
    shares: [{ userId: U_ME, displayName: 'Следопыт', role: 'editor' }],
    memberIds: [],
    coverMediaUrl: photo('MOROZOV_O_A.jpg', 90),
    version: 1,
    updatedAt: t('2026-09-25T09:00:00Z'),
    items: [],
  },
];

export const seedInvestigations: Investigation[] = [
  {
    id: 'i-zakupki',
    ownerId: U_ME,
    title: 'Подрядчики администрации г. Энска',
    descriptionMd: 'Проверка аффилированности подрядчиков, выигрывающих контракты на благоустройство в 2022–2025 гг.',
    tags: ['закупки', 'Энск'],
    visibility: 'shared',
    shares: [{ userId: U_COLLEAGUE, displayName: 'Коллега', role: 'editor' }],
    version: 5,
    updatedAt: t('2026-10-03T21:00:00Z'),
    nodes: [
      { id: 'n-petrov', type: 'person', label: 'Петров А. С.', dossierId: 'd-petrov', props: { role: 'Директор' }, position: { x: 0, y: 0 } },
      { id: 'n-sokolova', type: 'person', label: 'Соколова И. В.', dossierId: 'd-sokolova', props: {}, position: { x: 380, y: -40 } },
      { id: 'n-sv', type: 'organization', label: 'ООО «Северный ветер»', dossierId: null, props: { inn: '7701234567' }, position: { x: -60, y: 220 } },
      { id: 'n-ip', type: 'organization', label: 'ИП Соколова', dossierId: null, props: {}, position: { x: 420, y: 200 } },
      { id: 'n-adm', type: 'organization', label: 'Администрация г. Энска', dossierId: null, props: {}, position: { x: 180, y: 420 } },
      { id: 'n-tender', type: 'event', label: 'Тендер № 0148-22 (благоустройство)', dossierId: null, props: { date: '2022-05-17' }, position: { x: 460, y: 420 } },
      { id: 'n-car', type: 'asset', label: 'Авто А123ВС777', dossierId: null, props: {}, position: { x: -300, y: 40 } },
    ],
    edges: [
      { id: 'e-1', source: 'n-petrov', target: 'n-sv', relation: 'руководит', credibility: '1', factIds: ['f-1'] },
      { id: 'e-2', source: 'n-sokolova', target: 'n-ip', relation: 'владеет', credibility: '1', factIds: [] },
      { id: 'e-3', source: 'n-petrov', target: 'n-sokolova', relation: 'знакомы', label: 'однокурсники', credibility: '2', factIds: ['f-2'] },
      { id: 'e-4', source: 'n-ip', target: 'n-tender', relation: 'победитель', credibility: '1', factIds: ['f-3'] },
      { id: 'e-5', source: 'n-adm', target: 'n-tender', relation: 'заказчик', credibility: '1', factIds: [] },
      { id: 'e-6', source: 'n-petrov', target: 'n-adm', relation: 'работал', label: '2014–2019', credibility: '2', factIds: [] },
      { id: 'e-7', source: 'n-petrov', target: 'n-car', relation: 'пользуется', credibility: '3', factIds: [] },
    ],
    facts: [
      { id: 'f-1', textMd: 'Петров А. С. — директор ООО «Северный ветер» с 12.02.2019 (выписка ЕГРЮЛ).', occurredAt: t('2019-02-12'), sources: [src('url', 'https://egrul.example/7701234567', 'A', '1', '2026-09-29')], nodeIds: ['n-petrov', 'n-sv'], createdAt: t('2026-09-29') },
      { id: 'f-2', textMd: 'Петров и Соколова учились в одной группе ЭГУ (выпуск 2001) — совпадение в утечке студенческой базы.', occurredAt: t('2001-06-30'), sources: [src('search', 's-demo', 'C', '2', '2026-09-30')], nodeIds: ['n-petrov', 'n-sokolova'], createdAt: t('2026-09-30') },
      { id: 'f-3', textMd: 'ИП Соколова выиграло тендер № 0148-22 при единственной заявке.', occurredAt: t('2022-05-17'), sources: [src('url', 'https://zakupki.example/0148-22', 'A', '1', '2026-10-01')], nodeIds: ['n-ip', 'n-tender'], createdAt: t('2026-10-01') },
      { id: 'f-4', textMd: 'Источник «Ворон»: Петров лично согласовывает контракты свыше 5 млн ₽.', occurredAt: null, sources: [src('humint', 'Источник «Ворон»', 'C', '3', '2026-10-01')], nodeIds: ['n-petrov', 'n-adm'], createdAt: t('2026-10-01') },
    ],
    hypotheses: [
      { id: 'h-1', title: 'ИП Соколова — номинальный подрядчик Петрова', textMd: 'Петров, используя связи в администрации, обеспечивает победу ИП Соколовой в тендерах.', status: 'supported', evidence: [{ factId: 'f-2', stance: 'supports' }, { factId: 'f-3', stance: 'supports' }, { factId: 'f-4', stance: 'supports' }], createdAt: t('2026-10-01') },
      { id: 'h-2', title: 'Совпадение случайно', textMd: 'Знакомство не связано с результатами тендеров.', status: 'open', evidence: [], createdAt: t('2026-10-02') },
    ],
  },
  {
    id: 'i-public',
    ownerId: U_COLLEAGUE,
    title: 'Сеть фиктивных автошкол',
    descriptionMd: 'Публичное расследование коллеги: связи учредителей сети автошкол.',
    tags: ['публичное'],
    visibility: 'public',
    shares: [],
    version: 2,
    updatedAt: t('2026-09-20T12:00:00Z'),
    nodes: [
      { id: 'p-1', type: 'person', label: 'Волков И. П.', dossierId: null, props: {}, position: { x: 0, y: 0 } },
      { id: 'p-2', type: 'organization', label: 'Автошкола «Старт»', dossierId: null, props: {}, position: { x: 300, y: 0 } },
      { id: 'p-3', type: 'organization', label: 'Автошкола «Финиш»', dossierId: null, props: {}, position: { x: 300, y: 160 } },
    ],
    edges: [
      { id: 'pe-1', source: 'p-1', target: 'p-2', relation: 'учредитель', credibility: '1', factIds: [] },
      { id: 'pe-2', source: 'p-1', target: 'p-3', relation: 'учредитель', credibility: '2', factIds: [] },
    ],
    facts: [],
    hypotheses: [],
  },
];

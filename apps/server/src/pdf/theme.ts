import type { CustomTableLayout } from 'pdfmake/interfaces';

// Общее для сборки отчёта (главный поток) и вёрстки (воркер pdf/worker.ts).
// Содержимое отчёта уходит в воркер через structuredClone, поэтому в нём не может быть функций:
// раскладки таблиц заданы по имени и регистрируются в воркере (pdfmake.addTableLayouts).

export const APP = 'RuLeaks.Следопыт';
export const MINT = '#0f7a5c';

export const TABLE_LAYOUTS: Record<string, CustomTableLayout> = {
  /** Цитата Markdown: зелёная полоса слева, без прочих линий. */
  ftQuote: {
    hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 2 : 0), vLineColor: () => '#9fd9c6',
    paddingLeft: () => 8, paddingTop: () => 2, paddingBottom: () => 0,
  },
  /** Блок кода Markdown: серая подложка. */
  ftCode: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => '#f2f4f3' },
  /**
   * Карточка утечки (результат поиска по атрибутам): рамка, шапка с подложкой, записи разделены тонкой серой
   * чертой — как на странице.
   */
  ftCard: {
    hLineWidth: () => 0.6,
    vLineWidth: (i, node) => (i === 0 || i === node.table.widths!.length ? 0.6 : 0),
    hLineColor: (i, node) => (i <= 1 || i === node.table.body.length ? '#b5d8cb' : '#e2e2e2'),
    vLineColor: () => '#b5d8cb',
    fillColor: (row) => (row === 0 ? '#eaf6f1' : null),
    paddingLeft: () => 8,
    paddingRight: () => 8,
    paddingTop: (i) => (i === 0 ? 5 : 6),
    paddingBottom: (i) => (i === 0 ? 5 : 6),
  },
  /** Карточка атрибута глубокого поиска: рамка и шапка как у ftCard, значения без черты между ними. */
  ftCardList: {
    hLineWidth: (i, node) => (i <= 1 || i === node.table.body.length ? 0.6 : 0),
    vLineWidth: (i, node) => (i === 0 || i === node.table.widths!.length ? 0.6 : 0),
    hLineColor: () => '#b5d8cb',
    vLineColor: () => '#b5d8cb',
    fillColor: (row) => (row === 0 ? '#eaf6f1' : null),
    paddingLeft: () => 8,
    paddingRight: () => 8,
    paddingTop: (i) => (i === 0 ? 5 : i === 1 ? 5 : 1.5),
    paddingBottom: (i, node) => (i === 0 ? 5 : i === node.table.body.length - 1 ? 5 : 1.5),
  },
  /** Строки «атрибут — значение» внутри записи: без линий, плотно. */
  ftPairs: {
    hLineWidth: () => 0,
    vLineWidth: () => 0,
    paddingLeft: () => 0,
    paddingRight: () => 6,
    paddingTop: () => 1.5,
    paddingBottom: () => 1.5,
  },
  /** Тепловая карта активности по часам: 24 узкие колонки, линия только под заголовком. */
  ftHeat: {
    hLineWidth: (i) => (i === 1 ? 0.8 : 0),
    vLineWidth: () => 0,
    paddingLeft: () => 0.5,
    paddingRight: () => 0.5,
    paddingTop: () => 2.5,
    paddingBottom: () => 2.5,
  },
};

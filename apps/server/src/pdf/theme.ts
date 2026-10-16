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

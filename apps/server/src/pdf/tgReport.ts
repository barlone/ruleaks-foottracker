import type { Content } from 'pdfmake/interfaces';
import {
  TG_PDF_MAX, WEEK_DAYS, findTgMode, fulltextHighlight, highlightParts, tgTimeToIso,
  type FtHighlight, type SearchJob, type TgComment, type TgGroup, type TgMonthActivity, type TgPdfRequest, type TgUserMsgs, type TgWeekActivity,
} from '@ft/shared';
import type { Deps } from '../ports.ts';
import { EMOJI_FONT, emojiRuns, hasEmoji, withEmoji } from './emoji.ts';
import { clean } from './markdown.ts';
import { Report } from './report.ts';

// PDF-отчёт по результату поиска в Telegram — по образцу HTML-отчётов бота (template_tgcomments / tglikes):
// сообщения по группам (один пользователь) или по авторам (реакции, ответы, полнотекстовый поиск),
// у сообщения — группа, время (UTC, как в интерфейсе), ссылка, на что ответ, текст, реакции с временем.
// Активность — таблицами. В полнотекстовом поиске найденные слова подсвечены, как на сайте.
// Эмодзи остаются (шрифт NotoEmoji, emoji.ts) — clean() из отчёта досье их вырезает, здесь он только для заголовков.


const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const DAYS_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const HIGHLIGHT_BG = '#f2d27a';
/** Цитата, на которую отвечали, — до 500 символов (на сайте она тоже сокращена). */
const QUOTE_MAX = 500;
/** Сообщение короче — неразрывный блок; длиннее — может переходить на следующую страницу
 *  (неразрывный блок выше страницы pdfmake не может разместить и теряет). */
const UNBREAKABLE_MAX = 1200;
const ckey = (c: TgComment) => `${c.grp_id}:${c.msg_id}`;

class TgReport {
  private hl: FtHighlight | undefined;

  constructor(private r: Report, job: SearchJob) {
    this.hl = findTgMode(job.kind)?.input === 'text' ? fulltextHighlight(job.query) : undefined;
  }

  private time(s: string | null | undefined): string {
    const iso = tgTimeToIso(s);
    return iso ? this.r.utc(iso) : (s ?? '');
  }

  /** Текст сообщения: подсветка найденных слов (полнотекстовый поиск) и эмодзи отдельным шрифтом. */
  private text(text: string): Content {
    if (!this.hl) return withEmoji(text);
    return { text: highlightParts(text, this.hl).flatMap((p) => emojiRuns(p.text, p.hit ? { background: HIGHLIGHT_BG, bold: true } : {})) };
  }

  message(c: TgComment, group: TgGroup | undefined): Content {
    const head: Content = {
      text: [
        ...emojiRuns(group?.name ?? `группа ${c.grp_id}`, { bold: true, color: '#0f7a5c' }),
        { text: `  ·  ${this.time(c.dt)}  ·  `, color: '#666' },
        { text: `#${c.msg_id}`, link: c.url, color: '#1a5fb4', decoration: 'underline' },
      ],
      fontSize: 8,
      margin: [0, 0, 0, 2],
    };
    const parts: Content[] = [head];
    if (c.r2text) {
      const quote = c.r2text.length > QUOTE_MAX ? `${c.r2text.slice(0, QUOTE_MAX).trimEnd()}…` : c.r2text;
      parts.push({ ...(withEmoji(`↪ ${quote}`) as object), style: 'quote', margin: [6, 0, 0, 2] } as Content);
    }
    parts.push(this.text(c.text));
    if (c.likes?.length) {
      // Реакции — под сообщением, как в отчёте бота: эмодзи крупно и время реакции.
      parts.push({
        text: [
          { text: `Реакции (${c.likes.length}):  `, color: '#666', fontSize: 8 },
          ...c.likes.flatMap((l, i) => [
            ...(i ? [{ text: '   ' }] : []),
            { text: l.emoji, font: hasEmoji(l.emoji) ? EMOJI_FONT : undefined, fontSize: 14 },
            { text: ` ${this.time(l.at)}`, color: '#555', fontSize: 8 },
          ]),
        ],
        margin: [0, 3, 0, 0],
      });
    }
    const short = c.text.length + Math.min(c.r2text.length, QUOTE_MAX) < UNBREAKABLE_MAX;
    return { stack: parts, margin: [0, 0, 0, 7], unbreakable: short };
  }

  /** Заголовок раздела не остаётся один внизу страницы: склеен с первым сообщением (если оно короткое). */
  private section(header: Content, msgs: Content[]): Content[] {
    const [first, ...rest] = msgs;
    if (!first) return [header];
    const keep = (first as { unbreakable?: boolean }).unbreakable;
    return keep ? [{ stack: [header, first], unbreakable: true }, ...rest] : [header, ...msgs];
  }

  /** Сообщения одного пользователя по группам (режим «Комментарии»). */
  byGroup(comments: TgComment[], groups: TgGroup[]): Content[] {
    const byId = new Map(groups.map((g) => [g.grp_id, g]));
    const order = new Map<number, TgComment[]>();
    for (const c of comments) order.set(c.grp_id, [...(order.get(c.grp_id) ?? []), c]);
    return [...order].flatMap(([gid, list]) =>
      this.section(
        { ...(withEmoji(`${byId.get(gid)?.name ?? `группа ${gid}`} · ${list.length}`) as object), style: 'h2', headlineLevel: 1 } as Content,
        list.map((c) => this.message(c, byId.get(gid))),
      ),
    );
  }

  /** Многопользовательский результат — раздел на автора. */
  byUser(users: TgUserMsgs[]): Content[] {
    return users.flatMap((u) => {
      const id = String(u.user?.id ?? '');
      const name = [u.user?.names?.[0], u.user?.niks?.[0] && `@${u.user.niks[0]}`, id && `ID ${id}`].filter(Boolean).join(' · ');
      const byId = new Map((u.groups ?? []).map((g) => [g.grp_id, g]));
      return this.section(
        { ...(withEmoji(`${name || 'неизвестный автор'} · ${u.comments?.length ?? 0}`) as object), style: 'h2', headlineLevel: 1 } as Content,
        (u.comments ?? []).map((c) => this.message(c, byId.get(c.grp_id))),
      );
    });
  }

  month(years: TgMonthActivity): Content[] {
    const ys = Object.keys(years).sort();
    const rows = ys.map((y) => {
      const row = years[y] ?? {};
      const total = Object.values(row).reduce((a, b) => a + b, 0);
      return [{ text: y, bold: true }, ...MONTHS.map((_, i) => ({ text: String(row[String(i + 1)] ?? '') , alignment: 'center' as const })), { text: String(total), bold: true, alignment: 'right' as const }];
    });
    return [
      { text: 'Комментарии по месяцам', style: 'h2' },
      {
        table: { headerRows: 1, widths: [30, ...MONTHS.map(() => '*'), 34], body: [[{ text: 'Год', style: 'th' }, ...MONTHS.map((m) => ({ text: m, style: 'th', alignment: 'center' as const })), { text: 'всего', style: 'th', alignment: 'right' as const }], ...rows] },
        layout: 'lightHorizontalLines',
        fontSize: 8,
      },
    ];
  }

  week(years: TgWeekActivity): Content[] {
    const ys = Object.keys(years).sort();
    const grid = WEEK_DAYS.map((d) => Array.from({ length: 24 }, (_, h) => ys.reduce((s, y) => s + (years[y]?.[d]?.[h] ?? 0), 0)));
    const max = Math.max(0, ...grid.flat());
    const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((s, row) => s + row[h]!, 0));
    const quiet = byHour
      .map((_, start) => ({ start, sum: Array.from({ length: 6 }, (_, k) => byHour[(start + k) % 24]!).reduce((a, b) => a + b, 0) }))
      .reduce((best, w) => (w.sum < best.sum ? w : best)).start;
    // Тепловая карта: чем больше сообщений, тем насыщеннее фон. Прозрачность — fillOpacity
    // (цвет #rrggbbaa PDF не понимает); на тёмном фоне — белые цифры.
    const cell = (v: number): Content => {
      const k = v && max ? v / max : 0;
      return {
        text: v ? String(v) : '',
        alignment: 'center',
        ...(k ? { fillColor: '#0f7a5c', fillOpacity: 0.12 + k * 0.8, color: k > 0.55 ? '#ffffff' : '#222222' } : {}),
      };
    };
    return [
      { text: `Активность по дням недели и часам${ys.length ? ` (${ys.join(', ')})` : ''}`, style: 'h2' },
      {
        // 24 колонки должны поместиться в ширину A4 (515 pt): узкие поля и фиксированная ширина.
        table: {
          headerRows: 1,
          widths: [14, ...Array.from({ length: 24 }, () => 18.5)],
          body: [[{ text: '', style: 'th' }, ...Array.from({ length: 24 }, (_, h) => ({ text: String(h), style: 'th', alignment: 'center' as const }))], ...grid.map((row, d) => [{ text: DAYS_RU[d]!, bold: true }, ...row.map(cell)])],
        },
        layout: 'ftHeat',
        fontSize: 6.5,
      },
      { text: `Самые тихие часы: ${quiet}:00–${(quiet + 6) % 24}:00 (UTC). Ночной провал подсказывает часовой пояс и режим сна.`, style: 'muted', margin: [0, 6, 0, 0] },
    ];
  }
}

/** Отчёт по снимку поиска в Telegram; only — ключи отмеченных сообщений (иначе все, не больше TG_PDF_MAX). */
export async function tgSearchPdf(deps: Deps, userId: string, job: SearchJob, req: TgPdfRequest) {
  const r = new Report(deps, userId, { ...req, id: job.id, options: { photos: false, related: false, sources: false } });
  const t = new TgReport(r, job);
  const mode = findTgMode(job.kind)!;
  const res = ((job.result as { job?: Record<string, unknown> } | null)?.job ?? {}) as Record<string, unknown>;
  const only = req.only?.length ? new Set(req.only) : null;
  const pick = (list: TgComment[] | undefined) => (list ?? []).filter((c) => !only || only.has(ckey(c)));

  let body: Content[] = [];
  let total = 0;
  let included = 0;
  if (mode.result === 'comments') {
    const all = pick(res.comments as TgComment[] | undefined);
    total = all.length;
    const list = all.slice(0, TG_PDF_MAX);
    included = list.length;
    body = list.length ? t.byGroup(list, (res.groups as TgGroup[] | undefined) ?? []) : [{ text: 'Сообщений нет', style: 'muted' }];
  } else if (mode.result === 'multi') {
    const users: TgUserMsgs[] = [];
    for (const u of (res.users as TgUserMsgs[] | undefined) ?? []) {
      const list = pick(u.comments);
      total += list.length;
      const room = TG_PDF_MAX - included;
      if (list.length && room > 0) {
        users.push({ ...u, comments: list.slice(0, room) });
        included += Math.min(room, list.length);
      }
    }
    body = users.length ? t.byUser(users) : [{ text: 'Сообщений нет', style: 'muted' }];
  } else if (mode.result === 'month') {
    body = t.month((res.years as TgMonthActivity | undefined) ?? {});
  } else {
    body = t.week((res.years as TgWeekActivity | undefined) ?? {});
  }

  const who = job.params.tgid ? `ID ${job.params.tgid}${job.params.via && job.params.via !== 'id' ? ` (найден по ${job.params.via})` : ''}` : null;
  const title = `${mode.label}: ${job.query}`;
  const extra: [string, Content][] = [
    ['Режим', { text: mode.label }],
    [mode.input === 'text' ? 'Выражение' : 'Запрос', { text: clean(job.query) }],
    ...(who ? [['Пользователь', { text: who }] as [string, Content]] : []),
    ['Поиск выполнен', { text: r.dateTime(job.startedAt) }],
    ...(mode.result === 'comments' || mode.result === 'multi'
      ? [[
          'Сообщений',
          {
            text: `${included}${included < total ? ` из ${total} (в отчёт входит не больше ${TG_PDF_MAX})` : ''}${only ? ' — только отмеченные' : ''}${res.truncated ? '; шлюз вернул не все сообщения' : ''}. Время — UTC.`,
          },
        ] as [string, Content]]
      : []),
  ];
  return r.render(title, 'search', [{ text: clean(title), style: 'h1', margin: [0, 0, 0, 8] }, ...body], extra);
}

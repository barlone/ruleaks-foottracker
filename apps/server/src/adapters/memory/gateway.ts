import { WEEK_DAYS, type DeepRow, type FuzzyMatch, type LeakCard, type TgComment, type TgGroup, type TgUserMsgs } from '@ft/shared';
import type { GatewayAnswer, SearchGateway } from '../../ports.ts';

// Имитация dsstalker-api-gate: raw-поиск отвечает в синхронном окне,
// тяжёлые (deep, маски, Telegram) возвращают need-db-request и «досчитываются» за ~3 с.
// Данные вымышленные и строятся из запроса, чтобы интерфейс было на чём смотреть.

const SYNC_WINDOW_MS = 2000;
const HEAVY_DURATION_MS = 3000;

interface FakeJob {
  doneAt: number;
  result: unknown;
}

export class MemoryGateway implements SearchGateway {
  private jobs = new Map<string, FakeJob>();
  private seq = Date.now();

  async start(_token: string, path: string, params: Record<string, string>): Promise<GatewayAnswer> {
    const jobId = String(++this.seq);
    const query = Object.values(params)[0] ?? '';
    const job = (body: object) => ({ job: { id: jobId, state: 'done', ...body } });

    if (path.includes('raw_search')) {
      await sleep(400 + Math.random() * 600);
      const leaks = params.lat && params.lon ? fakeLocLeaks(Number(params.lat), Number(params.lon), Number(params.radius)) : fakeLeaks(query);
      return { state: 'done', jobId, result: job({ leaks }) };
    }

    let result: unknown;
    if (path.includes('deep_search')) result = job({ rows: fakeDeep(query) });
    else if (path.includes('regexp_search')) result = job({ results: fakeFuzzy(query, path.includes('plates'), params.vehicpart) });
    else if (path.endsWith('comments.month_activity')) result = job({ years: fakeMonthActivity(query) });
    else if (path.endsWith('comments.week_activity')) result = job({ years: fakeWeekActivity(query) });
    // Шлюз: одиночный ответ (groups + comments) — только у comments.get, остальные — users[].
    else if (path.endsWith('comments.answers_to_him') || path.endsWith('comments.fulltext_search') || path.endsWith('comments.his_answers')) {
      result = job({ users: fakeMultiUser(query) });
    }
    // Как у шлюза: реакции сгруппированы по авторам сообщений, на которые реагировал пользователь.
    else if (path.endsWith('comments.likes')) result = job({ users: fakeMultiUser(query, true) });
    else if (path.includes('/tgcmnts/')) result = job(fakeOneUser(query));
    else return { state: 'failed', jobId: null, error: `Неизвестный путь ${path}` };

    this.jobs.set(jobId, { doneAt: Date.now() + HEAVY_DURATION_MS, result });
    await sleep(SYNC_WINDOW_MS / 4);
    return { state: 'running', jobId };
  }

  async poll(_token: string, _service: 'ruleaks' | 'tgcmnts', jobId: string): Promise<GatewayAnswer> {
    const job = this.jobs.get(jobId);
    if (!job) return { state: 'failed', jobId, error: 'Результат устарел, повторите запрос', code: 8 };
    if (job.doneAt > Date.now()) return { state: 'running', jobId };
    return { state: 'done', jobId, result: job.result };
  }

  /** dev: ник с «none» — не найден, с «multi» — несколько ID (проверка выбора), иначе один. */
  async tgIdsByNik(_token: string, nik: string): Promise<string[]> {
    await sleep(200);
    if (/none/i.test(nik)) return [];
    const h = hash(nik.toLowerCase());
    const id = (k: number) => String(100000000 + ((h >>> k) % 900000000));
    return /multi/i.test(nik) ? [id(0), id(3), id(7)] : [id(0)];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const SURNAMES = ['Петров', 'Соколов', 'Кузнецов', 'Морозов', 'Волков', 'Лебедев'];
const NAMES = ['Аркадий', 'Сергей', 'Дмитрий', 'Олег', 'Игорь', 'Павел'];
const PATRS = ['Сергеевич', 'Андреевич', 'Викторович', 'Олегович'];
const LEAKS = ['Доставка еды 2022', 'Маркетплейс 2023', 'Страховая 2021', 'Автосервис 2020', 'Онлайн-кинотеатр 2022'];

function fakeName(seed: number) {
  return `${SURNAMES[seed % SURNAMES.length]} ${NAMES[(seed >>> 2) % NAMES.length]} ${PATRS[(seed >>> 4) % PATRS.length]}`;
}

// ---------- Поиск по атрибутам ----------

function fakeLeaks(query: string): LeakCard[] {
  const h = hash(query);
  const pick = <T,>(arr: T[], k: number) => arr[(h >>> k) % arr.length]!;
  const name = `${pick(SURNAMES, 1)} ${pick(NAMES, 4)} ${pick(PATRS, 7)}`;
  const phone = `+7 9${String(h % 100).padStart(2, '0')} ${String(h % 1000).padStart(3, '0')}-${String((h >>> 3) % 100).padStart(2, '0')}-${String((h >>> 5) % 100).padStart(2, '0')}`;
  const email = `${pick(['arkadiy', 'sokol', 'kuzya', 'moroz'], 2)}${h % 97}@mail.example`;
  const count = 2 + (h % 3);
  return Array.from({ length: count }, (_, i) => ({
    leak: LEAKS[(h + i) % LEAKS.length]!,
    trusted: i === 0 ? true : undefined,
    tuples: [
      {
        tuple: (h % 100000) * 10 + i,
        names: [name],
        bdays: i % 2 === 0 ? [`${(h % 28) + 1}.0${(h % 9) + 1}.198${h % 10}`] : undefined,
        phones: [phone],
        emails: i !== 1 ? [email] : undefined,
        addrs: i === 1 ? ['г. Энск, ул. Примерная, д. 7, кв. 12'] : undefined,
        tgids: i !== 1 ? [String(100000000 + (h % 900000000))] : undefined,
        plates: i === 0 && h % 2 ? ['А123ВС777'] : undefined,
        works: i === 1 ? ['ООО «Северный ветер»'] : undefined,
        // Идентификаторы — для дополнительного поиска вторым шагом.
        inns: i === 0 ? [String(770000000000 + (h % 1000000))] : undefined,
        snilss: i === 2 ? [String(10000000000 + (h % 90000000))] : undefined,
        pasps: i === 1 ? [String(4500000000 + (h % 1000000))] : undefined,
      },
      // У первой утечки — вторая запись (в реальных ответах записей в утечке обычно несколько).
      ...(i === 0
        ? [{ tuple: (h % 100000) * 10 + 9, names: [name], phones: [phone], addrs: ['г. Энск, пр. Мира, д. 3, кв. 41'], geolocs: ['55.7558, 37.6173', '55.7512, 37.6184 @500'], weblinks: ['https://example.com/u/' + (h % 1000)], ips: ['203.0.113.' + (h % 250)], regdates: ['14.06.2019'] }]
        : []),
    ],
  }));
}

/** raw_search.byloc_radius: те же записи, но геолокации — внутри круга. */
function fakeLocLeaks(lat: number, lon: number, radiusM: number): LeakCard[] {
  const leaks = fakeLeaks(`${lat},${lon}`);
  let k = 0;
  for (const card of leaks) for (const t of card.tuples ?? []) {
    const r = (radiusM * ((k * 37) % 90 + 5)) / 100 / 111_320;
    const a = k++ * 2.4;
    t.geolocs = [`${(lat + r * Math.sin(a)).toFixed(6)}, ${(lon + (r * Math.cos(a)) / Math.cos((lat * Math.PI) / 180)).toFixed(6)} @${50 + (k % 4) * 100}`];
  }
  return leaks;
}

function fakeDeep(query: string): DeepRow[] {
  const leaks = fakeLeaks(query);
  const rows: DeepRow[] = [];
  let id = 1;
  for (const card of leaks) {
    for (const t of card.tuples ?? []) {
      for (const [prm, vals] of Object.entries(t)) {
        if (prm === 'tuple' || prm === 'step2' || !Array.isArray(vals)) continue;
        for (const val of vals as string[]) rows.push({ prm, val, val_id: id++, link4: query, link4_id: 0 });
      }
    }
  }
  rows.push({ prm: 'phones', val: '+7 900 000-11-22', val_id: id++, link4: rows[0]?.prm ?? query, link4_id: 1 });
  return rows;
}

// ---------- Нечёткий поиск ----------

function fakeFuzzy(mask: string, plates: boolean, vehicpart?: string): FuzzyMatch[] {
  const h = hash(mask);
  const fill = (i: number) =>
    mask.replace(/\?/g, (_, k: number) => String(((h >>> ((i + k) % 11)) + i) % 10)).replace(/\*/g, plates ? '' : ['mail', 'yandex', 'gmail'][i % 3]!);
  return Array.from({ length: 4 + (h % 5) }, (_, i) => {
    const n = fakeName(h + i);
    return plates
      ? { match: fill(i), names: i % 3 ? [n] : undefined, vehicles: [`${vehicpart || ['LADA', 'BMW', 'KIA', 'TOYOTA'][i % 4]} ${['Vesta', 'X5', 'Rio', 'Camry'][i % 4]}, 20${10 + (i % 14)}`] }
      : { match: fill(i), names: [n], addrs: i % 2 ? ['г. Энск, ул. Примерная, д. 7'] : undefined, infos: i === 0 ? ['регистрация 2019'] : undefined };
  });
}

// ---------- Telegram ----------

const GROUPS: TgGroup[] = [
  { grp_id: 1001, name: 'Новости Энска', url: 'https://t.me/ensk_news', color: 1 },
  { grp_id: 1002, name: 'Барахолка Энск', url: 'https://t.me/ensk_market', color: 2 },
  { grp_id: 1003, name: 'Автомобилисты 77', url: 'https://t.me/auto77', color: 3 },
];
const PHRASES = [
  'Кто знает, что за стройка на Примерной?', 'Подрядчик опять тот же, удивительно.', 'Продам зимнюю резину R17, недорого.',
  'Тендер выиграли за день до окончания приёма заявок.', 'Пробка на въезде, объезжайте через промзону.', 'Это всё согласовано заранее, не сомневайтесь.',
  'Видел их машину у администрации.', 'Спасибо, вопрос снят.',
];
const EMOJI = ['👍', '🔥', '😁', '👎', '🤔'];

function fakeComments(seed: number, userId: number, count: number, likes: boolean): TgComment[] {
  return Array.from({ length: count }, (_, i) => {
    const g = GROUPS[(seed + i) % GROUPS.length]!;
    const msg = 50000 + ((seed >>> 3) % 10000) + i * 7;
    const reply = i % 2 === 0;
    return {
      msg_id: msg,
      r2msg_id: reply ? msg - 3 : 0,
      grp_id: g.grp_id,
      usr_id: userId,
      // Как JSONTime шлюза: «ДД.ММ.ГГГГ ЧЧ:ММ:СС» в UTC.
      dt: gatewayTime(new Date(Date.UTC(2025, (seed + i) % 12, 1 + ((seed + i * 5) % 27), 6 + ((seed + i * 3) % 16), (i * 13) % 60))),
      url: `${g.url}/${msg}`,
      text: PHRASES[(seed + i) % PHRASES.length]!,
      r2text: reply ? PHRASES[(seed + i + 3) % PHRASES.length]! : '',
      likes: likes ? [{ emoji: EMOJI[(seed + i) % EMOJI.length]!, at: new Date(Date.UTC(2025, i % 12, 3 + i)).toISOString() }] : undefined,
    };
  }).sort((a, b) => sortableTime(b.dt).localeCompare(sortableTime(a.dt)));
}

const pad = (n: number) => String(n).padStart(2, '0');
function gatewayTime(d: Date): string {
  return `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
/** «ДД.ММ.ГГГГ ЧЧ:ММ:СС» → «ГГГГММДДЧЧММСС» для сортировки. */
const sortableTime = (s: string) => s.replace(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/, '$3$2$1$4$5$6');

function fakeOneUser(tgid: string) {
  const h = hash(tgid);
  return { groups: GROUPS, comments: fakeComments(h, Number(tgid) || 0, 9, false) };
}

function fakeMultiUser(query: string, likes = false): TgUserMsgs[] {
  const h = hash(query);
  return Array.from({ length: 3 }, (_, i) => {
    const id = 100000000 + ((h >>> i) % 900000000);
    return {
      user: { id, names: [fakeName(h + i)], niks: [['ensk_watcher', 'auto_lover', 'market_guy'][i]!] },
      groups: GROUPS,
      comments: fakeComments(h + i * 11, id, 2 + i, likes),
    };
  });
}

function fakeMonthActivity(tgid: string) {
  const h = hash(tgid);
  const years: Record<string, Record<string, number>> = {};
  for (const y of [2023, 2024, 2025]) {
    const row: Record<string, number> = {};
    for (let m = 1; m <= 12; m++) {
      row[m] = Math.max(0, Math.round(80 + 70 * Math.sin((m + (h % 12)) / 2) + ((h >>> m) % 60) - (y === 2023 ? 60 : 0)));
    }
    years[y] = row;
  }
  return years;
}

function fakeWeekActivity(tgid: string) {
  const h = hash(tgid);
  const shift = h % 3; // «часовой пояс»
  const years: Record<string, Record<string, number[]>> = {};
  for (const y of [2024, 2025]) {
    const days: Record<string, number[]> = {};
    WEEK_DAYS.forEach((d, di) => {
      const weekend = di >= 5;
      days[d] = Array.from({ length: 24 }, (_, hr) => {
        const t = (hr + shift) % 24;
        const awake = t >= 8 && t <= 23 ? 1 : t <= 1 ? 0.4 : 0.05;
        const peak = (weekend ? Math.exp(-((t - 14) ** 2) / 18) : Math.exp(-((t - 9) ** 2) / 4) + Math.exp(-((t - 21) ** 2) / 6)) * 30;
        return Math.round(awake * (4 + peak + ((h >>> (hr % 20)) % 5)));
      });
    });
    years[y] = days;
  }
  return years;
}

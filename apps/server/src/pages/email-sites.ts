import { readFileSync } from 'node:fs';
import { z } from 'zod';

// Сайты для проверки регистрации по e-mail. Основа — манифест проекта blackbird (email-data.json,
// обновляется npm run pages-email-update), к нему добавлены проверки в стиле holehe (EXTRA ниже).
// Идея обоих проектов одна: дёрнуть форму регистрации / восстановления пароля сайта с адресом и по
// ответу понять, занят ли e-mail. Описание сайта (как в blackbird):
//   uriCheck  — что запросить ({account} — адрес или его преобразование inputOp);
//   method/data/headers — особенности запроса (data — тело POST, {account} внутри тоже подставляется);
//   eCode + eString — «e-mail занят»: такой код ответа и такая строка в теле;
//   mCode + mString — «свободен»: такой код ответа или такая строка в теле;
//   inputOp   — преобразование адреса перед подстановкой (sha256 — например, Gravatar);
//   preCheck  — сначала сходить за cookie и подставить её значение в заголовки (плейсхолдер {<cookieName>_value}).

/** Описание почтового сайта в нашем виде. */
export interface EmailSite {
  name: string;
  urlMain: string;
  method: 'GET' | 'POST';
  uriCheck: string;
  data: string | null;
  headers: Record<string, string>;
  eCode: number;
  eString: string;
  mCode: number | null;
  mString: string | null;
  inputOp: 'sha256' | null;
  preCheck: { url: string; cookieName: string } | null;
  nsfw: boolean;
}

// --- Формат blackbird email-data.json (как лежит в файле, без изменений) ---

const PreCheck = z.object({ endpoint: z.string(), cookie_name: z.string() }).loose();

const RawEmailSite = z.looseObject({
  name: z.string().min(1),
  uri_check: z.string().min(1),
  method: z.enum(['GET', 'POST']).default('GET'),
  data: z.string().nullable().optional(),
  headers: z.record(z.string(), z.string()).nullable().optional(),
  e_code: z.number().int(),
  e_string: z.string(),
  m_code: z.number().int().nullable().optional(),
  m_string: z.string().nullable().optional(),
  input_operation: z.string().nullable().optional(),
  pre_check: PreCheck.nullable().optional(),
  cat: z.string().nullable().optional(),
});

function fromRaw(r: z.infer<typeof RawEmailSite>): EmailSite {
  const op = r.input_operation === 'hash-sha256' ? 'sha256' : null;
  if (r.input_operation && !op) throw new Error(`неизвестная операция input_operation: ${r.input_operation}`);
  return {
    name: r.name,
    urlMain: new URL(r.uri_check).origin,
    method: r.method,
    uriCheck: r.uri_check,
    data: r.data ?? null,
    headers: r.headers ?? {},
    eCode: r.e_code,
    eString: r.e_string,
    mCode: r.m_code ?? null,
    mString: r.m_string ?? null,
    inputOp: op,
    preCheck: r.pre_check ? { url: r.pre_check.endpoint, cookieName: r.pre_check.cookie_name } : null,
    nsfw: r.cat === 'xx NSFW xx',
  };
}

/** Разбирает манифест blackbird (объект с массивом sites). */
export function parseEmailSites(json: unknown): EmailSite[] {
  const doc = z.object({ sites: z.array(RawEmailSite) }).parse(json);
  return doc.sites.map(fromRaw);
}

export const EMAIL_SITES_FILE = new URL('./email-sites.json', import.meta.url);

// Проверки в стиле holehe, которых нет в манифесте blackbird. holehe — это ~120 отдельных модулей;
// сюда перенесены те, что выражаются тем же декларативным описанием и интересны для русскоязычного поиска.
// mail.ru: восстановление пароля отвечает JSON «status: 200», когда адрес зарегистрирован.
const EXTRA: EmailSite[] = [
  {
    name: 'Mail.ru',
    urlMain: 'https://mail.ru',
    method: 'POST',
    uriCheck: 'https://account.mail.ru/api/v1/user/password/restore',
    data: 'email={account}&htmlencoded=false',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Origin: 'https://account.mail.ru',
      Referer: 'https://account.mail.ru/recovery',
      'X-Requested-With': 'XMLHttpRequest',
    },
    eCode: 200,
    eString: '"status":200',
    mCode: null,
    mString: null,
    inputOp: null,
    preCheck: null,
    nsfw: false,
  },
];

let cache: EmailSite[] | null = null;

/** Все почтовые сайты: манифест blackbird + проверки holehe (EXTRA). */
export function allEmailSites(): EmailSite[] {
  cache ??= [...parseEmailSites(JSON.parse(readFileSync(EMAIL_SITES_FILE, 'utf8'))), ...EXTRA]
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return cache;
}

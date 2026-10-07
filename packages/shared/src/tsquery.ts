import { stemRu } from './stem.ts';

// Проверка выражения полнотекстового поиска по Telegram. Шлюз выполняет его в PostgreSQL как
// websearch_to_tsquery('russian', expression) (dsstalker-api-gate, service/tgcomments/db.go), поэтому правила —
// websearch-синтаксиса (https://www.postgresql.org/docs/current/textsearch-controls.html), а не to_tsquery:
//   слова через пробел — И;  or — ИЛИ;  -слово — НЕ;  "слова в кавычках" — фраза (слова подряд, <->).
// websearch_to_tsquery не выдаёт синтаксических ошибок: & | ! ( ) <-> : * для него — просто разделители,
// поэтому «(а | б) & в» молча превращается в «а И б И в». Это и ловит проверка.
// В сообщениях для пользователя — «поиск», а не «PostgreSQL».
// Приоритет как в tsquery: И связывает сильнее ИЛИ — «а б or в» = (а И б) ИЛИ в; скобок нет.
// Поведение сверено с PostgreSQL 18 (websearch_to_tsquery('russian', …)):
//   «-» перед словом — НЕ, даже через пробел («орлан - краснополь» = орлан И НЕ краснополь);
//   «or» в начале, в конце и подряд просто отбрасывается;
//   дефис перед цифрами режет слово: «о-30» → «о» (стоп-слово) и число «-30» — ищется только «-30».

/** Стоп-слова словаря russian (snowball, $SHAREDIR/tsearch_data/russian.stop) — PostgreSQL их отбрасывает. */
const RU_STOP = new Set(
  ('и в во не что он на я с со как а то все она так его но да ты к у же вы за бы по только ее мне было вот от меня еще ' +
    'нет о из ему теперь когда даже ну вдруг ли если уже или ни быть был него до вас нибудь опять уж вам ведь там потом ' +
    'себя ничего ей может они тут где есть надо ней для мы тебя их чем была сам чтоб без будто чего раз тоже себе под ' +
    'будет ж тогда кто этот того потому этого какой совсем ним здесь этом один почти мой тем чтобы нее сейчас были куда ' +
    'зачем всех никогда можно при наконец два об другой хоть после над больше тот через эти нас про всего них какая ' +
    'много разве три эту моя впрочем хорошо свою этой перед иногда лучше чуть том нельзя такой им более всегда конечно ' +
    'всю между').split(' '),
);

/** Минимум букв и цифр в выражении — меньше шлюз не принимает (fullTextMinLiterals). */
export const FULLTEXT_MIN_LITERALS = 3;

export interface FtTerm {
  /** Слово или фраза (слова фразы через пробел). */
  text: string;
  phrase: boolean;
  not: boolean;
  /** Слово целиком из стоп-слов — PostgreSQL его выбросит. */
  stop: boolean;
}

export interface FulltextCheck {
  /** Группы, объединённые ИЛИ; внутри группы — И. */
  groups: FtTerm[][];
  /** Как поймёт поиск (PostgreSQL), словами: «(орлан И краснополь) ИЛИ "о-30"». */
  explain: string;
  /** Поиск бессмысленен или шлюз его отклонит — кнопку блокируем. */
  errors: string[];
  /** Выражение выполнится, но, скорее всего, не так, как задумано. */
  warnings: string[];
}

// Слово для парсера PostgreSQL: буквы/цифры, внутри — дефис, точка, апостроф, @ («о-30», «и.о.», e-mail).
const WORD = /[\p{L}\p{N}_]+(?:[-.'@][\p{L}\p{N}_]+)*/uy;

export function checkFulltext(raw: string): FulltextCheck {
  const s = raw.toLowerCase();
  const errors: string[] = [];
  const warnings: string[] = [];

  const literals = [...s].filter((c) => /[\p{L}\p{N}]/u.test(c)).length;
  if (literals < FULLTEXT_MIN_LITERALS) errors.push(`Нужно хотя бы ${FULLTEXT_MIN_LITERALS} буквы или цифры`);

  // Символы-операторы to_tsquery, которые websearch_to_tsquery не понимает.
  const foreign: string[] = [];
  if (/\|/.test(s)) foreign.push('«|» — вместо него пишите or');
  if (/&/.test(s)) foreign.push('«&» — слова через пробел и так ищутся вместе');
  if (/!/.test(s)) foreign.push('«!» — для исключения ставьте минус перед словом: -слово');
  if (/[()]/.test(s)) foreign.push('скобки не группируют: «(а or б) в» пишите как «а в or б в»');
  if (/<\d*-?>|<->/.test(s)) foreign.push('«<->» — слова подряд ищутся фразой в кавычках: "а б"');
  if (/:\*|:[abcd]\b/.test(s)) foreign.push('«:*» и веса не поддерживаются; окончания и так не важны');
  if (foreign.length) warnings.push(`Эти символы поиск игнорирует: ${foreign.join('; ')}`);

  if ((s.match(/"/g)?.length ?? 0) % 2) warnings.push('Непарная кавычка — фраза продлится до конца строки');

  // Разбор как в websearch_to_tsquery: состояние «ждём слово» / «ждём оператор».
  const groups: FtTerm[][] = [[]];
  const stopSeen = new Set<string>();
  const splitSeen = new Set<string>();
  /** Слово → токены парсера PostgreSQL: «о-30» → «о», «-30» (дефис перед цифрами — знак числа). */
  const tokens = (w: string) => {
    const parts = w.split(/(?=-\p{N})/u);
    if (parts.length > 1) splitSeen.add(w);
    return parts;
  };
  let i = 0;
  let negate = false;
  let waitOperator = false;
  let orIgnored = false;
  let dashSpace = false;
  const push = (t: Omit<FtTerm, 'not'>) => {
    groups.at(-1)!.push({ ...t, not: negate });
    negate = false;
    waitOperator = true;
  };
  while (i < s.length) {
    const c = s[i]!;
    if (c === '"') {
      const end = s.indexOf('"', i + 1);
      const body = s.slice(i + 1, end < 0 ? undefined : end);
      const words = (body.match(/[\p{L}\p{N}_]+(?:[-.'@][\p{L}\p{N}_]+)*/gu) ?? []).flatMap(tokens);
      const content = words.filter((w) => !RU_STOP.has(w));
      words.filter((w) => RU_STOP.has(w)).forEach((w) => stopSeen.add(w));
      // Стоп-слова во фразе не ищутся, но оставляют «зазор» (<2>): показываем только значимые слова.
      if (words.length) push({ text: (content.length ? content : words).join(' '), phrase: content.length > 1, stop: content.length === 0 });
      i = end < 0 ? s.length : end + 1;
      continue;
    }
    // Минус перед словом — НЕ, даже отделённый пробелом (дефис внутри слова забирает регулярка WORD).
    if (c === '-') {
      if (/\s/.test(s[i + 1] ?? '')) dashSpace = true;
      negate = true;
      i++;
      continue;
    }
    WORD.lastIndex = i;
    const m = WORD.exec(s);
    if (!m) {
      // Прочие символы — разделители.
      i++;
      continue;
    }
    const w = m[0];
    i += w.length;
    if (w === 'or') {
      if (waitOperator) {
        groups.push([]);
        waitOperator = false;
      } else {
        orIgnored = true;
      }
      continue;
    }
    for (const t of tokens(w)) {
      const stop = RU_STOP.has(t);
      if (stop) stopSeen.add(t);
      push({ text: t, phrase: false, stop });
    }
  }
  const filled = groups.filter((g) => g.length);
  // «or» в конце строки: последняя группа пустая.
  if (orIgnored || (groups.length > 1 && groups.at(-1)!.length === 0)) {
    warnings.push('«or» в начале, в конце строки или два подряд поиск отбрасывает');
  }
  if (dashSpace) warnings.push('Минус через пробел всё равно исключает следующее слово: «а - б» = а И НЕ б');
  for (const w of splitSeen) {
    const [head, ...nums] = w.split(/(?=-\p{N})/u);
    warnings.push(
      `«${w}» поиск делит на «${head}» и число ${nums.map((n) => `«${n}»`).join(', ')}` +
        (RU_STOP.has(head!) ? ` — «${head}» стоп-слово, ищется только ${nums.map((n) => `«${n}»`).join(', ')}` : ''),
    );
  }

  if (stopSeen.size) {
    warnings.push(`Стоп-слова поиск отбрасывает и по ним не ищет: ${[...stopSeen].map((w) => `«${w}»`).join(', ')}`);
  }

  const live = (g: FtTerm[]) => g.filter((t) => !t.stop);
  const positive = filled.some((g) => live(g).some((t) => !t.not));
  if (!errors.length && filled.length && filled.every((g) => live(g).length === 0)) {
    errors.push('Остались одни стоп-слова — поиск их отбрасывает, искать нечего');
  } else if (!errors.length && filled.length && !positive) {
    errors.push('Одни исключения («-слово») найдут почти всё подряд — добавьте слово, которое должно быть');
  } else if (filled.some((g) => live(g).length && live(g).every((t) => t.not))) {
    warnings.push('Часть «or» состоит только из исключений — она найдёт почти все сообщения');
  }

  const term = (t: FtTerm) => `${t.not ? 'НЕ ' : ''}${t.phrase ? `"${t.text}"` : t.text}`;
  const groupText = (g: FtTerm[]) => {
    const parts = live(g).map(term);
    return parts.length > 1 && filled.length > 1 ? `(${parts.join(' И ')})` : parts.join(' И ');
  };
  const explain = filled.map(groupText).filter(Boolean).join(' ИЛИ ');

  return { groups: filled, explain, errors, warnings: [...new Set(warnings)] };
}

/** Что подсвечивать в результатах: основы слов (как их сравнивает поиск) и числа. */
export interface FtHighlight {
  stems: Set<string>;
  /** Латинские слова (их словарь — english_stem): подсвечиваются по началу слова. */
  latin: string[];
  numbers: string[];
}

/** Подсветка для выражения: слова, которые должны быть (без исключений и стоп-слов), в виде основ. */
export function fulltextHighlight(raw: string): FtHighlight {
  const h: FtHighlight = { stems: new Set(), latin: [], numbers: [] };
  for (const g of checkFulltext(raw).groups) {
    for (const t of g) {
      if (t.not || t.stop) continue;
      for (const w of t.text.split(' ')) {
        if (RU_STOP.has(w)) continue;
        if (/^-?\p{N}+$/u.test(w)) h.numbers.push(w.replace(/^-/, ''));
        else if (/^[a-z0-9_]+$/.test(w)) h.latin.push(w);
        else h.stems.add(stemRu(w));
      }
    }
  }
  return h;
}

/** Текст сообщения → куски с отметкой «совпало со словом запроса» (для подсветки). */
export function highlightParts(text: string, h: FtHighlight): { text: string; hit: boolean }[] {
  if (!h.stems.size && !h.latin.length && !h.numbers.length) return [{ text, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(/[\p{L}\p{N}_]+/gu)) {
    const w = m[0].toLowerCase();
    const hit = /^\p{N}+$/u.test(w)
      ? h.numbers.includes(w)
      : /^[a-z0-9_]+$/.test(w)
        ? h.latin.some((q) => w === q || (q.length >= 3 && w.startsWith(q)))
        : h.stems.has(stemRu(w));
    if (!hit) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}

// Русский стеммер Snowball — тот же алгоритм, что у словаря russian_stem в PostgreSQL
// (https://snowballstem.org/algorithms/russian/stemmer.html). Нужен, чтобы подсвечивать в результатах
// полнотекстового поиска слова так, как их сопоставляет поиск: «орланы», «орлана» → «орла».

const VOWELS = 'аеиоуыэюя';

const PERFECTIVE_GERUND = { g1: ['вшись', 'вши', 'в'], g2: ['ившись', 'ывшись', 'ивши', 'ывши', 'ив', 'ыв'] };
const REFLEXIVE = ['ся', 'сь'];
const ADJECTIVE = [
  'ими', 'ыми', 'его', 'ого', 'ему', 'ому', 'ее', 'ие', 'ые', 'ое', 'ей', 'ий', 'ый', 'ой', 'ем', 'им', 'ым', 'ом',
  'их', 'ых', 'ую', 'юю', 'ая', 'яя', 'ою', 'ею',
];
const PARTICIPLE = { g1: ['ем', 'нн', 'вш', 'ющ', 'щ'], g2: ['ивш', 'ывш', 'ующ'] };
const VERB = {
  g1: ['ете', 'йте', 'ешь', 'нно', 'ла', 'на', 'ли', 'ем', 'ло', 'но', 'ет', 'ют', 'ны', 'ть', 'й', 'л', 'н'],
  g2: [
    'ейте', 'уйте', 'ила', 'ыла', 'ена', 'ите', 'или', 'ыли', 'ило', 'ыло', 'ено', 'ует', 'уют', 'ены', 'ить', 'ыть', 'ишь',
    'ей', 'уй', 'ил', 'ыл', 'им', 'ым', 'ен', 'ят', 'ит', 'ыт', 'ую', 'ю',
  ],
};
const NOUN = [
  'иями', 'ями', 'ами', 'ией', 'иям', 'ием', 'иях', 'ев', 'ов', 'ие', 'ье', 'еи', 'ии', 'ей', 'ой', 'ий', 'ям', 'ем', 'ам',
  'ом', 'ах', 'ях', 'ию', 'ью', 'ия', 'ья', 'а', 'е', 'и', 'й', 'о', 'у', 'ы', 'ь', 'ю', 'я',
];
const DERIVATIONAL = ['ость', 'ост'];
const SUPERLATIVE = ['ейше', 'ейш'];

const byLength = (a: string[]) => [...a].sort((x, y) => y.length - x.length);
const ADJ = byLength(ADJECTIVE);
const NOUNS = byLength(NOUN);

/** Самое длинное окончание из списка в области [from…]; g1 — только после «а»/«я». */
function findEnding(w: string, from: number, list: string[], g1 = false): string | null {
  for (const e of byLength(list)) {
    if (!w.endsWith(e) || w.length - e.length < from) continue;
    if (g1) {
      const prev = w[w.length - e.length - 1];
      if (prev !== 'а' && prev !== 'я') continue;
      if (w.length - e.length - 1 < from) continue;
    }
    return e;
  }
  return null;
}

/** Окончание из двух групп (g1 требует «а»/«я» перед собой), берётся самое длинное. */
function findGrouped(w: string, from: number, g: { g1: string[]; g2: string[] }): string | null {
  const a = findEnding(w, from, g.g1, true);
  const b = findEnding(w, from, g.g2);
  if (a && b) return a.length >= b.length ? a : b;
  return a ?? b;
}

/** Основа русского слова (в нижнем регистре, «ё» → «е»). */
export function stemRu(word: string): string {
  let w = word.toLowerCase().replace(/ё/g, 'е');
  // RV — после первой гласной; R1 — после первой согласной, идущей за гласной; R2 — то же внутри R1.
  const firstVowel = [...w].findIndex((c) => VOWELS.includes(c));
  if (firstVowel < 0) return w;
  const rv = firstVowel + 1;
  const regionAfter = (start: number) => {
    for (let i = start; i < w.length - 1; i++) if (VOWELS.includes(w[i]!) && !VOWELS.includes(w[i + 1]!)) return i + 2;
    return w.length;
  };
  const r1 = regionAfter(0);
  const r2 = regionAfter(r1);
  const cut = (e: string | null) => {
    if (e) w = w.slice(0, -e.length);
    return !!e;
  };

  // Шаг 1.
  if (!cut(findGrouped(w, rv, PERFECTIVE_GERUND))) {
    cut(findEnding(w, rv, REFLEXIVE));
    const adj = findEnding(w, rv, ADJ);
    if (adj) {
      cut(adj);
      cut(findGrouped(w, rv, PARTICIPLE));
    } else if (!cut(findGrouped(w, rv, VERB))) {
      cut(findEnding(w, rv, NOUNS));
    }
  }
  // Шаг 2.
  if (w.endsWith('и') && w.length - 1 >= rv) w = w.slice(0, -1);
  // Шаг 3.
  cut(findEnding(w, r2, DERIVATIONAL));
  // Шаг 4.
  if (w.endsWith('нн') && w.length - 2 >= rv) w = w.slice(0, -1);
  else if (cut(findEnding(w, rv, SUPERLATIVE))) {
    if (w.endsWith('нн') && w.length - 2 >= rv) w = w.slice(0, -1);
  } else if (w.endsWith('ь') && w.length - 1 >= rv) w = w.slice(0, -1);
  return w;
}

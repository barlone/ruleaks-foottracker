// Правка config.ini «на месте»: файл меняется построчно — комментарии, порядок и остальные ключи сохраняются.
// Используют npm run password-hash и npm run google-login.

const isSection = (line: string) => /^\s*\[([^\]]+)\]\s*$/.exec(line)?.[1]!.trim();

/** Ставит key = value в секции section: заменяет строку ключа, иначе дописывает в конец секции (или создаёт секцию). */
export function setIniValue(src: string, section: string, key: string, value: string): string {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  const line = `${key} = ${value}`;
  const start = lines.findIndex((l) => isSection(l) === section);
  if (start < 0) {
    // Новая секция — перед первой существующей, чтобы [config] оставалась вверху файла.
    const first = lines.findIndex((l) => isSection(l) !== undefined);
    if (first < 0) lines.push(...(lines.at(-1) === '' ? [] : ['']), `[${section}]`, line);
    else lines.splice(first, 0, `[${section}]`, line, '');
    return lines.join(eol);
  }
  let end = lines.findIndex((l, i) => i > start && isSection(l) !== undefined);
  if (end < 0) end = lines.length;
  for (let i = start + 1; i < end; i++) {
    const l = lines[i]!;
    if (l.includes('=') && l.slice(0, l.indexOf('=')).trim() === key) {
      lines[i] = line;
      return lines.join(eol);
    }
  }
  let at = end;
  while (at > start + 1 && lines[at - 1]!.trim() === '') at--;
  lines.splice(at, 0, line);
  return lines.join(eol);
}

/** Значение key в секции section как записано в файле (без кавычек и пробелов по краям); undefined — ключа нет. */
export function getIniValue(src: string, section: string, key: string): string | undefined {
  let inside = false;
  for (const l of src.split(/\r?\n/)) {
    const sec = isSection(l);
    if (sec !== undefined) inside = sec === section;
    else if (inside && !/^\s*[;#]/.test(l) && l.includes('=') && l.slice(0, l.indexOf('=')).trim() === key) {
      return l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  return undefined;
}

// Protocol Buffers в минимальном объёме, нужном Play Игр (ghunt/protos/playgatewaypa): запись вложенных
// сообщений со строкой и разбор полей по номерам. Номера полей у Google здесь до 3·10⁸, поэтому тег
// (номер · 8 + тип) не помещается в 32-битные сдвиги — считаем обычной арифметикой.

function varint(n: number): Buffer {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
  return Buffer.from(out);
}

/** Поле с содержимым по длине (тип 2): строка или вложенное сообщение. */
export function field(no: number, value: Buffer | string): Buffer {
  const body = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return Buffer.concat([varint(no * 8 + 2), varint(body.length), body]);
}

export interface ProtoField {
  no: number;
  /** Только поля с содержимым по длине; у числовых — null. */
  bytes: Buffer | null;
}

/** Поля сообщения верхнего уровня. Битое сообщение — что успели разобрать (чужой формат может поменяться). */
export function fields(buf: Buffer): ProtoField[] {
  const out: ProtoField[] = [];
  let pos = 0;
  const readVarint = (): number => {
    let result = 0;
    let mul = 1;
    for (;;) {
      if (pos >= buf.length) throw new RangeError('varint');
      const b = buf[pos++]!;
      result += (b & 0x7f) * mul;
      if (b < 0x80) return result;
      mul *= 0x80;
    }
  };
  try {
    while (pos < buf.length) {
      const tag = readVarint();
      const no = Math.floor(tag / 8);
      const wire = tag % 8;
      if (wire === 0) {
        readVarint();
        out.push({ no, bytes: null });
      } else if (wire === 1) {
        pos += 8;
        out.push({ no, bytes: null });
      } else if (wire === 5) {
        pos += 4;
        out.push({ no, bytes: null });
      } else if (wire === 2) {
        const len = readVarint();
        if (pos + len > buf.length) break;
        out.push({ no, bytes: buf.subarray(pos, pos + len) });
        pos += len;
      } else {
        break; // группы (3, 4) и неизвестные типы не встречаются
      }
    }
  } catch {
    // оборванное сообщение
  }
  return out;
}

/** Все вложенные сообщения (или строки) с номером поля no. */
export const all = (buf: Buffer | null | undefined, no: number): Buffer[] =>
  buf ? fields(buf).filter((f) => f.no === no && f.bytes).map((f) => f.bytes!) : [];

/** Первое вложенное сообщение по цепочке номеров полей; null — такого пути нет. */
export function dig(buf: Buffer | null | undefined, ...path: number[]): Buffer | null {
  let cur = buf ?? null;
  for (const no of path) {
    cur = all(cur, no)[0] ?? null;
    if (!cur) return null;
  }
  return cur;
}

export const str = (buf: Buffer | null | undefined, ...path: number[]): string => dig(buf, ...path)?.toString('utf8') ?? '';

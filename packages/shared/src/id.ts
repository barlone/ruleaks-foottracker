// Идентификаторы объектов — UUID v7 (RFC 9562), как uuidv7() в PostgreSQL 18:
// 48 бит миллисекунд Unix-времени + случайные биты. Упорядочены по времени создания,
// поэтому индексы в БД растут без фрагментации. Работает и в Node, и в браузере.

export function newId(now = Date.now()): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let t = now;
  for (let i = 5; i >= 0; i--) {
    b[i] = t % 256;
    t = Math.floor(t / 256);
  }
  b[6] = (b[6]! & 0x0f) | 0x70; // версия 7
  b[8] = (b[8]! & 0x3f) | 0x80; // вариант RFC 9562
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v);
}

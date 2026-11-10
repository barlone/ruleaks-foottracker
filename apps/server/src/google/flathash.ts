import { inflateSync } from 'node:zlib';
import { outboundFetch } from '../pages/outbound.ts';
import { DEFAULT_PHOTO_FLATHASHES, WEB_HEADERS } from './knowledge.ts';
import type { Ctx } from './net.ts';

// helpers/utils.py is_default_profile_pic: GHunt отличает стандартную картинку профиля от загруженной по среднему
// хешу (imagehash.average_hash: картинка → серая 8×8 → бит на пиксель «ярче среднего») — расстояние Хэмминга до
// эталонного хеша силуэта меньше 10. Библиотеки картинок на сервере нет, поэтому у Google запрашивается маленький PNG
// (суффикс =s64-rp), а PNG разбирается здесь: zlib есть в Node, остальное — фильтры строк.

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 1024 * 1024;
const MAX_SIDE = 1024;

/** Серая картинка: яркость 0…255 построчно. */
interface Gray {
  width: number;
  height: number;
  data: Float64Array;
}

/** PNG (8 бит на канал, без чересстрочности) → яркость, как PIL convert('L'): 0.299 R + 0.587 G + 0.114 B. */
export function decodePngGray(png: Buffer): Gray | null {
  if (png.length < 33 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let pos = 8; pos + 12 <= png.length; ) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('latin1', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (data.length < len) return null;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9]!;
      // глубина 8 бит, сжатие и фильтр стандартные, без чересстрочности
      if (data[8] !== 8 || data[10] !== 0 || data[11] !== 0 || data[12] !== 0) return null;
    } else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
  if (!channels || !width || !height || width > MAX_SIDE || height > MAX_SIDE || (colorType === 3 && !palette)) return null;

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return null;

  const out = new Float64Array(width * height);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0; // слева
      const b = prev[i]!; // сверху
      const c = i >= channels ? prev[i - channels]! : 0; // слева сверху
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) return null;
      line[i] = (line[i]! + add) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const p = x * channels;
      let r: number;
      let g: number;
      let bl: number;
      if (colorType === 0 || colorType === 4) r = g = bl = line[p]!;
      else if (colorType === 3) {
        const k = line[p]! * 3;
        r = palette![k] ?? 0;
        g = palette![k + 1] ?? 0;
        bl = palette![k + 2] ?? 0;
      } else {
        r = line[p]!;
        g = line[p + 1]!;
        bl = line[p + 2]!;
      }
      out[y * width + x] = 0.299 * r + 0.587 * g + 0.114 * bl;
    }
    prev = line;
  }
  return { width, height, data: out };
}

/** imagehash.average_hash, hash_size 8: 16 hex-цифр, строки сверху вниз, старший бит — левый пиксель. */
export function averageHash(img: Gray): string {
  const cells = new Float64Array(64);
  for (let cy = 0; cy < 8; cy++) {
    for (let cx = 0; cx < 8; cx++) {
      // Усреднение по клетке: исходная картинка небольшая (64×64), этого достаточно вместо сглаживания PIL.
      const x0 = Math.floor((cx * img.width) / 8);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * img.width) / 8));
      const y0 = Math.floor((cy * img.height) / 8);
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * img.height) / 8));
      let sum = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) sum += img.data[y * img.width + x]!;
      cells[cy * 8 + cx] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  const mean = cells.reduce((s, v) => s + v, 0) / 64;
  let hex = '';
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) byte = (byte << 1) | (cells[row * 8 + col]! > mean ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Число различающихся бит двух хешей (вычитание хешей в imagehash). */
export function hashDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    for (; x; x &= x - 1) d++;
  }
  return d;
}

/** Картинка стандартная: до одного из эталонных хешей меньше 10 бит (порог GHunt). */
export const isDefaultFlathash = (hash: string) => DEFAULT_PHOTO_FLATHASHES.some((ref) => hashDistance(hash, ref) < 10);

/**
 * Средний хеш картинки профиля; null — картинку не удалось получить или разобрать.
 * Адрес картинки пришёл из ответа Google, но это всё же внешние данные: запрос идёт через outboundFetch,
 * который не пускает во внутреннюю сеть, и только на https.
 */
export async function photoFlathash(url: string, ctx: Ctx): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    // …/a/default-user=s100 → …/a/default-user=s64-rp: 64 пикселя, принудительно PNG.
    const small = `${url.replace(/=[^=/]*$/, '')}=s64-rp`;
    const res = await outboundFetch(small, { method: 'GET', headers: WEB_HEADERS, follow: true, signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(ctx.timeoutMs)]) });
    if (!res.ok || Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return null;
    const gray = decodePngGray(buf);
    return gray ? averageHash(gray) : null;
  } catch {
    return null;
  }
}

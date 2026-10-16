import { ERR_INVALID_PASSWORD, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader, type Entry, type FileEntry } from '@zip.js/zip.js';
import { EXPORT_VERSION, ExportDossier, ExportInvestigation, ExportMeta, ExportRelation, ExportSearch } from '@ft/shared';
import type { z } from 'zod';
import { archivePassword } from './password.ts';

// Чтение файла экспорта: версия по имени version.vN (без пароля), затем расшифровка и проверка Zod-схемами
// из packages/shared/src/export.ts. Ошибки — ImportError с машиночитаемым кодом (роутер отдаёт его в message).

/** IMPORT_BUSY — на сервере уже ждут импорта файлы на общий предел памяти (export/uploads.ts): повторить позже. */
export type ImportErrorCode = 'BAD_FILE' | 'UNSUPPORTED_VERSION' | 'NEED_PASSWORD' | 'BAD_PASSWORD' | 'FILE_TOO_LARGE' | 'UPLOAD_EXPIRED' | 'IMPORT_BUSY';

export class ImportError extends Error {
  constructor(public readonly code: ImportErrorCode, detail?: string) {
    super(code);
    if (detail) this.cause = detail;
  }
}

export interface ExportPackage {
  meta: ExportMeta;
  dossiers: ExportDossier[];
  investigation: ExportInvestigation | null;
  relations: ExportRelation[];
  searches: ExportSearch[];
  /** Изображения по пути в архиве. */
  media: Map<string, { mime: string; bytes: Uint8Array }>;
}

const MAX_ENTRIES = 20_000;
/** Предел распакованного объёма — защита от «zip-бомбы». */
const MAX_UNPACKED = 1024 * 1024 * 1024;

const isFile = (e: Entry): e is FileEntry => !e.directory;

export async function readPackage(bytes: Uint8Array, password: string): Promise<ExportPackage> {
  const zip = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    let entries: FileEntry[];
    try {
      entries = (await zip.getEntries()).filter(isFile);
    } catch {
      throw new ImportError('BAD_FILE', 'не ZIP-архив');
    }
    if (entries.length > MAX_ENTRIES) throw new ImportError('FILE_TOO_LARGE');
    if (entries.reduce((n, e) => n + e.uncompressedSize, 0) > MAX_UNPACKED) throw new ImportError('FILE_TOO_LARGE');

    // Версия формата — по имени файла, без расшифровки.
    const versions = entries.flatMap((e) => /^version\.v(\d{1,3})$/.exec(e.filename)?.[1] ?? []).map(Number);
    if (versions.length !== 1) throw new ImportError('BAD_FILE', 'нет version.vN');
    if (versions[0] !== EXPORT_VERSION) throw new ImportError('UNSUPPORTED_VERSION', `v${versions[0]}`);

    const byName = new Map(entries.map((e) => [e.filename, e]));
    const metaEntry = byName.get('meta.info');
    if (!metaEntry) throw new ImportError('BAD_FILE', 'нет meta.info');

    // Сначала введённый пароль, затем пустой (файл без пароля открывается и с любым введённым).
    let key: string | null = null;
    let metaText = '';
    for (const p of password ? [password, ''] : ['']) {
      const candidate = await archivePassword(p);
      try {
        metaText = await metaEntry.getData(new TextWriter(), { password: candidate });
        key = candidate;
        break;
      } catch (e) {
        if ((e as Error).message !== ERR_INVALID_PASSWORD) throw new ImportError('BAD_FILE', (e as Error).message);
      }
    }
    if (key === null) throw new ImportError(password ? 'BAD_PASSWORD' : 'NEED_PASSWORD');
    const pwd = key;

    const json = async <T,>(path: string, schema: z.ZodType<T>): Promise<T> => {
      const e = byName.get(path);
      if (!e) throw new ImportError('BAD_FILE', `нет ${path}`);
      let value: unknown;
      try {
        value = JSON.parse(path === 'meta.info' ? metaText : await e.getData(new TextWriter(), { password: pwd }));
      } catch {
        throw new ImportError('BAD_FILE', `не читается ${path}`);
      }
      const r = schema.safeParse(value);
      if (!r.success) throw new ImportError('BAD_FILE', `${path}: ${r.error.issues[0]?.message ?? 'неверный формат'}`);
      return r.data;
    };

    const meta = await json('meta.info', ExportMeta);
    const c = meta.contents;
    const pkg: ExportPackage = {
      meta,
      dossiers: [],
      investigation: null,
      relations: c.relations ? await json(c.relations.file, ExportRelation.array()) : [],
      searches: [],
      media: new Map(),
    };
    for (const d of c.dossiers) pkg.dossiers.push(await json(d.file, ExportDossier));
    if (c.investigations.length > 1) throw new ImportError('BAD_FILE', 'больше одного расследования');
    for (const i of c.investigations) pkg.investigation = await json(i.file, ExportInvestigation);
    for (const s of c.searches) pkg.searches.push(await json(s.file, ExportSearch));
    for (const m of c.media) {
      const e = byName.get(m.file);
      if (!e) throw new ImportError('BAD_FILE', `нет ${m.file}`);
      pkg.media.set(m.file, { mime: m.mime, bytes: await e.getData(new Uint8ArrayWriter(), { password: pwd }) });
    }
    checkRefs(pkg);
    return pkg;
  } finally {
    await zip.close();
  }
}

/** Ключи уникальны, корень на месте, uid не повторяются. Ссылки на отсутствующие ключи при импорте просто отбрасываются. */
function checkRefs(pkg: ExportPackage) {
  const bad = (why: string) => {
    throw new ImportError('BAD_FILE', why);
  };
  const keys = pkg.dossiers.map((d) => d.key);
  if (new Set(keys).size !== keys.length) bad('повторяются ключи досье');
  const uids = pkg.dossiers.flatMap((d) => d.uid ?? []);
  if (new Set(uids).size !== uids.length) bad('повторяются uid досье');
  const skeys = pkg.searches.map((s) => s.key);
  if (new Set(skeys).size !== skeys.length) bad('повторяются ключи снимков');
  const inv = pkg.investigation;
  if (inv) {
    for (const list of [inv.nodes, inv.edges, inv.facts, inv.hypotheses]) {
      const k = list.map((x) => x.key);
      if (new Set(k).size !== k.length) bad('повторяются ключи в расследовании');
    }
  }
  const root = pkg.meta.root;
  if (root.type === 'dossier' ? !keys.includes(root.key) : inv?.key !== root.key) bad('нет корневого объекта');
}

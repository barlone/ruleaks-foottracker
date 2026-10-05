import type { Tag } from '@ft/shared';
import { isUuid } from '@ft/shared';
import { TagExists, type TagRepo } from '../../ports.ts';
import { notFound, tx, type Db, type Q } from './db.ts';

// Словарь тегов: tag_texts — общие тексты (один текст — одна строка), tags — тег пользователя (текст + цвет).
// Тексты не удаляются: они общие, и на них могут ссылаться словари других пользователей.

const SELECT = `SELECT t.id, t.owner_id, x.text, t.color FROM tags t JOIN tag_texts x ON x.id = t.text_id`;

interface Row { id: string; owner_id: string; text: string; color: string }
const toTag = (r: Row): Tag => ({ id: r.id, ownerId: r.owner_id, text: r.text, color: r.color });

/** id текста; новый текст добавляется в общий словарь. */
async function textId(c: Q, text: string): Promise<string> {
  const r = await c.query<{ id: string }>(
    `INSERT INTO tag_texts (text) VALUES ($1) ON CONFLICT (text) DO UPDATE SET text = EXCLUDED.text RETURNING id`,
    [text],
  );
  return r.rows[0]!.id;
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

export class PgTags implements TagRepo {
  constructor(private db: Db) {}

  async list(userId: string) {
    const r = await this.db.query<Row>(`${SELECT} WHERE t.owner_id = $1 ORDER BY x.text`, [userId]);
    return r.rows.map(toTag);
  }

  private async getOwn(c: Q, userId: string, id: string): Promise<Tag> {
    const r = await c.query<Row>(`${SELECT} WHERE t.id = $1 AND t.owner_id = $2`, [id, userId]);
    return r.rows[0] ? toTag(r.rows[0]) : notFound();
  }

  async create(userId: string, text: string, color: string) {
    return tx(this.db, async (c) => {
      const tid = await textId(c, text);
      const r = await c.query<{ id: string }>(
        `INSERT INTO tags (owner_id, text_id, color) VALUES ($1, $2, $3) ON CONFLICT (owner_id, text_id) DO NOTHING RETURNING id`,
        [userId, tid, color],
      );
      if (!r.rows[0]) throw new TagExists();
      return this.getOwn(c, userId, r.rows[0].id);
    });
  }

  async update(userId: string, id: string, patch: { text?: string; color?: string }) {
    if (!isUuid(id)) notFound();
    try {
      return await tx(this.db, async (c) => {
        const sets: string[] = [];
        const vals: unknown[] = [id, userId];
        if (patch.text !== undefined) {
          vals.push(await textId(c, patch.text));
          sets.push(`text_id = $${vals.length}`);
        }
        if (patch.color !== undefined) {
          vals.push(patch.color);
          sets.push(`color = $${vals.length}`);
        }
        if (sets.length) {
          const r = await c.query(`UPDATE tags SET ${sets.join(', ')} WHERE id = $1 AND owner_id = $2`, vals);
          if (!r.rowCount) notFound();
        }
        return this.getOwn(c, userId, id);
      });
    } catch (e) {
      // Переименование в текст, который уже есть в словаре пользователя.
      if (isUniqueViolation(e)) throw new TagExists();
      throw e;
    }
  }

  async remove(userId: string, id: string) {
    if (!isUuid(id)) return;
    await this.db.query(`DELETE FROM tags WHERE id = $1 AND owner_id = $2`, [id, userId]);
  }
}

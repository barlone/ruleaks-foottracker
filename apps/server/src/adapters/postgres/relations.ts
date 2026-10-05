import type { DossierRelation, RelationType } from '@ft/shared';
import { isUuid } from '@ft/shared';
import { Conflict, type RelationRepo } from '../../ports.ts';
import { notFound, tx, type Db, type Q } from './db.ts';

// Связи между досье персон: relation_texts (общие тексты) → relation_types (owner_id NULL — предопределённый)
// → dossier_relations. Связь хранится один раз (from → to), показывается в обоих досье.

const TYPE_SELECT = `SELECT t.id, t.owner_id, x.text FROM relation_types t JOIN relation_texts x ON x.id = t.text_id`;
const REL_SELECT = `SELECT r.id, r.from_id, r.to_id, r.type_id, x.text AS type_text, r.from_note, r.to_note, r.created_at
  FROM dossier_relations r JOIN relation_types t ON t.id = r.type_id JOIN relation_texts x ON x.id = t.text_id`;

interface TypeRow { id: string; owner_id: string | null; text: string }
interface RelRow {
  id: string; from_id: string; to_id: string; type_id: string; type_text: string; from_note: string | null; to_note: string | null; created_at: Date;
}

const toType = (r: TypeRow): RelationType => ({ id: r.id, ownerId: r.owner_id, text: r.text });
const toRel = (r: RelRow): DossierRelation => ({
  id: r.id, fromId: r.from_id, toId: r.to_id, typeId: r.type_id, typeText: r.type_text, fromNote: r.from_note, toNote: r.to_note,
  createdAt: r.created_at.toISOString(),
});

export class PgRelations implements RelationRepo {
  constructor(private db: Db) {}

  async listTypes(userId: string) {
    const r = await this.db.query<TypeRow>(
      `${TYPE_SELECT} WHERE t.owner_id IS NULL OR t.owner_id = $1 ORDER BY t.owner_id NULLS FIRST, t.position, x.text`,
      [userId],
    );
    return r.rows.map(toType);
  }

  async createType(userId: string, text: string) {
    return tx(this.db, async (c) => {
      const tid = (
        await c.query<{ id: string }>(
          `INSERT INTO relation_texts (text) VALUES ($1) ON CONFLICT (text) DO UPDATE SET text = EXCLUDED.text RETURNING id`,
          [text],
        )
      ).rows[0]!.id;
      // Свой тип с текстом предопределённого не нужен — он и так виден.
      const dup = await c.query(`SELECT 1 FROM relation_types WHERE text_id = $1 AND (owner_id IS NULL OR owner_id = $2)`, [tid, userId]);
      if (dup.rowCount) throw new Conflict('RELATION_TYPE_EXISTS');
      const r = await c.query<{ id: string }>(`INSERT INTO relation_types (owner_id, text_id) VALUES ($1, $2) RETURNING id`, [userId, tid]);
      return (await this.getType(c, r.rows[0]!.id)) ?? notFound();
    });
  }

  private async getType(c: Q, id: string): Promise<RelationType | null> {
    const r = await c.query<TypeRow>(`${TYPE_SELECT} WHERE t.id = $1`, [id]);
    return r.rows[0] ? toType(r.rows[0]) : null;
  }

  async removeType(userId: string, id: string) {
    if (!isUuid(id)) return;
    await this.db.query(`DELETE FROM relation_types WHERE id = $1 AND owner_id = $2`, [id, userId]);
  }

  async list(dossierId: string) {
    if (!isUuid(dossierId)) return [];
    const r = await this.db.query<RelRow>(`${REL_SELECT} WHERE r.from_id = $1 OR r.to_id = $1 ORDER BY r.created_at`, [dossierId]);
    return r.rows.map(toRel);
  }

  async get(id: string) {
    if (!isUuid(id)) return null;
    const r = await this.db.query<RelRow>(`${REL_SELECT} WHERE r.id = $1`, [id]);
    return r.rows[0] ? toRel(r.rows[0]) : null;
  }

  async add(
    rel: { dossierId: string; otherId: string; typeId: string; note?: string | null; otherNote?: string | null },
    actorId: string,
  ) {
    const id = await tx(this.db, async (c) => {
      // Та же связь в любом направлении — обновляем пояснения сторон, а не заводим вторую.
      const same = await c.query<{ id: string; from_id: string }>(
        `SELECT id, from_id FROM dossier_relations
         WHERE type_id = $3 AND ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)) FOR UPDATE`,
        [rel.dossierId, rel.otherId, rel.typeId],
      );
      const row = same.rows[0];
      if (row) {
        const here = row.from_id === rel.dossierId ? 'from_note' : 'to_note';
        const there = here === 'from_note' ? 'to_note' : 'from_note';
        if (rel.note !== undefined) await c.query(`UPDATE dossier_relations SET ${here} = $2 WHERE id = $1`, [row.id, rel.note]);
        if (rel.otherNote !== undefined) await c.query(`UPDATE dossier_relations SET ${there} = $2 WHERE id = $1`, [row.id, rel.otherNote]);
        return row.id;
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO dossier_relations (from_id, to_id, type_id, from_note, to_note, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [rel.dossierId, rel.otherId, rel.typeId, rel.note ?? null, rel.otherNote ?? null, actorId],
      );
      return r.rows[0]!.id;
    });
    return (await this.get(id)) ?? notFound();
  }

  async remove(id: string) {
    if (!isUuid(id)) return;
    await this.db.query(`DELETE FROM dossier_relations WHERE id = $1`, [id]);
  }
}

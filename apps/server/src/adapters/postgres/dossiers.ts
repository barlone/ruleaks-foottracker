import { createHash } from 'node:crypto';
import type { Dossier, DossierItem, DossierSummary, Share } from '@ft/shared';
import { isUuid } from '@ft/shared';
import type { DossierRepo, Scope } from '../../ports.ts';
import { json, likePattern, lockAndBump, mustUuid, newObjectId, notFound, tx, type Db, type Tx } from './db.ts';

// Досье в PostgreSQL: dossiers + dossier_items (тело элемента — jsonb data по типу), dossier_members,
// dossier_shares, media. Удаление мягкое (deleted_at).
//
// Медиа: файлового хранилища (S3) пока нет, поэтому изображение остаётся в data.url элемента
// (data URL или внешняя ссылка), а в media — запись-«паспорт» с sha256 этой строки и ключом inline/…
// Обложка — cover_media_id; её URL берётся из элемента досье с тем же media_id.

const ITEM_BASE = new Set(['id', 'type', 'position', 'source', 'createdAt']);

interface ItemRow {
  id: string;
  type: DossierItem['type'];
  data: Record<string, unknown>;
  source: DossierItem['source'] | null;
  position: number;
  media_id: string | null;
  created_at: Date;
}

const toItem = (r: ItemRow): DossierItem =>
  ({
    ...r.data,
    id: r.id,
    type: r.type,
    position: r.position,
    ...(r.source ? { source: r.source } : {}),
    createdAt: r.created_at.toISOString(),
  }) as DossierItem;

/** Тело элемента для колонки data: всё, кроме общих полей (они в своих колонках). */
function itemData(item: DossierItem): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([k, v]) => !ITEM_BASE.has(k) && v !== undefined));
}

function mimeOf(url: string): string {
  const m = /^data:([\w.+-]+\/[\w.+-]+)[;,]/.exec(url);
  if (m) return m[1]!;
  const ext = /\.(jpe?g|png|gif|webp|svg|bmp|heic)(\?|#|$)/i.exec(url)?.[1]?.toLowerCase();
  return ext ? `image/${ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext}` : 'application/octet-stream';
}

/** Запись media для изображения элемента; одинаковое изображение у владельца — одна запись. */
async function upsertMedia(c: Tx, ownerId: string, url: string, name?: string): Promise<string> {
  const sha = createHash('sha256').update(url).digest();
  const r = await c.query<{ id: string }>(
    `INSERT INTO media (owner_id, storage_key, mime, size_bytes, sha256, original_name)
     VALUES ($1::uuid, 'inline/' || $1::text || '/' || encode($4, 'hex'), $2, $3, $4, $5)
     ON CONFLICT (owner_id, sha256) DO UPDATE SET original_name = coalesce(media.original_name, EXCLUDED.original_name)
     RETURNING id`,
    [ownerId, mimeOf(url), Buffer.byteLength(url), sha, name ?? null],
  );
  return r.rows[0]!.id;
}

export class PgDossiers implements DossierRepo {
  constructor(private db: Db) {}

  async list(userId: string, scope: Exclude<Scope, 'public'>, q?: string): Promise<DossierSummary[]> {
    const r = await this.db.query<{
      id: string; owner_id: string; kind: Dossier['kind']; title: string; tags: string[]; visibility: Dossier['visibility'];
      updated_at: Date; item_count: number; cover_url: string | null; role: DossierSummary['role'];
    }>(
      `SELECT d.id, d.owner_id, d.kind, d.title, d.tags, d.visibility, d.updated_at,
              (SELECT count(*)::int FROM dossier_items i WHERE i.dossier_id = d.id) AS item_count,
              (SELECT i.data->>'url' FROM dossier_items i WHERE i.dossier_id = d.id AND i.media_id = d.cover_media_id LIMIT 1) AS cover_url,
              CASE WHEN d.owner_id = $1 THEN 'owner' ELSE s.role::text END AS role
       FROM dossiers d
       LEFT JOIN dossier_shares s ON s.dossier_id = d.id AND s.user_id = $1 AND d.visibility <> 'private'
       WHERE d.deleted_at IS NULL
         AND CASE $2::text
               WHEN 'mine'   THEN d.owner_id = $1
               WHEN 'shared' THEN d.owner_id <> $1 AND s.user_id IS NOT NULL
               ELSE               d.owner_id = $1 OR s.user_id IS NOT NULL
             END
         AND ($3::text IS NULL OR d.title ILIKE $3 OR d.summary_md ILIKE $3 OR array_to_string(d.tags, ' ') ILIKE $3)
       ORDER BY d.updated_at DESC
       LIMIT 500`,
      [userId, scope, likePattern(q)],
    );
    return r.rows.map((x) => ({
      id: x.id, ownerId: x.owner_id, kind: x.kind, title: x.title, tags: x.tags, visibility: x.visibility,
      coverMediaUrl: x.cover_url, updatedAt: x.updated_at.toISOString(), itemCount: x.item_count, role: x.role,
    }));
  }

  async get(id: string): Promise<Dossier | null> {
    if (!isUuid(id)) return null;
    const d = (
      await this.db.query<{
        id: string; owner_id: string; kind: Dossier['kind']; title: string; summary_md: string; tags: string[];
        visibility: Dossier['visibility']; cover_media_id: string | null; version: number; updated_at: Date;
      }>(
        `SELECT id, owner_id, kind, title, summary_md, tags, visibility, cover_media_id, version, updated_at
         FROM dossiers WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      )
    ).rows[0];
    if (!d) return null;
    const [items, shares, members] = await Promise.all([
      this.db.query<ItemRow>(
        `SELECT id, type, data, source, position, media_id, created_at FROM dossier_items
         WHERE dossier_id = $1 ORDER BY position, created_at`,
        [id],
      ),
      this.db.query<{ user_id: string; display_name: string; role: Share['role'] }>(
        `SELECT s.user_id, u.display_name, s.role FROM dossier_shares s JOIN users u ON u.id = s.user_id
         WHERE s.dossier_id = $1 ORDER BY s.created_at`,
        [id],
      ),
      this.db.query<{ member_id: string }>(
        `SELECT m.member_id FROM dossier_members m JOIN dossiers x ON x.id = m.member_id AND x.deleted_at IS NULL
         WHERE m.group_id = $1 ORDER BY m.position, x.title`,
        [id],
      ),
    ]);
    const cover = d.cover_media_id ? items.rows.find((i) => i.media_id === d.cover_media_id) : undefined;
    return {
      id: d.id,
      ownerId: d.owner_id,
      kind: d.kind,
      title: d.title,
      summaryMd: d.summary_md,
      tags: d.tags,
      visibility: d.visibility,
      shares: shares.rows.map((s) => ({ userId: s.user_id, displayName: s.display_name, role: s.role })),
      memberIds: members.rows.map((m) => m.member_id),
      coverMediaUrl: typeof cover?.data.url === 'string' ? cover.data.url : null,
      items: items.rows.map(toItem),
      version: d.version,
      updatedAt: d.updated_at.toISOString(),
    };
  }

  private async reload(id: string): Promise<Dossier> {
    return (await this.get(id)) ?? notFound();
  }

  async create(input: Pick<Dossier, 'ownerId' | 'kind' | 'title' | 'summaryMd' | 'tags'>) {
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO dossiers (owner_id, kind, title, summary_md, tags) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.ownerId, input.kind, input.title, input.summaryMd, input.tags],
    );
    return this.reload(r.rows[0]!.id);
  }

  async update(
    id: string,
    version: number,
    patch: Partial<Pick<Dossier, 'title' | 'summaryMd' | 'tags' | 'visibility' | 'memberIds' | 'coverMediaUrl'>>,
  ) {
    await tx(this.db, async (c) => {
      await lockAndBump(c, 'dossiers', id, version);
      const sets: string[] = [];
      const vals: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };
      if (patch.title !== undefined) set('title', patch.title);
      if (patch.summaryMd !== undefined) set('summary_md', patch.summaryMd);
      if (patch.tags !== undefined) set('tags', patch.tags);
      if (patch.visibility !== undefined) set('visibility', patch.visibility);
      if (patch.coverMediaUrl !== undefined) {
        // Обложка — одно из изображений этого досье.
        const m = patch.coverMediaUrl
          ? (await c.query<{ media_id: string }>(
              `SELECT media_id FROM dossier_items WHERE dossier_id = $1 AND type = 'media' AND data->>'url' = $2 LIMIT 1`,
              [id, patch.coverMediaUrl],
            )).rows[0]?.media_id ?? null
          : null;
        set('cover_media_id', m);
      }
      if (sets.length) await c.query(`UPDATE dossiers SET ${sets.join(', ')} WHERE id = $1`, vals);
      if (patch.memberIds !== undefined) {
        await c.query(`DELETE FROM dossier_members WHERE group_id = $1`, [id]);
        // Только существующие досье и не само себя; порядок — как пришёл.
        await c.query(
          `INSERT INTO dossier_members (group_id, member_id, position)
           SELECT $1, d.id, m.ord FROM unnest($2::text[]) WITH ORDINALITY AS m(member_id, ord)
           JOIN dossiers d ON d.id::text = m.member_id AND d.deleted_at IS NULL AND d.id <> $1
           ON CONFLICT DO NOTHING`,
          [id, patch.memberIds],
        );
      }
    });
    return this.reload(id);
  }

  async addItem(id: string, item: DossierItem, actorId: string) {
    await tx(this.db, async (c) => {
      const { ownerId } = await lockAndBump(c, 'dossiers', id);
      const data = itemData(item);
      let mediaId: string | null = null;
      if (item.type === 'media') {
        mediaId = await upsertMedia(c, ownerId, item.url, item.caption);
        data.mediaId = mediaId;
      }
      await c.query(
        `INSERT INTO dossier_items (id, dossier_id, type, data, source, position, media_id, created_by)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8)`,
        [newObjectId(item.id), id, item.type, json(data), item.source ? json(item.source) : null, item.position, mediaId, actorId],
      );
      // Снимок поиска в досье больше не удаляется при чистке истории.
      if (item.type === 'snapshot' && isUuid(item.searchId)) {
        await c.query(`UPDATE search_jobs SET pinned = true WHERE id = $1`, [item.searchId]);
      }
    });
    return this.reload(id);
  }

  async updateItem(id: string, item: DossierItem) {
    await tx(this.db, async (c) => {
      const { ownerId } = await lockAndBump(c, 'dossiers', id);
      const data = itemData(item);
      let mediaId: string | null = null;
      if (item.type === 'media') {
        mediaId = await upsertMedia(c, ownerId, item.url, item.caption);
        data.mediaId = mediaId;
      }
      const r = await c.query(
        `UPDATE dossier_items SET type = $3, data = $4::jsonb, source = $5::jsonb, position = $6, media_id = $7
         WHERE id = $1 AND dossier_id = $2`,
        [mustUuid(item.id), id, item.type, json(data), item.source ? json(item.source) : null, item.position, mediaId],
      );
      if (!r.rowCount) notFound();
    });
    return this.reload(id);
  }

  async removeItem(id: string, itemId: string) {
    await tx(this.db, async (c) => {
      await lockAndBump(c, 'dossiers', id);
      if (!isUuid(itemId)) return;
      const r = await c.query<{ media_id: string | null }>(
        `DELETE FROM dossier_items WHERE id = $1 AND dossier_id = $2 RETURNING media_id`,
        [itemId, id],
      );
      // Удалили изображение-обложку — обложки больше нет (если та же картинка не осталась другим элементом).
      const mediaId = r.rows[0]?.media_id;
      if (mediaId) {
        await c.query(
          `UPDATE dossiers SET cover_media_id = NULL WHERE id = $1 AND cover_media_id = $2
             AND NOT EXISTS (SELECT 1 FROM dossier_items WHERE dossier_id = $1 AND media_id = $2)`,
          [id, mediaId],
        );
      }
    });
    return this.reload(id);
  }

  async reorderItems(id: string, orderedIds: string[]) {
    await tx(this.db, async (c) => {
      await lockAndBump(c, 'dossiers', id);
      await c.query(
        `UPDATE dossier_items i SET position = o.ord - 1
         FROM unnest($2::text[]) WITH ORDINALITY AS o(item_id, ord)
         WHERE i.dossier_id = $1 AND i.id::text = o.item_id`,
        [id, orderedIds],
      );
    });
    return this.reload(id);
  }

  async setShares(id: string, shares: Share[], actorId: string) {
    await tx(this.db, async (c) => {
      await lockAndBump(c, 'dossiers', id);
      await c.query(`DELETE FROM dossier_shares WHERE dossier_id = $1`, [id]);
      const valid = shares.filter((s) => isUuid(s.userId));
      if (valid.length) {
        await c.query(
          `INSERT INTO dossier_shares (dossier_id, user_id, role, granted_by)
           SELECT $1, s.user_id, s.role, $3 FROM jsonb_to_recordset($2::jsonb) AS s(user_id uuid, role share_role)
           JOIN users u ON u.id = s.user_id`,
          [id, json(valid.map((s) => ({ user_id: s.userId, role: s.role }))), actorId],
        );
      }
    });
    return this.reload(id);
  }

  async remove(id: string) {
    if (!isUuid(id)) return;
    await this.db.query(`UPDATE dossiers SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  }
}

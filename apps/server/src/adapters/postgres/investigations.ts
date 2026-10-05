import { randomBytes } from 'node:crypto';
import type { Fact, GraphEdge, GraphNode, Hypothesis, Investigation, InvestigationSummary, Share, Tag } from '@ft/shared';
import { isUuid } from '@ft/shared';
import type { InvestigationPatch, InvestigationRepo, ListFilter, Scope } from '../../ports.ts';
import { iso, json, likePattern, lockAndBump, replaceTags, tagsJsonSql, tagsFilterSql, newObjectId, notFound, tx, type Db, type Tx } from './db.ts';

// Расследования в PostgreSQL: investigations, investigation_shares, graph_nodes, graph_edges (+ edge_facts),
// facts (+ fact_nodes), hypotheses (+ hypothesis_evidence). Любая правка повышает investigations.version —
// редактор графа по ней понимает, что данные изменились. Идентификаторы узлов, связей, фактов и гипотез
// приходят от клиента (uuid v7) и проверяются на принадлежность этому расследованию.

const ROLE_SQL = `CASE WHEN i.owner_id = $1 THEN 'owner' WHEN s.role IS NOT NULL THEN s.role::text ELSE 'viewer' END`;

export class PgInvestigations implements InvestigationRepo {
  constructor(private db: Db) {}

  async list(userId: string, scope: Scope, filter: ListFilter = {}): Promise<InvestigationSummary[]> {
    const r = await this.db.query<{
      id: string; owner_id: string; title: string; tags: Tag[]; visibility: Investigation['visibility'];
      updated_at: Date; node_count: number; fact_count: number; role: InvestigationSummary['role'];
    }>(
      `SELECT i.id, i.owner_id, i.title, ${tagsJsonSql('investigation', 'i.id')} AS tags, i.visibility, i.updated_at,
              (SELECT count(*)::int FROM graph_nodes n WHERE n.investigation_id = i.id) AS node_count,
              (SELECT count(*)::int FROM facts f WHERE f.investigation_id = i.id) AS fact_count,
              ${ROLE_SQL} AS role
       FROM investigations i
       LEFT JOIN investigation_shares s ON s.investigation_id = i.id AND s.user_id = $1 AND i.visibility <> 'private'
       WHERE i.deleted_at IS NULL
         AND CASE $2::text
               WHEN 'mine'   THEN i.owner_id = $1
               WHEN 'public' THEN i.visibility = 'public'
               WHEN 'shared' THEN i.owner_id <> $1 AND i.visibility = 'shared' AND s.user_id IS NOT NULL
               ELSE               i.owner_id = $1 OR s.user_id IS NOT NULL OR i.visibility = 'public'
             END
         AND ($3::text IS NULL OR i.title ILIKE $3)
         AND ${tagsFilterSql('investigation', 'i.id', '$4', '$1')}
       ORDER BY i.title, i.id
       LIMIT 500`,
      [userId, scope, likePattern(filter.title), (filter.tagIds ?? []).filter(isUuid)],
    );
    return r.rows.map((x) => ({
      id: x.id, ownerId: x.owner_id, title: x.title, tags: x.tags, visibility: x.visibility,
      updatedAt: x.updated_at.toISOString(), nodeCount: x.node_count, factCount: x.fact_count, role: x.role,
    }));
  }

  async get(id: string): Promise<Investigation | null> {
    if (!isUuid(id)) return null;
    const inv = (
      await this.db.query<{
        id: string; owner_id: string; title: string; description_md: string; tags: Tag[];
        visibility: Investigation['visibility']; version: number; updated_at: Date;
      }>(
        `SELECT id, owner_id, title, description_md, ${tagsJsonSql('investigation', 'investigations.id')} AS tags, visibility, version, updated_at
         FROM investigations WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      )
    ).rows[0];
    if (!inv) return null;

    const [shares, nodes, edges, facts, hyps] = await Promise.all([
      this.db.query<{ user_id: string; display_name: string; role: Share['role'] }>(
        `SELECT s.user_id, u.display_name, s.role FROM investigation_shares s JOIN users u ON u.id = s.user_id
         WHERE s.investigation_id = $1 ORDER BY s.created_at`,
        [id],
      ),
      this.db.query<{ id: string; type: GraphNode['type']; label: string; dossier_id: string | null; props: Record<string, string>; x: number; y: number }>(
        `SELECT n.id, n.type, n.label, d.id AS dossier_id, n.props, n.x, n.y
         FROM graph_nodes n LEFT JOIN dossiers d ON d.id = n.dossier_id AND d.deleted_at IS NULL
         WHERE n.investigation_id = $1 ORDER BY n.created_at, n.id`,
        [id],
      ),
      this.db.query<{ id: string; source: string; target: string; relation: string; label: string | null; credibility: GraphEdge['credibility']; fact_ids: string[] }>(
        `SELECT e.id, e.source_node_id AS source, e.target_node_id AS target, e.relation, e.label, e.credibility,
                coalesce(array_agg(ef.fact_id ORDER BY ef.fact_id) FILTER (WHERE ef.fact_id IS NOT NULL), '{}') AS fact_ids
         FROM graph_edges e LEFT JOIN edge_facts ef ON ef.edge_id = e.id
         WHERE e.investigation_id = $1 GROUP BY e.id ORDER BY e.created_at, e.id`,
        [id],
      ),
      this.db.query<{ id: string; text_md: string; occurred_at: Date | null; sources: Fact['sources']; created_at: Date; node_ids: string[] }>(
        `SELECT f.id, f.text_md, f.occurred_at, f.sources, f.created_at,
                coalesce(array_agg(fn.node_id ORDER BY fn.node_id) FILTER (WHERE fn.node_id IS NOT NULL), '{}') AS node_ids
         FROM facts f LEFT JOIN fact_nodes fn ON fn.fact_id = f.id
         WHERE f.investigation_id = $1 GROUP BY f.id ORDER BY f.created_at, f.id`,
        [id],
      ),
      this.db.query<{ id: string; title: string; text_md: string; status: Hypothesis['status']; created_at: Date; evidence: Hypothesis['evidence'] | null }>(
        `SELECT h.id, h.title, h.text_md, h.status, h.created_at,
                jsonb_agg(jsonb_build_object('factId', ev.fact_id, 'stance', ev.stance) ORDER BY ev.fact_id)
                  FILTER (WHERE ev.fact_id IS NOT NULL) AS evidence
         FROM hypotheses h LEFT JOIN hypothesis_evidence ev ON ev.hypothesis_id = h.id
         WHERE h.investigation_id = $1 GROUP BY h.id ORDER BY h.created_at, h.id`,
        [id],
      ),
    ]);

    return {
      id: inv.id,
      ownerId: inv.owner_id,
      title: inv.title,
      descriptionMd: inv.description_md,
      tags: inv.tags,
      visibility: inv.visibility,
      shares: shares.rows.map((s) => ({ userId: s.user_id, displayName: s.display_name, role: s.role })),
      nodes: nodes.rows.map((n) => ({
        id: n.id, type: n.type, label: n.label, dossierId: n.dossier_id, props: n.props ?? {}, position: { x: n.x, y: n.y },
      })),
      edges: edges.rows.map((e) => ({
        id: e.id, source: e.source, target: e.target, relation: e.relation, ...(e.label ? { label: e.label } : {}),
        credibility: e.credibility, factIds: e.fact_ids,
      })),
      facts: facts.rows.map((f) => ({
        id: f.id, textMd: f.text_md, occurredAt: iso(f.occurred_at), sources: f.sources ?? [], nodeIds: f.node_ids,
        createdAt: f.created_at.toISOString(),
      })),
      hypotheses: hyps.rows.map((h) => ({
        id: h.id, title: h.title, textMd: h.text_md, status: h.status, evidence: h.evidence ?? [], createdAt: h.created_at.toISOString(),
      })),
      version: inv.version,
      updatedAt: inv.updated_at.toISOString(),
    };
  }

  private async reload(id: string): Promise<Investigation> {
    return (await this.get(id)) ?? notFound();
  }

  async create(input: Pick<Investigation, 'ownerId' | 'title' | 'descriptionMd'>) {
    const r = await this.db.query<{ id: string }>(
      `INSERT INTO investigations (owner_id, title, description_md) VALUES ($1, $2, $3) RETURNING id`,
      [input.ownerId, input.title, input.descriptionMd],
    );
    return this.reload(r.rows[0]!.id);
  }

  async update(id: string, version: number, patch: InvestigationPatch) {
    await tx(this.db, async (c) => {
      await lockAndBump(c, 'investigations', id, version);
      const sets: string[] = [];
      const vals: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col} = $${vals.length}`);
      };
      if (patch.title !== undefined) set('title', patch.title);
      if (patch.descriptionMd !== undefined) set('description_md', patch.descriptionMd);
      if (patch.visibility !== undefined) {
        set('visibility', patch.visibility);
        // Публичному расследованию нужна неугадываемая ссылка; при повторной публикации — прежняя.
        if (patch.visibility === 'public') {
          vals.push(randomBytes(12).toString('base64url'));
          sets.push(`public_slug = coalesce(public_slug, $${vals.length})`);
        }
      }
      if (sets.length) await c.query(`UPDATE investigations SET ${sets.join(', ')} WHERE id = $1`, vals);
      if (patch.tagIds !== undefined) await replaceTags(c, 'investigation', id, patch.tagIds);
    });
    return this.reload(id);
  }

  async saveGraph(id: string, version: number, nodes: GraphNode[], edges: GraphEdge[]) {
    await tx(this.db, async (c) => {
      await lockAndBump(c, 'investigations', id, version);

      const nodeRows = nodes.map((n) => ({
        id: newObjectId(n.id), type: n.type, label: n.label, dossier_id: isUuid(n.dossierId) ? n.dossierId : null,
        props: n.props ?? {}, x: n.position.x, y: n.position.y,
      }));
      // Узел с тем же id из другого расследования не перезаписывается (WHERE в ON CONFLICT).
      await c.query(
        `INSERT INTO graph_nodes (id, investigation_id, type, label, dossier_id, props, x, y)
         SELECT n.id, $1, n.type, n.label,
                (SELECT d.id FROM dossiers d WHERE d.id = n.dossier_id AND d.deleted_at IS NULL),
                coalesce(n.props, '{}'), n.x, n.y
         FROM jsonb_to_recordset($2::jsonb) AS n(id uuid, type node_type, label text, dossier_id uuid, props jsonb, x float8, y float8)
         ON CONFLICT (id) DO UPDATE
           SET type = EXCLUDED.type, label = EXCLUDED.label, dossier_id = EXCLUDED.dossier_id,
               props = EXCLUDED.props, x = EXCLUDED.x, y = EXCLUDED.y
           WHERE graph_nodes.investigation_id = EXCLUDED.investigation_id`,
        [id, json(nodeRows)],
      );
      await c.query(`DELETE FROM graph_nodes WHERE investigation_id = $1 AND NOT (id = ANY($2::uuid[]))`, [id, nodeRows.map((n) => n.id)]);

      const edgeRows = edges.map((e) => ({
        id: newObjectId(e.id), source: e.source, target: e.target, relation: e.relation, label: e.label ?? null,
        credibility: e.credibility ?? '6',
      }));
      // Связь — только между узлами этого расследования.
      await c.query(
        `INSERT INTO graph_edges (id, investigation_id, source_node_id, target_node_id, relation, label, credibility)
         SELECT e.id, $1, e.source, e.target, e.relation, e.label, e.credibility
         FROM jsonb_to_recordset($2::jsonb) AS e(id uuid, source uuid, target uuid, relation text, label text, credibility text)
         WHERE e.source <> e.target
           AND EXISTS (SELECT 1 FROM graph_nodes n WHERE n.id = e.source AND n.investigation_id = $1)
           AND EXISTS (SELECT 1 FROM graph_nodes n WHERE n.id = e.target AND n.investigation_id = $1)
         ON CONFLICT (id) DO UPDATE
           SET source_node_id = EXCLUDED.source_node_id, target_node_id = EXCLUDED.target_node_id,
               relation = EXCLUDED.relation, label = EXCLUDED.label, credibility = EXCLUDED.credibility
           WHERE graph_edges.investigation_id = EXCLUDED.investigation_id`,
        [id, json(edgeRows.filter((e) => isUuid(e.source) && isUuid(e.target)))],
      );
      await c.query(`DELETE FROM graph_edges WHERE investigation_id = $1 AND NOT (id = ANY($2::uuid[]))`, [id, edgeRows.map((e) => e.id)]);

      // Факты, подтверждающие связи.
      await c.query(`DELETE FROM edge_facts ef USING graph_edges e WHERE e.id = ef.edge_id AND e.investigation_id = $1`, [id]);
      const links = edges.flatMap((e) => (e.factIds ?? []).filter(isUuid).map((f) => ({ edge_id: e.id, fact_id: f })));
      if (links.length) {
        await c.query(
          `INSERT INTO edge_facts (edge_id, fact_id)
           SELECT l.edge_id, l.fact_id FROM jsonb_to_recordset($2::jsonb) AS l(edge_id uuid, fact_id uuid)
           JOIN graph_edges e ON e.id = l.edge_id AND e.investigation_id = $1
           JOIN facts f ON f.id = l.fact_id AND f.investigation_id = $1
           ON CONFLICT DO NOTHING`,
          [id, json(links)],
        );
      }
    });
    return this.reload(id);
  }

  async upsertFact(id: string, fact: Fact, actorId: string) {
    await tx(this.db, async (c) => {
      await lockAndBump(c, 'investigations', id);
      const r = await c.query(
        `INSERT INTO facts (id, investigation_id, text_md, occurred_at, sources, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (id) DO UPDATE SET text_md = EXCLUDED.text_md, occurred_at = EXCLUDED.occurred_at, sources = EXCLUDED.sources
           WHERE facts.investigation_id = EXCLUDED.investigation_id`,
        [newObjectId(fact.id), id, fact.textMd, fact.occurredAt, json(fact.sources ?? []), actorId, fact.createdAt],
      );
      if (!r.rowCount) notFound();
      await replaceLinks(c, 'fact_nodes', 'fact_id', 'node_id', fact.id, fact.nodeIds, 'graph_nodes', id);
    });
    return this.reload(id);
  }

  async removeFact(id: string, factId: string) {
    await tx(this.db, async (c) => {
      await lockAndBump(c, 'investigations', id);
      if (isUuid(factId)) await c.query(`DELETE FROM facts WHERE id = $1 AND investigation_id = $2`, [factId, id]);
    });
    return this.reload(id);
  }

  async upsertHypothesis(id: string, h: Hypothesis, actorId: string) {
    await tx(this.db, async (c) => {
      await lockAndBump(c, 'investigations', id);
      const r = await c.query(
        `INSERT INTO hypotheses (id, investigation_id, title, text_md, status, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, text_md = EXCLUDED.text_md, status = EXCLUDED.status
           WHERE hypotheses.investigation_id = EXCLUDED.investigation_id`,
        [newObjectId(h.id), id, h.title, h.textMd, h.status, actorId, h.createdAt],
      );
      if (!r.rowCount) notFound();
      await c.query(`DELETE FROM hypothesis_evidence WHERE hypothesis_id = $1`, [h.id]);
      const ev = h.evidence.filter((e) => isUuid(e.factId)).map((e) => ({ fact_id: e.factId, stance: e.stance }));
      if (ev.length) {
        await c.query(
          `INSERT INTO hypothesis_evidence (hypothesis_id, fact_id, stance)
           SELECT $1, e.fact_id, e.stance FROM jsonb_to_recordset($2::jsonb) AS e(fact_id uuid, stance evidence_stance)
           JOIN facts f ON f.id = e.fact_id AND f.investigation_id = $3
           ON CONFLICT (hypothesis_id, fact_id) DO UPDATE SET stance = EXCLUDED.stance`,
          [h.id, json(ev), id],
        );
      }
    });
    return this.reload(id);
  }

  async removeHypothesis(id: string, hId: string) {
    await tx(this.db, async (c) => {
      await lockAndBump(c, 'investigations', id);
      if (isUuid(hId)) await c.query(`DELETE FROM hypotheses WHERE id = $1 AND investigation_id = $2`, [hId, id]);
    });
    return this.reload(id);
  }

  async setShares(id: string, shares: Share[], actorId: string) {
    await tx(this.db, async (c) => {
      await lockAndBump(c, 'investigations', id);
      await c.query(`DELETE FROM investigation_shares WHERE investigation_id = $1`, [id]);
      const valid = shares.filter((s) => isUuid(s.userId));
      if (valid.length) {
        await c.query(
          `INSERT INTO investigation_shares (investigation_id, user_id, role, granted_by)
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
    await this.db.query(`UPDATE investigations SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
  }
}

/** Заменить связи «многие ко многим» объекта (только на объекты того же расследования). */
async function replaceLinks(
  c: Tx, table: 'fact_nodes', ownCol: 'fact_id', refCol: 'node_id', ownId: string, refIds: string[],
  refTable: 'graph_nodes', investigationId: string,
) {
  await c.query(`DELETE FROM ${table} WHERE ${ownCol} = $1`, [ownId]);
  const ids = refIds.filter(isUuid);
  if (!ids.length) return;
  await c.query(
    `INSERT INTO ${table} (${ownCol}, ${refCol})
     SELECT $1, r.id FROM ${refTable} r WHERE r.id = ANY($2::uuid[]) AND r.investigation_id = $3
     ON CONFLICT DO NOTHING`,
    [ownId, ids, investigationId],
  );
}

import type { SearchJob, SearchSection } from '@ft/shared';
import { isUuid } from '@ft/shared';
import type { SearchJobInternals, SearchRepo } from '../../ports.ts';
import { json, type Db } from './db.ts';

// История поиска и снимки ответов шлюза (таблица search_jobs).
// «Очистить историю» скрывает записи (hidden_at), а не удаляет: снимки, прикреплённые к досье (pinned), нужны дальше.

interface Row {
  id: string;
  user_id: string;
  section: SearchJob['section'];
  kind: string;
  query: string;
  deep: boolean;
  params: Record<string, string>;
  state: SearchJob['state'];
  error: string | null;
  candidates: string[] | null;
  result: unknown;
  gateway_service: SearchJobInternals['gatewayService'];
  gateway_job_id: string | null;
  started_at: Date;
}

const COLS = `id, user_id, section, kind, query, deep, params, state, error, candidates, result, gateway_service, gateway_job_id, started_at`;

const toJob = (r: Row): SearchJob => ({
  id: r.id,
  section: r.section,
  kind: r.kind,
  query: r.query,
  deep: r.deep,
  params: r.params ?? {},
  state: r.state,
  error: r.error,
  candidates: r.candidates,
  result: r.result ?? null,
  startedAt: r.started_at.toISOString(),
});

export class PgSearches implements SearchRepo {
  constructor(private db: Db) {}

  async create(job: Omit<SearchJob, 'id'> & SearchJobInternals) {
    const finished = job.state === 'done' || job.state === 'failed';
    const r = await this.db.query<Row>(
      `INSERT INTO search_jobs (user_id, section, kind, query, deep, params, state, error, candidates, result,
                                gateway_service, gateway_job_id, started_at, finished_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::jsonb, $11, $12, $13, CASE WHEN $14::boolean THEN now() END)
       RETURNING ${COLS}`,
      [
        job.userId, job.section, job.kind, job.query, job.deep, json(job.params), job.state, job.error, job.candidates,
        job.result === null || job.result === undefined ? null : json(job.result),
        job.gatewayService, job.gatewayJobId, job.startedAt, finished,
      ],
    );
    return toJob(r.rows[0]!);
  }

  async get(id: string, userId: string) {
    if (!isUuid(id)) return null;
    const r = await this.db.query<Row>(`SELECT ${COLS} FROM search_jobs WHERE id = $1 AND user_id = $2`, [id, userId]);
    const row = r.rows[0];
    return row ? { ...toJob(row), userId: row.user_id, gatewayJobId: row.gateway_job_id, gatewayService: row.gateway_service } : null;
  }

  async update(id: string, patch: Partial<SearchJob> & Partial<SearchJobInternals>) {
    if (!isUuid(id)) return;
    const sets: string[] = [];
    const vals: unknown[] = [];
    const set = (col: string, v: unknown, cast = '') => {
      vals.push(v);
      sets.push(`${col} = $${vals.length}${cast}`);
    };
    if (patch.state !== undefined) {
      set('state', patch.state);
      if (patch.state === 'done' || patch.state === 'failed') sets.push('finished_at = now()');
    }
    if (patch.error !== undefined) set('error', patch.error);
    if (patch.result !== undefined) set('result', patch.result === null ? null : json(patch.result), '::jsonb');
    if (patch.candidates !== undefined) set('candidates', patch.candidates);
    if (patch.gatewayJobId !== undefined) set('gateway_job_id', patch.gatewayJobId);
    if (!sets.length) return;
    vals.push(id);
    await this.db.query(`UPDATE search_jobs SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
  }

  async listRecent(userId: string, section: SearchSection, limit: number) {
    // Для списка истории ответ шлюза не нужен — он бывает большим.
    const r = await this.db.query<Row>(
      `SELECT ${COLS.replace('result', 'NULL::jsonb AS result')} FROM search_jobs
       WHERE user_id = $1 AND section = $2 AND hidden_at IS NULL
       ORDER BY started_at DESC LIMIT $3`,
      [userId, section, limit],
    );
    return r.rows.map(toJob);
  }

  async clear(userId: string, section: SearchSection) {
    const r = await this.db.query(`UPDATE search_jobs SET hidden_at = now() WHERE user_id = $1 AND section = $2 AND hidden_at IS NULL`, [
      userId, section,
    ]);
    return r.rowCount ?? 0;
  }
}

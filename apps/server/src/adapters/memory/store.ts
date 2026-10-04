import { randomBytes } from 'node:crypto';
import {
  newId, type Dossier, type DossierItem, type DossierSummary, type Investigation, type InvestigationSummary, type SearchJob,
  type SearchSection, type Share, type User,
} from '@ft/shared';
import { roleOf } from '../../authz.ts';
import {
  VersionConflict,
  type DossierRepo, type InvestigationRepo, type Scope, type SearchJobInternals, type SearchRepo, type SessionRepo, type UserRepo,
} from '../../ports.ts';
import { seedDossiers, seedInvestigations, seedUsers } from './seed.ts';

// In-memory реализации репозиториев. Повторяют контракт будущего PostgreSQL-адаптера:
// оптимистичная блокировка по version, owner/share-фильтры в list(). Данные живут до рестарта.

const now = () => new Date().toISOString();
const clone = <T,>(v: T): T => structuredClone(v);

type StoredUser = Omit<User, 'access'>;

export class MemoryUsers implements UserRepo {
  private byId = new Map<string, StoredUser>(seedUsers.map((u) => [u.id, u]));

  async upsertByTgId(u: { tgId: string; displayName: string; username: string | null }) {
    const existing = [...this.byId.values()].find((x) => x.tgId === u.tgId);
    if (existing) {
      Object.assign(existing, u);
      return { id: existing.id };
    }
    const id = newId();
    this.byId.set(id, { id, ...u });
    return { id };
  }
  async get(id: string) {
    return this.byId.get(id) ?? null;
  }
  async findByUsername(username: string) {
    const n = username.replace(/^@/, '').toLowerCase();
    return [...this.byId.values()].find((u) => u.username?.toLowerCase() === n) ?? null;
  }
}

export class MemorySessions implements SessionRepo {
  private map = new Map<string, { userId: string; expiresAt: number }>();
  async create(userId: string, ttlMs: number) {
    const sid = randomBytes(32).toString('base64url');
    this.map.set(sid, { userId, expiresAt: Date.now() + ttlMs });
    return sid;
  }
  async get(sid: string) {
    const s = this.map.get(sid);
    if (!s || s.expiresAt < Date.now()) return null;
    return { userId: s.userId };
  }
  async delete(sid: string) {
    this.map.delete(sid);
  }
  async deleteAllForUser(userId: string) {
    for (const [k, v] of this.map) if (v.userId === userId) this.map.delete(k);
  }
}

type StoredSearch = SearchJob & SearchJobInternals;

export class MemorySearches implements SearchRepo {
  private map = new Map<string, StoredSearch>();
  async create(job: Omit<SearchJob, 'id'> & SearchJobInternals) {
    const s: StoredSearch = { ...job, id: newId() };
    this.map.set(s.id, s);
    return strip(s);
  }
  async get(id: string, userId: string) {
    const s = this.map.get(id);
    return s && s.userId === userId ? clone(s) : null;
  }
  async update(id: string, patch: Partial<StoredSearch>) {
    const s = this.map.get(id);
    if (s) Object.assign(s, patch);
  }
  async listRecent(userId: string, section: SearchSection, limit: number) {
    return [...this.map.values()]
      .filter((s) => s.userId === userId && s.section === section)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, limit)
      .map(strip);
  }
  async clear(userId: string, section: SearchSection) {
    let n = 0;
    for (const [id, s] of this.map) {
      if (s.userId === userId && s.section === section) {
        this.map.delete(id);
        n++;
      }
    }
    return n;
  }
}

function strip({ userId: _u, gatewayJobId: _g, gatewayService: _s, ...rest }: StoredSearch): SearchJob {
  return rest;
}

function matches(q: string | undefined, ...fields: string[]) {
  if (!q) return true;
  const n = q.toLowerCase();
  return fields.some((f) => f.toLowerCase().includes(n));
}

function bump<T extends { version: number; updatedAt: string }>(obj: T, version?: number) {
  if (version !== undefined && obj.version !== version) throw new VersionConflict(obj.version);
  obj.version += 1;
  obj.updatedAt = now();
}

export class MemoryDossiers implements DossierRepo {
  private map = new Map<string, Dossier>(seedDossiers.map((d) => [d.id, d]));

  private must(id: string) {
    const d = this.map.get(id);
    if (!d) throw new Error('NOT_FOUND');
    return d;
  }

  async list(userId: string, scope: Exclude<Scope, 'public'>, q?: string): Promise<DossierSummary[]> {
    return [...this.map.values()]
      .filter((d) => {
        if (scope === 'mine') return d.ownerId === userId;
        if (scope === 'shared') return d.ownerId !== userId && roleOf(userId, d) !== null;
        return roleOf(userId, d) !== null;
      })
      .filter((d) => matches(q, d.title, d.tags.join(' '), d.summaryMd))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((d) => ({
        id: d.id, ownerId: d.ownerId, kind: d.kind, title: d.title, tags: d.tags, visibility: d.visibility,
        coverMediaUrl: d.coverMediaUrl, updatedAt: d.updatedAt, itemCount: d.items.length, role: roleOf(userId, d)!,
      }));
  }
  async get(id: string) {
    const d = this.map.get(id);
    return d ? clone(d) : null;
  }
  async create(input: Pick<Dossier, 'ownerId' | 'kind' | 'title' | 'summaryMd' | 'tags'>) {
    const d: Dossier = {
      ...input, id: newId(), visibility: 'private', shares: [], memberIds: [], coverMediaUrl: null,
      items: [], version: 1, updatedAt: now(),
    };
    this.map.set(d.id, d);
    return clone(d);
  }
  async update(id: string, version: number, patch: Partial<Dossier>) {
    const d = this.must(id);
    bump(d, version);
    Object.assign(d, patch);
    return clone(d);
  }
  async addItem(id: string, item: DossierItem) {
    const d = this.must(id);
    d.items.push(item);
    bump(d);
    return clone(d);
  }
  async updateItem(id: string, item: DossierItem) {
    const d = this.must(id);
    d.items = d.items.map((i) => (i.id === item.id ? item : i));
    bump(d);
    return clone(d);
  }
  async removeItem(id: string, itemId: string) {
    const d = this.must(id);
    d.items = d.items.filter((i) => i.id !== itemId);
    bump(d);
    return clone(d);
  }
  async reorderItems(id: string, orderedIds: string[]) {
    const d = this.must(id);
    const pos = new Map(orderedIds.map((x, i) => [x, i]));
    for (const it of d.items) if (pos.has(it.id)) it.position = pos.get(it.id)!;
    d.items.sort((a, b) => a.position - b.position);
    bump(d);
    return clone(d);
  }
  async setShares(id: string, shares: Share[]) {
    const d = this.must(id);
    d.shares = shares;
    bump(d);
    return clone(d);
  }
  async remove(id: string) {
    this.map.delete(id);
  }
}

export class MemoryInvestigations implements InvestigationRepo {
  private map = new Map<string, Investigation>(seedInvestigations.map((i) => [i.id, i]));

  private must(id: string) {
    const i = this.map.get(id);
    if (!i) throw new Error('NOT_FOUND');
    return i;
  }

  async list(userId: string, scope: Scope, q?: string): Promise<InvestigationSummary[]> {
    return [...this.map.values()]
      .filter((i) => {
        if (scope === 'all') return roleOf(userId, i) !== null;
        if (scope === 'mine') return i.ownerId === userId;
        if (scope === 'public') return i.visibility === 'public';
        return i.ownerId !== userId && i.visibility === 'shared' && i.shares.some((s) => s.userId === userId);
      })
      .filter((i) => matches(q, i.title, i.tags.join(' '), i.descriptionMd))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((i) => ({
        id: i.id, ownerId: i.ownerId, title: i.title, tags: i.tags, visibility: i.visibility, updatedAt: i.updatedAt,
        nodeCount: i.nodes.length, factCount: i.facts.length, role: roleOf(userId, i) ?? 'viewer',
      }));
  }
  async get(id: string) {
    const i = this.map.get(id);
    return i ? clone(i) : null;
  }
  async create(input: Pick<Investigation, 'ownerId' | 'title' | 'descriptionMd' | 'tags'>) {
    const i: Investigation = {
      ...input, id: newId(), visibility: 'private', shares: [], nodes: [], edges: [], facts: [],
      hypotheses: [], version: 1, updatedAt: now(),
    };
    this.map.set(i.id, i);
    return clone(i);
  }
  async update(id: string, version: number, patch: Partial<Investigation>) {
    const i = this.must(id);
    bump(i, version);
    Object.assign(i, patch);
    return clone(i);
  }
  async saveGraph(id: string, version: number, nodes: Investigation['nodes'], edges: Investigation['edges']) {
    const i = this.must(id);
    bump(i, version);
    i.nodes = nodes;
    i.edges = edges;
    const ids = new Set(nodes.map((n) => n.id));
    for (const f of i.facts) f.nodeIds = f.nodeIds.filter((n) => ids.has(n));
    return clone(i);
  }
  async upsertFact(id: string, fact: Investigation['facts'][number]) {
    const i = this.must(id);
    const idx = i.facts.findIndex((f) => f.id === fact.id);
    if (idx >= 0) i.facts[idx] = fact;
    else i.facts.push(fact);
    bump(i);
    return clone(i);
  }
  async removeFact(id: string, factId: string) {
    const i = this.must(id);
    i.facts = i.facts.filter((f) => f.id !== factId);
    for (const h of i.hypotheses) h.evidence = h.evidence.filter((e) => e.factId !== factId);
    for (const e of i.edges) e.factIds = e.factIds.filter((f) => f !== factId);
    bump(i);
    return clone(i);
  }
  async upsertHypothesis(id: string, h: Investigation['hypotheses'][number]) {
    const i = this.must(id);
    const idx = i.hypotheses.findIndex((x) => x.id === h.id);
    if (idx >= 0) i.hypotheses[idx] = h;
    else i.hypotheses.push(h);
    bump(i);
    return clone(i);
  }
  async removeHypothesis(id: string, hId: string) {
    const i = this.must(id);
    i.hypotheses = i.hypotheses.filter((h) => h.id !== hId);
    bump(i);
    return clone(i);
  }
  async setShares(id: string, shares: Share[]) {
    const i = this.must(id);
    i.shares = shares;
    bump(i);
    return clone(i);
  }
  async remove(id: string) {
    this.map.delete(id);
  }
}

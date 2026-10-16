import { randomBytes } from 'node:crypto';
import {
  DEFAULT_TAG_COLOR, newId, normalizeTagText, type Dossier, type DossierItem, type DossierRelation, type DossierSummary, type Investigation,
  type InvestigationSummary, type RelationType, type SearchJob, type SearchSection, type Share, type Tag, type User,
} from '@ft/shared';
import { roleOf } from '../../authz.ts';
import {
  Conflict, DEFAULT_DISPLAY_NAME, TagExists, VersionConflict,
  type DossierContent, type DossierHead, type DossierPatch, type DossierRepo, type InvestigationContent, type InvestigationPatch, type InvestigationRepo,
  type ListFilter, type Scope, type SearchJobInternals, type UidMatch,
  type RelationRepo, type SearchRepo, type SessionRepo, type TagRepo, type UserRepo,
} from '../../ports.ts';
import { seedDossiers, seedInvestigations, seedRelations, seedTagColors, seedUsers } from './seed.ts';

// In-memory реализации репозиториев. Повторяют контракт будущего PostgreSQL-адаптера:
// оптимистичная блокировка по version, owner/share-фильтры в list(). Данные живут до рестарта.

const now = () => new Date().toISOString();
const clone = <T,>(v: T): T => structuredClone(v);

type StoredUser = Omit<User, 'access'>;

export class MemoryUsers implements UserRepo {
  private byId = new Map<string, StoredUser>(seedUsers.map((u) => [u.id, u]));

  async upsertByTgId(u: { tgId: string; displayName: string | null; username: string | null }) {
    const existing = [...this.byId.values()].find((x) => x.tgId === u.tgId);
    if (existing) {
      // null — бот не сообщил имя/ник: прежние значения остаются.
      if (u.displayName !== null) existing.displayName = u.displayName;
      if (u.username !== null) existing.username = u.username;
      return { id: existing.id };
    }
    const id = newId();
    this.byId.set(id, { id, tgId: u.tgId, displayName: u.displayName ?? DEFAULT_DISPLAY_NAME, username: u.username });
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

/** hidden — снимок из файла импорта: в истории не показывается. */
type StoredSearch = SearchJob & SearchJobInternals & { hidden?: boolean };

export class MemorySearches implements SearchRepo {
  private map = new Map<string, StoredSearch>();
  async create(job: Omit<SearchJob, 'id'> & SearchJobInternals) {
    const s: StoredSearch = { ...job, id: newId() };
    this.map.set(s.id, s);
    return strip(s);
  }
  async importSnapshot(userId: string, job: Omit<SearchJob, 'id'>) {
    const same = [...this.map.values()].find(
      (s) => s.userId === userId && s.section === job.section && s.kind === job.kind && s.query === job.query && s.deep === job.deep
        && s.startedAt === job.startedAt,
    );
    if (same) return same.id;
    const s: StoredSearch = {
      ...clone(job), id: newId(), userId, gatewayJobId: null, gatewayService: job.section === 'tg' ? 'tgcmnts' : 'ruleaks', hidden: true,
    };
    this.map.set(s.id, s);
    return s.id;
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
      .filter((s) => s.userId === userId && s.section === section && !s.hidden)
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

function strip({ userId: _u, gatewayJobId: _g, gatewayService: _s, hidden: _h, ...rest }: StoredSearch): SearchJob {
  return rest;
}

/** Фильтр списка: подстрока названия без учёта регистра и все выбранные теги (по тексту). */
function matches(f: ListFilter, title: string, tags: Tag[], filterTags: Tag[]) {
  const q = f.title?.trim().toLowerCase();
  if (q && !title.toLowerCase().includes(q)) return false;
  return filterTags.every((ft) => tags.some((t) => t.text === ft.text));
}

function bump<T extends { version: number; updatedAt: string }>(obj: T, version?: number) {
  if (version !== undefined && obj.version !== version) throw new VersionConflict(obj.version);
  obj.version += 1;
  obj.updatedAt = now();
}

/** Словарь тегов в памяти; досье и расследования хранят только id тегов. */
export class MemoryTags implements TagRepo {
  private map = new Map<string, Tag>();

  /** Тег из словаря владельца по тексту (для демо-данных): есть — берём, нет — заводим. */
  ensure(ownerId: string, text: string): string {
    const t = normalizeTagText(text);
    const found = [...this.map.values()].find((x) => x.ownerId === ownerId && x.text === t);
    if (found) return found.id;
    const tag: Tag = { id: newId(), ownerId, text: t, color: seedTagColors[t] ?? DEFAULT_TAG_COLOR };
    this.map.set(tag.id, tag);
    return tag.id;
  }
  /** Теги фильтра: только из словаря пользователя. */
  filterTags(userId: string, ids: string[] = []): Tag[] {
    return this.resolve(ids).filter((t) => t.ownerId === userId);
  }
  /** Теги по id; удалённые из словаря пропускаются. */
  resolve(ids: string[]): Tag[] {
    return ids.flatMap((id) => {
      const t = this.map.get(id);
      return t ? [{ ...t }] : [];
    });
  }

  async list(userId: string) {
    return [...this.map.values()].filter((t) => t.ownerId === userId).sort((a, b) => a.text.localeCompare(b.text)).map((t) => ({ ...t }));
  }
  async create(userId: string, text: string, color: string) {
    if ([...this.map.values()].some((t) => t.ownerId === userId && t.text === text)) throw new TagExists();
    const tag: Tag = { id: newId(), ownerId: userId, text, color };
    this.map.set(tag.id, tag);
    return { ...tag };
  }
  async update(userId: string, id: string, patch: { text?: string; color?: string }) {
    const t = this.map.get(id);
    if (!t || t.ownerId !== userId) throw new Error('NOT_FOUND');
    if (patch.text !== undefined && [...this.map.values()].some((x) => x.ownerId === userId && x.id !== id && x.text === patch.text)) {
      throw new TagExists();
    }
    if (patch.text !== undefined) t.text = patch.text;
    if (patch.color !== undefined) t.color = patch.color;
    return { ...t };
  }
  async remove(userId: string, id: string) {
    if (this.map.get(id)?.ownerId === userId) this.map.delete(id);
  }
}

type StoredDossier = Omit<Dossier, 'tags'> & { tagIds: string[] };
type StoredInvestigation = Omit<Investigation, 'tags'> & { tagIds: string[] };

export class MemoryDossiers implements DossierRepo {
  private map: Map<string, StoredDossier>;

  constructor(private tags: MemoryTags) {
    this.map = new Map(seedDossiers.map(({ tags: texts, ...d }) => [d.id, { ...d, uid: newId(), tagIds: texts.map((x) => tags.ensure(d.ownerId, x)) }]));
  }

  private out({ tagIds, ...d }: StoredDossier): Dossier {
    return { ...clone(d), tags: this.tags.resolve(tagIds) };
  }

  private must(id: string) {
    const d = this.map.get(id);
    if (!d) throw new Error('NOT_FOUND');
    return d;
  }

  async list(userId: string, scope: Exclude<Scope, 'public'>, filter: ListFilter = {}): Promise<DossierSummary[]> {
    const ft = this.tags.filterTags(userId, filter.tagIds);
    return [...this.map.values()]
      .filter((d) => {
        if (scope === 'mine') return d.ownerId === userId;
        if (scope === 'shared') return d.ownerId !== userId && roleOf(userId, d) !== null;
        return roleOf(userId, d) !== null;
      })
      .map((d) => this.out(d))
      .filter((d) => matches(filter, d.title, d.tags, ft))
      .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
      .map((d) => ({
        id: d.id, ownerId: d.ownerId, kind: d.kind, title: d.title, tags: d.tags, visibility: d.visibility,
        coverMediaUrl: d.coverMediaUrl, updatedAt: d.updatedAt, itemCount: d.items.length, role: roleOf(userId, d)!,
      }));
  }
  async get(id: string) {
    const d = this.map.get(id);
    return d ? this.out(d) : null;
  }
  async heads(ids: string[]): Promise<DossierHead[]> {
    return [...new Set(ids)].flatMap((id) => {
      const d = this.map.get(id);
      return d ? [{ id: d.id, ownerId: d.ownerId, kind: d.kind, title: d.title, visibility: d.visibility, shares: clone(d.shares), coverMediaUrl: d.coverMediaUrl }] : [];
    });
  }
  async create({ uid, ...input }: Pick<Dossier, 'ownerId' | 'kind' | 'title' | 'summaryMd'> & { uid?: string }) {
    const d: StoredDossier = {
      ...input, id: newId(), uid: uid ?? newId(), tagIds: [], visibility: 'private', shares: [], memberIds: [], coverMediaUrl: null,
      items: [], version: 1, updatedAt: now(),
    };
    this.map.set(d.id, d);
    return this.out(d);
  }
  async findByUid(ownerId: string, uids: string[]): Promise<UidMatch[]> {
    return [...this.map.values()].filter((d) => d.ownerId === ownerId && uids.includes(d.uid)).map((d) => ({ id: d.id, uid: d.uid, title: d.title }));
  }
  async replaceContent(id: string, { tagIds, ...content }: DossierContent) {
    const d = this.must(id);
    Object.assign(d, clone(content), { tagIds: [...tagIds] });
    bump(d);
    return this.out(d);
  }
  async update(id: string, version: number, patch: DossierPatch) {
    const d = this.must(id);
    bump(d, version);
    Object.assign(d, patch);
    return this.out(d);
  }
  async addItem(id: string, item: DossierItem) {
    const d = this.must(id);
    d.items.push(item);
    bump(d);
    return this.out(d);
  }
  async updateItem(id: string, item: DossierItem) {
    const d = this.must(id);
    d.items = d.items.map((i) => (i.id === item.id ? item : i));
    bump(d);
    return this.out(d);
  }
  async removeItem(id: string, itemId: string) {
    const d = this.must(id);
    const gone = d.items.find((i) => i.id === itemId);
    d.items = d.items.filter((i) => i.id !== itemId);
    // Удалили изображение-обложку — обложки больше нет (если та же картинка не осталась другим элементом).
    if (gone?.type === 'media' && gone.url === d.coverMediaUrl && !d.items.some((i) => i.type === 'media' && i.url === gone.url)) d.coverMediaUrl = null;
    bump(d);
    return this.out(d);
  }
  async reorderItems(id: string, orderedIds: string[]) {
    const d = this.must(id);
    const pos = new Map(orderedIds.map((x, i) => [x, i]));
    for (const it of d.items) if (pos.has(it.id)) it.position = pos.get(it.id)!;
    d.items.sort((a, b) => a.position - b.position);
    bump(d);
    return this.out(d);
  }
  async setShares(id: string, shares: Share[]) {
    const d = this.must(id);
    d.shares = shares;
    bump(d);
    return this.out(d);
  }
  async remove(id: string) {
    this.map.delete(id);
  }
}

export class MemoryInvestigations implements InvestigationRepo {
  private map: Map<string, StoredInvestigation>;

  constructor(private tags: MemoryTags) {
    this.map = new Map(seedInvestigations.map(({ tags: texts, ...i }) => [i.id, { ...i, uid: newId(), tagIds: texts.map((x) => tags.ensure(i.ownerId, x)) }]));
  }

  private out({ tagIds, ...i }: StoredInvestigation): Investigation {
    return { ...clone(i), tags: this.tags.resolve(tagIds) };
  }

  private must(id: string) {
    const i = this.map.get(id);
    if (!i) throw new Error('NOT_FOUND');
    return i;
  }

  async list(userId: string, scope: Scope, filter: ListFilter = {}): Promise<InvestigationSummary[]> {
    const ft = this.tags.filterTags(userId, filter.tagIds);
    return [...this.map.values()]
      .filter((i) => {
        if (scope === 'all') return roleOf(userId, i) !== null;
        if (scope === 'mine') return i.ownerId === userId;
        if (scope === 'public') return i.visibility === 'public';
        return i.ownerId !== userId && i.visibility === 'shared' && i.shares.some((s) => s.userId === userId);
      })
      .map((i) => this.out(i))
      .filter((i) => matches(filter, i.title, i.tags, ft))
      .sort((a, b) => a.title.localeCompare(b.title, 'ru'))
      .map((i) => ({
        id: i.id, ownerId: i.ownerId, title: i.title, tags: i.tags, visibility: i.visibility, updatedAt: i.updatedAt,
        nodeCount: i.nodes.length, factCount: i.facts.length, role: roleOf(userId, i) ?? 'viewer',
      }));
  }
  async get(id: string) {
    const i = this.map.get(id);
    return i ? this.out(i) : null;
  }
  async create({ uid, ...input }: Pick<Investigation, 'ownerId' | 'title' | 'descriptionMd'> & { uid?: string }) {
    const i: StoredInvestigation = {
      ...input, id: newId(), uid: uid ?? newId(), tagIds: [], visibility: 'private', shares: [], nodes: [], edges: [], facts: [],
      hypotheses: [], version: 1, updatedAt: now(),
    };
    this.map.set(i.id, i);
    return this.out(i);
  }
  async findByUid(ownerId: string, uids: string[]): Promise<UidMatch[]> {
    return [...this.map.values()].filter((i) => i.ownerId === ownerId && uids.includes(i.uid)).map((i) => ({ id: i.id, uid: i.uid, title: i.title }));
  }
  async replaceContent(id: string, { tagIds, ...content }: InvestigationContent) {
    const i = this.must(id);
    Object.assign(i, clone(content), { tagIds: [...tagIds] });
    bump(i);
    return this.out(i);
  }
  async update(id: string, version: number, patch: InvestigationPatch) {
    const i = this.must(id);
    bump(i, version);
    Object.assign(i, patch);
    return this.out(i);
  }
  async saveGraph(id: string, version: number, nodes: Investigation['nodes'], edges: Investigation['edges']) {
    const i = this.must(id);
    bump(i, version);
    i.nodes = nodes;
    i.edges = edges;
    const ids = new Set(nodes.map((n) => n.id));
    for (const f of i.facts) f.nodeIds = f.nodeIds.filter((n) => ids.has(n));
    return this.out(i);
  }
  async upsertFact(id: string, fact: Investigation['facts'][number]) {
    const i = this.must(id);
    const idx = i.facts.findIndex((f) => f.id === fact.id);
    if (idx >= 0) i.facts[idx] = fact;
    else i.facts.push(fact);
    bump(i);
    return this.out(i);
  }
  async removeFact(id: string, factId: string) {
    const i = this.must(id);
    i.facts = i.facts.filter((f) => f.id !== factId);
    for (const h of i.hypotheses) h.evidence = h.evidence.filter((e) => e.factId !== factId);
    for (const e of i.edges) e.factIds = e.factIds.filter((f) => f !== factId);
    bump(i);
    return this.out(i);
  }
  async upsertHypothesis(id: string, h: Investigation['hypotheses'][number]) {
    const i = this.must(id);
    const idx = i.hypotheses.findIndex((x) => x.id === h.id);
    if (idx >= 0) i.hypotheses[idx] = h;
    else i.hypotheses.push(h);
    bump(i);
    return this.out(i);
  }
  async removeHypothesis(id: string, hId: string) {
    const i = this.must(id);
    i.hypotheses = i.hypotheses.filter((h) => h.id !== hId);
    bump(i);
    return this.out(i);
  }
  async setShares(id: string, shares: Share[]) {
    const i = this.must(id);
    i.shares = shares;
    bump(i);
    return this.out(i);
  }
  async remove(id: string) {
    this.map.delete(id);
  }
}

/** Предопределённые типы связей — как в миграции 20261005200000_dossier-relations. */
const PREDEFINED_RELATIONS = ['родственник', 'совместная работа', 'совместная учеба', 'совместная служба'];

/** Связи между досье персон и словарь их типов в памяти. */
export class MemoryRelations implements RelationRepo {
  private types = new Map<string, RelationType>(PREDEFINED_RELATIONS.map((text) => {
    const id = newId();
    return [id, { id, ownerId: null, text }];
  }));
  private rels = new Map<string, Omit<DossierRelation, 'typeText'> & { createdBy: string }>();

  constructor() {
    for (const r of seedRelations) {
      const type = [...this.types.values()].find((t) => t.text === r.type)!;
      const id = newId();
      this.rels.set(id, {
        id, fromId: r.fromId, toId: r.toId, typeId: type.id, fromNote: r.fromNote, toNote: r.toNote, createdAt: new Date().toISOString(), createdBy: r.createdBy,
      });
    }
  }

  private out({ createdBy: _c, ...r }: Omit<DossierRelation, 'typeText'> & { createdBy: string }): DossierRelation {
    return { ...r, typeText: this.types.get(r.typeId)?.text ?? '' };
  }

  async listTypes(userId: string) {
    const all = [...this.types.values()];
    return [...all.filter((t) => t.ownerId === null), ...all.filter((t) => t.ownerId === userId).sort((a, b) => a.text.localeCompare(b.text))]
      .map((t) => ({ ...t }));
  }
  async createType(userId: string, text: string) {
    if ([...this.types.values()].some((t) => t.text === text && (t.ownerId === null || t.ownerId === userId))) {
      throw new Conflict('RELATION_TYPE_EXISTS');
    }
    const t: RelationType = { id: newId(), ownerId: userId, text };
    this.types.set(t.id, t);
    return { ...t };
  }
  async removeType(userId: string, id: string) {
    if (this.types.get(id)?.ownerId !== userId) return;
    this.types.delete(id);
    for (const [rid, r] of this.rels) if (r.typeId === id) this.rels.delete(rid);
  }
  async list(dossierId: string) {
    return [...this.rels.values()].filter((r) => r.fromId === dossierId || r.toId === dossierId).map((r) => this.out(r));
  }
  async get(id: string) {
    const r = this.rels.get(id);
    return r ? this.out(r) : null;
  }
  async add(
    rel: { dossierId: string; otherId: string; typeId: string; note?: string | null; otherNote?: string | null },
    actorId: string,
  ) {
    const same = [...this.rels.values()].find(
      (r) => r.typeId === rel.typeId && ((r.fromId === rel.dossierId && r.toId === rel.otherId) || (r.fromId === rel.otherId && r.toId === rel.dossierId)),
    );
    if (same) {
      const forward = same.fromId === rel.dossierId;
      if (rel.note !== undefined) same[forward ? 'fromNote' : 'toNote'] = rel.note;
      if (rel.otherNote !== undefined) same[forward ? 'toNote' : 'fromNote'] = rel.otherNote;
      return this.out(same);
    }
    const r = {
      id: newId(), fromId: rel.dossierId, toId: rel.otherId, typeId: rel.typeId, fromNote: rel.note ?? null, toNote: rel.otherNote ?? null,
      createdAt: new Date().toISOString(), createdBy: actorId,
    };
    this.rels.set(r.id, r);
    return this.out(r);
  }
  async remove(id: string) {
    this.rels.delete(id);
  }
}

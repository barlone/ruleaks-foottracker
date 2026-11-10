import type { GoogleProfile } from '@ft/shared';
import { isDefaultFlathash, photoFlathash } from './flathash.ts';
import { bodyJson, GoogleError, query, type Ctx } from './net.ts';
import type { GoogleSession } from './session.ts';

// apis/peoplepa.py + parsers/people.py: внутренний People API (people-pa.clients6.google.com) от имени веб-сессии.
// Поиск по e-mail отдаёт «персону» с данными по контейнерам: PROFILE — публичный профиль Google,
// CONTACT / DOMAIN_PROFILE — запись в контактах или домене служебного аккаунта.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const containerOf = (item: Json): string => text(obj(item.metadata).container) ?? 'unknown';

/** Шаблон max_details из peoplepa.py. */
const MAX_DETAILS = {
  'extension_set.extension_names': ['DYNAMITE_ADDITIONAL_DATA', 'DYNAMITE_ORGANIZATION_INFO'],
  'request_mask.include_field.paths': [
    'person.metadata.best_display_name',
    'person.photo',
    'person.cover_photo',
    'person.interaction_settings',
    'person.legacy_fields',
    'person.metadata',
    'person.in_app_reachability',
    'person.name',
    'person.read_only_profile_info',
    'person.sort_keys',
    'person.email',
  ],
  'request_mask.include_container': [
    'AFFINITY', 'PROFILE', 'DOMAIN_PROFILE', 'ACCOUNT', 'EXTERNAL_ACCOUNT', 'CIRCLE', 'DOMAIN_CONTACT', 'DEVICE_CONTACT', 'GOOGLE_GROUP', 'CONTACT',
  ],
  'core_id_params.enable_private_names': true,
} as const;

export interface PersonLookup {
  /** Контейнеры, в которых найдена цель. */
  containers: string[];
  /** null — публичного профиля (контейнер PROFILE) нет. */
  profile: GoogleProfile | null;
}

/** «GOOGLE_CHAT» → «Google Chat» (в GHunt — str.title()). */
const titleCase = (s: string) => s.toLowerCase().replace(/_/g, ' ').replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/** lastUpdatedMicros: микросекунды строкой; GHunt берёт первые 10 цифр — секунды. */
function microsToIso(v: unknown): string | null {
  const s = text(v) ?? (typeof v === 'number' ? String(v) : null);
  if (!s || !/^\d{10,}$/.test(s)) return null;
  return new Date(Number(s.slice(0, 10)) * 1000).toISOString();
}

/** parsers/people.py Person._scrape — данные контейнера PROFILE. */
async function parsePerson(person: Json, ctx: Ctx): Promise<PersonLookup> {
  const sourceIds = arr(obj(obj(person.metadata).identityInfo).sourceIds);
  const containers = [...new Set(sourceIds.map((s) => text(s.container)).filter((c): c is string => !!c))];
  const gaiaId = text(person.personId);
  if (!containers.includes('PROFILE') || !gaiaId) return { containers, profile: null };

  const inProfile = (items: unknown) => arr(items).filter((i) => containerOf(i) === 'PROFILE');
  const first = (items: unknown) => inProfile(items)[0];

  // Фото: GHunt берёт последнее из списка и считает его фото профиля; здесь — фото контейнера PROFILE, иначе любое.
  const photoItem = first(person.photo) ?? arr(person.photo).at(-1);
  let photo: GoogleProfile['photo'] = null;
  const photoUrl = text(photoItem?.url);
  if (photoItem && photoUrl) {
    const flathash = await photoFlathash(photoUrl, ctx);
    // Кроме хеша силуэта (GHunt) — флаги самого API и адрес: буква-монограмма тоже стандартная картинка, а на силуэт не похожа.
    const isDefault = (flathash !== null && isDefaultFlathash(flathash)) || photoItem.isDefault === true || photoItem.isMonogram === true || photoUrl.includes('/a/default-user');
    photo = { url: photoUrl, isDefault, flathash };
  }

  const coverItem = first(person.coverPhoto) ?? arr(person.coverPhoto)[0];
  let cover: GoogleProfile['cover'] = null;
  const coverUrl = text(coverItem?.imageUrl);
  if (coverItem && coverUrl) {
    // Обрезается суффикс размера после последнего «=».
    const cut = coverUrl.lastIndexOf('=');
    cover = { url: cut > 0 ? coverUrl.slice(0, cut) : coverUrl, isDefault: coverItem.isDefault === true };
  }

  const extended = obj(person.extendedData);
  const dynamite = obj(extended.dynamiteExtendedData);
  const gplus = obj(extended.gplusExtendedData);
  const userTypes = first(person.readOnlyProfileInfo)?.ownerUserType;

  return {
    containers,
    profile: {
      gaiaId,
      email: text(first(person.email)?.value),
      // Имена Google из этого ответа убрал (в GHunt разбор закомментирован) — но если придут, не терять.
      name: text(first(person.name)?.displayName),
      photo,
      cover,
      lastUpdated: microsToIso(sourceIds.find((s) => s.container === 'PROFILE')?.lastUpdatedMicros),
      userTypes: Array.isArray(userTypes) ? userTypes.filter((t): t is string => typeof t === 'string') : [],
      entityType: text(dynamite.entityType),
      customerId: text(obj(obj(obj(dynamite.organizationInfo).customerInfo).customerId).customerId),
      enterprise: typeof gplus.isEnterpriseUser === 'boolean' ? gplus.isEnterpriseUser : null,
      apps: inProfile(person.inAppReachability).map((a) => text(a.appType)).filter((a): a is string => !!a).map(titleCase),
    },
  };
}

/** peoplepa.py people_lookup, шаблон max_details. null — аккаунта Google на этот адрес нет. */
export async function lookupByEmail(session: GoogleSession, email: string, ctx: Ctx): Promise<PersonLookup | null> {
  const url = `https://people-pa.clients6.google.com/v2/people/lookup?${query({ id: email, type: 'EMAIL', match_type: 'EXACT', ...MAX_DETAILS })}`;
  const res = await session.webApi('photos', url, ctx);
  const data = obj(await bodyJson(res, ctx));
  if (res.status !== 200) {
    const err = obj(data.error);
    const detail = `People API: HTTP ${res.status}${err.status ? ` ${String(err.status)}` : ''}${err.message ? ` — ${String(err.message)}` : ''}`;
    throw new GoogleError(res.status === 403 ? 'AUTH' : res.status === 429 ? 'BLOCKED' : 'HTTP', detail);
  }
  const person = Object.values(obj(data.people))[0];
  if (!person) return null;
  return parsePerson(obj(person), ctx);
}

import type { GooglePlayer } from '@ft/shared';
import { androidUserAgent, PLAYGAMES_APP, PLAYGATEWAY_EXT, WEB_HEADERS } from './knowledge.ts';
import { bodyJson, gfetch, GoogleError, grpcUnary, query, type Ctx } from './net.ts';
import { all, dig, field, str } from './proto.ts';
import type { GoogleSession } from './session.ts';

// Play Игры (helpers/playgames.py): профиль игрока ищется по e-mail через gRPC-шлюз приложения «Play Игры»
// (apis/playgateway.py), подробности — обычным HTTP API игр (apis/playgames.py). Оба — с токеном OAuth,
// выданным по мастер-токену «от имени» приложения com.google.android.play.games.

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

const GATEWAY = 'playgateway-pa.googleapis.com';
const GET_PAGE = '/play.gateway.adapter.interplay.v1.PlayGatewayInterplayService/GetPage';
const GAMES_API = 'https://www.googleapis.com/games/v1whitelisted/players';
/** Больше страниц списков игр и достижений не листаем (по 50–100 записей на странице). */
const MAX_PAGES = 20;
const GAMES_SHOWN = 20;

/** Время в миллисекундах строкой → ISO; GHunt берёт первые 10 цифр — секунды. */
function millisToIso(v: unknown): string | null {
  const s = text(v) ?? (typeof v === 'number' ? String(v) : null);
  if (!s || !/^\d{10,}$/.test(s)) return null;
  return new Date(Number(s.slice(0, 10)) * 1000).toISOString();
}

/** Запрос с токеном приложения; на 401 токен запрашивается заново и запрос повторяется один раз. */
async function withToken<T>(session: GoogleSession, ctx: Ctx, call: (token: string) => Promise<T>): Promise<T> {
  try {
    return await call(await session.oauth(PLAYGAMES_APP, ctx));
  } catch (e) {
    if (!(e instanceof GoogleError) || e.code !== 'AUTH') throw e;
    session.dropOauth(PLAYGAMES_APP);
    return call(await session.oauth(PLAYGAMES_APP, ctx));
  }
}

interface Candidate {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * apis/playgateway.py search_player. Сообщения — из protos/playgatewaypa/definitions:
 *   запрос   PlayerSearchProto { search_form = 2 { query = 233436060 { text = 1 } } }
 *   ответ    PlayerSearchResultsProto { field1 = 1 { results = 192500038 { field1 = 1 { field1 = 1 {
 *              repeated player = 232977370 { avatar = 3 { url = 1 }, account = 6 { id = 1, name = 3 } } } } } } }
 */
async function searchPlayer(session: GoogleSession, text_: string, ctx: Ctx): Promise<Candidate[]> {
  const message = field(2, field(233436060, field(1, text_)));
  const headers: Record<string, string> = { 'user-agent': androidUserAgent(PLAYGAMES_APP.pkg) };
  for (const [k, v] of Object.entries(PLAYGATEWAY_EXT)) headers[`x-goog-ext-${k}-bin`] = v;
  const reply = await withToken(session, ctx, (token) => grpcUnary(GATEWAY, GET_PAGE, { ...headers, authorization: `OAuth ${token}` }, message, ctx));
  return all(dig(reply, 1, 192500038, 1, 1), 232977370)
    .map((p) => ({ id: str(p, 6, 1), name: str(p, 6, 3), avatarUrl: str(p, 3, 1) || null }))
    .filter((c) => c.id);
}

async function gamesApi(session: GoogleSession, ctx: Ctx, path: string, params: Record<string, string | boolean> = {}, method: 'GET' | 'POST' = 'GET'): Promise<Json> {
  const q = query(params);
  return withToken(session, ctx, async (token) => {
    const res = await gfetch(`${GAMES_API}/${path}${q ? `?${q}` : ''}`, { method, headers: { ...WEB_HEADERS, Authorization: `OAuth ${token}` } }, ctx);
    const data = obj(await bodyJson(res, ctx));
    if (res.status === 401) throw new GoogleError('AUTH', `Play Игры: HTTP 401 ${String(obj(data.error).message ?? '')}`);
    return data;
  });
}

/** Все страницы списка (items + nextPageToken), не больше MAX_PAGES. */
async function pages(session: GoogleSession, ctx: Ctx, path: string, params: Record<string, string | boolean>, method: 'GET' | 'POST'): Promise<Json[]> {
  const items: Json[] = [];
  let token = '';
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gamesApi(session, ctx, path, token ? { ...params, pageToken: token } : params, method);
    if (!Array.isArray(data.items)) break;
    items.push(...arr(data.items));
    token = text(data.nextPageToken) ?? '';
    if (!token) break;
  }
  return items;
}

/** helpers/playgames.py search_player + get_player + output. null — игрового профиля на этот адрес нет. */
export async function playerByEmail(session: GoogleSession, email: string, ctx: Ctx): Promise<GooglePlayer | null> {
  const candidate = (await searchPlayer(session, email, ctx))[0];
  if (!candidate) return null;
  const id = encodeURIComponent(candidate.id);

  const player: GooglePlayer = {
    id: candidate.id, name: candidate.name, avatarUrl: candidate.avatarUrl,
    visible: false, gamerTag: null, title: null, level: null, xp: null,
    playedGames: 0, achievements: 0, lastPlayed: null, topGame: null, games: [],
  };

  // apis/playgames.py get_profile
  const profile = obj((await gamesApi(session, ctx, id)).displayPlayer);
  if (!Object.keys(profile).length) return player;
  player.name = text(profile.displayName) ?? player.name;
  player.avatarUrl = text(profile.avatarImageUrl) ?? player.avatarUrl;
  player.gamerTag = text(profile.gamerTag);
  player.title = text(profile.title);
  const xp = obj(profile.experienceInfo);
  const level = obj(xp.currentLevel).level;
  player.level = typeof level === 'number' ? level : null;
  player.xp = text(xp.currentExperiencePoints) ?? (typeof xp.currentExperiencePoints === 'number' ? String(xp.currentExperiencePoints) : null);
  player.visible = obj(profile.profileSettings).profileVisible === true;
  if (!player.visible) return player;

  const lastApp = obj(profile.lastPlayedApp);
  if (text(lastApp.applicationName)) player.lastPlayed = { name: text(lastApp.applicationName)!, at: millisToIso(lastApp.timeMillis) };

  // get_played_games, get_achievements — все страницы
  const games = await pages(session, ctx, `${id}/applications/played`, {}, 'GET');
  const achievements = await pages(session, ctx, `${id}/achievements`, { state: 'UNLOCKED', returnDefinitions: true, sortOrder: 'RECENT_FIRST' }, 'POST');
  player.playedGames = games.length;
  player.achievements = achievements.length;
  player.games = games.slice(0, GAMES_SHOWN).map((g) => ({
    name: text(obj(g.gamesData).name) ?? '—',
    lastPlayed: millisToIso(g.lastPlayedTimeMillis),
    achievements: typeof g.unlockedAchievementCount === 'number' ? g.unlockedAchievementCount : null,
  }));

  // Игра с наибольшим числом достижений (helpers/playgames.py output).
  const byApp = new Map<string, number>();
  for (const a of achievements) {
    const app = text(a.application_id) ?? text(a.applicationId);
    if (app) byApp.set(app, (byApp.get(app) ?? 0) + 1);
  }
  const top = [...byApp.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const game = games.find((g) => obj(g.gamesData).id === top[0]);
    const name = text(obj(game?.gamesData).name);
    if (name) player.topGame = { name, achievements: top[1] };
  }
  return player;
}

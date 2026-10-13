import { existsSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { isUrl } from '@ft/config';
import { appConfig } from './config.ts';
import type { Deps } from './ports.ts';
import { sessionOf } from './trpc.ts';

// Свои тайлы карты поиска по геоданным ([geo-search] tiles = pmtiles с путями на сервере).
// Файл .pmtiles и basemaps-assets (шрифты, спрайты) отдаются здесь же и только вошедшим пользователям.
// Браузер читает .pmtiles Range-запросами (библиотека pmtiles), поэтому отдельный тайл-сервер не нужен.

export const GEO_TILES_PATH = '/geo/tiles.pmtiles';
export const GEO_ASSETS_PATH = '/geo/assets';

export async function registerGeoFiles(app: FastifyInstance, deps: Deps) {
  const geo = appConfig.geo;
  if (!geo.enabled || geo.tiles !== 'pmtiles') return;
  const tiles = isUrl(geo.pmtiles) ? null : resolve(geo.pmtiles);
  const assets = isUrl(geo.assets) ? null : resolve(geo.assets);
  if (!tiles && !assets) return;

  // Сайт работает и без карты: неверный путь — предупреждение в логе, а не отказ стартовать.
  if (tiles && !(existsSync(tiles) && statSync(tiles).isFile())) app.log.warn(`geo: файл тайлов не найден: ${tiles}`);
  if (assets && !existsSync(`${assets}/fonts`)) app.log.warn(`geo: в ${assets} нет каталога fonts/ (basemaps-assets)`);

  // serve: false — файлы отдаются только из маршрутов ниже, после проверки сессии. send сам отвечает
  // на Range (206) и If-None-Match / If-Modified-Since и не выпускает за пределы корня.
  await app.register(fastifyStatic, { root: assets ?? dirname(tiles!), serve: false, cacheControl: false });

  const authed = async (req: FastifyRequest) => (await sessionOf(deps, req)).userId !== null;

  if (tiles) {
    app.get(GEO_TILES_PATH, async (req, reply) => {
      if (!(await authed(req))) return reply.code(401).send();
      // Выгрузку обновили — ETag другой, и pmtiles перечитывает заголовок файла.
      reply.header('Cache-Control', 'private, max-age=3600');
      return reply.sendFile(basename(tiles), dirname(tiles));
    });
  }
  if (assets) {
    app.get(`${GEO_ASSETS_PATH}/*`, async (req, reply) => {
      if (!(await authed(req))) return reply.code(401).send();
      reply.header('Cache-Control', 'private, max-age=86400');
      return reply.sendFile((req.params as { '*': string })['*'], assets);
    });
  }
}

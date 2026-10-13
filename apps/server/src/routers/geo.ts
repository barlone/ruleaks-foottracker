import { isUrl } from '@ft/config';
import { appConfig } from '../config.ts';
import { GEO_ASSETS_PATH, GEO_TILES_PATH } from '../geo-files.ts';
import { authedProcedure, router } from '../trpc.ts';

// Поиск по геоданным ([config] geo-search): настройки карты для браузера.

const geo = appConfig.geo;

/** Что нужно браузеру, чтобы собрать стиль карты. Относительные адреса — от адреса сайта. */
export type GeoClientConfig = {
  maxZoom: number;
  tiles:
    | { kind: 'raster'; url: string; attribution: string }
    | { kind: 'pmtiles'; url: string; glyphs: string; sprite: string; lang: string };
};

function clientConfig(): GeoClientConfig | null {
  if (!geo.enabled) return null;
  if (geo.tiles === 'raster') return { maxZoom: geo.maxZoom, tiles: { kind: 'raster', url: geo.rasterUrl, attribution: geo.rasterAttribution } };
  const assets = isUrl(geo.assets) ? geo.assets : GEO_ASSETS_PATH;
  return {
    maxZoom: geo.maxZoom,
    tiles: {
      kind: 'pmtiles',
      url: isUrl(geo.pmtiles) ? geo.pmtiles : GEO_TILES_PATH,
      glyphs: `${assets}/fonts/{fontstack}/{range}.pbf`,
      sprite: `${assets}/sprites/v4/dark`,
      lang: geo.lang,
    },
  };
}

export const geoRouter = router({
  /** null — раздел выключен. */
  config: authedProcedure.query(() => clientConfig()),
});

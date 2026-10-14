import * as maplibregl from 'maplibre-gl';
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
// Воркер MapLibre ищет рядом со своим модулем по import.meta.url — после бандлинга Vite его там нет.
// ?worker&url — Vite собирает воркер отдельным файлом и отдаёт его адрес.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { RouterOutputs } from '../../lib/trpc.ts';

// Общее для карт MapLibre: GeoPicker (выбор точки) и GeoPointsMap (найденные геолокации).

export type GeoPoint = { lat: number; lon: number };
/** Настройки карты с сервера ([geo-search] в config.ini). */
export type GeoConfig = NonNullable<RouterOutputs['geo']['config']>;

export const MINT = '#2ee0ac';
export const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

// Тёмная схема Protomaps, подогнанная под фон сайта.
const FLAVOR = { ...namedFlavor('dark'), background: '#060b09', earth: '#0b1210' };

/** Адрес от корня сайта → полный (MapLibre и pmtiles требуют абсолютные). new URL не годится: экранирует {fontstack}. */
const abs = (u: string) => (u.startsWith('/') ? `${location.origin}${u}` : u);

maplibregl.setWorkerUrl(maplibreWorkerUrl);

let pmtilesProtocol = false;

export function buildStyle(cfg: GeoConfig): StyleSpecification {
  const t = cfg.tiles;
  if (t.kind === 'raster') {
    return {
      version: 8,
      sources: { base: { type: 'raster', tiles: [t.url], tileSize: 256, maxzoom: 19, attribution: t.attribution } },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#0a0f0d' } },
        // Светлые тайлы OSM → тёмные: min > max инвертирует яркость, поворот оттенка возвращает цвета воды и зелени.
        {
          id: 'base', type: 'raster', source: 'base',
          paint: { 'raster-brightness-min': 0.85, 'raster-brightness-max': 0.04, 'raster-hue-rotate': 180, 'raster-saturation': -0.4, 'raster-contrast': -0.1 },
        },
      ],
    };
  }
  if (!pmtilesProtocol) {
    maplibregl.addProtocol('pmtiles', new Protocol().tile);
    pmtilesProtocol = true;
  }
  return {
    version: 8,
    glyphs: abs(t.glyphs),
    sprite: abs(t.sprite),
    sources: {
      protomaps: {
        type: 'vector',
        url: `pmtiles://${abs(t.url)}`,
        attribution: '<a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
      },
    },
    // Слои basemaps описаны своей копией style-spec — по смыслу те же типы.
    layers: layers('protomaps', FLAVOR, { lang: t.lang }) as LayerSpecification[],
  };
}

/** Карта без поворота и наклона (для выбора и просмотра точек они не нужны и только путают), с зумом и масштабной линейкой. */
export function createMap(container: HTMLElement, cfg: GeoConfig, center: [number, number], zoom: number): maplibregl.Map {
  const map = new maplibregl.Map({
    container,
    style: buildStyle(cfg),
    center,
    zoom,
    maxZoom: cfg.maxZoom,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
  });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  return map;
}

/** Круг радиуса radiusM вокруг точки — многоугольник по большим кругам (сфера), как его видит карта в Меркаторе. */
export function circle(p: GeoPoint, radiusM: number, steps = 128): Feature<Polygon> {
  const rad = Math.PI / 180;
  const d = radiusM / 6371008.8;
  const φ1 = p.lat * rad;
  const λ1 = p.lon * rad;
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1), Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([λ2 / rad, φ2 / rad]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

/** Границы [[minLon, minLat], [maxLon, maxLat]] точек с кругами; null — точек нет. */
export function boundsOf(points: { lat: number; lon: number; radiusM?: number | null }[]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    const ring = p.radiusM ? circle(p, p.radiusM, 32).geometry.coordinates[0]! : [[p.lon, p.lat]];
    for (const [x, y] of ring as [number, number][]) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y);
      x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return [[x0, y0], [x1, y1]];
}

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, Polygon } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
// Воркер MapLibre ищет рядом со своим модулем по import.meta.url — после бандлинга Vite его там нет.
// ?worker&url — Vite собирает воркер отдельным файлом и отдаёт его адрес.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { RouterOutputs } from '../../lib/trpc.ts';

export type GeoPoint = { lat: number; lon: number };
/** Настройки карты с сервера ([geo-search] в config.ini). */
export type GeoConfig = NonNullable<RouterOutputs['geo']['config']>;

const DEFAULT_CENTER: [number, number] = [37.6173, 55.7558];
const MINT = '#2ee0ac';
const EMPTY: FeatureCollection ={ type: 'FeatureCollection', features: [] };

// Тёмная схема Protomaps, подогнанная под фон сайта.
const FLAVOR = { ...namedFlavor('dark'), background: '#060b09', earth: '#0b1210' };

/** Адрес от корня сайта → полный (MapLibre и pmtiles требуют абсолютные). new URL не годится: экранирует {fontstack}. */
const abs = (u: string) => (u.startsWith('/') ? `${location.origin}${u}` : u);

maplibregl.setWorkerUrl(maplibreWorkerUrl);

let pmtilesProtocol = false;

function buildStyle(cfg: GeoConfig): StyleSpecification {
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

/** Круг радиуса radiusM вокруг точки — многоугольник по большим кругам (сфера), как его видит карта в Меркаторе. */
function circle(p: GeoPoint, radiusM: number, steps = 128): Feature<Polygon> {
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

/** Долгота после щелчка по копии мира справа/слева выходит за ±180 — wrap() возвращает её в диапазон. */
const toPoint = (ll: maplibregl.LngLat): GeoPoint => {
  const w = ll.wrap();
  return { lat: w.lat, lon: w.lng };
};

function markerElement() {
  const el = document.createElement('div');
  el.className = 'ft-geo-marker';
  el.appendChild(document.createElement('span'));
  return el;
}

/**
 * Карта MapLibre с выбором точки: щелчок ставит маркер, маркер можно перетаскивать; вокруг точки — круг радиуса radiusM.
 * focus — счётчик: при его изменении карта показывает круг (или точку) целиком.
 */
export function GeoPicker({
  config, point, radiusM, onPick, focus, className,
}: {
  config: GeoConfig;
  point: GeoPoint | null;
  radiusM: number | null;
  onPick: (p: GeoPoint) => void;
  focus: number;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const pickRef = useRef(onPick);
  // Слой круга можно добавить только после загрузки стиля.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: box.current!,
      style: buildStyle(config),
      center: point ? [point.lon, point.lat] : DEFAULT_CENTER,
      zoom: 10,
      maxZoom: config.maxZoom,
      attributionControl: { compact: true },
      // Поворот и наклон для выбора точки не нужны и только путают.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    map.on('click', (e) => pickRef.current(toPoint(e.lngLat)));
    map.on('load', () => {
      map.addSource('pick', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'pick-fill', type: 'fill', source: 'pick', paint: { 'fill-color': MINT, 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'pick-line', type: 'line', source: 'pick', paint: { 'line-color': MINT, 'line-width': 1.5 } });
      setReady(true);
    });

    const marker = new maplibregl.Marker({ element: markerElement(), draggable: true });
    marker.on('dragend', () => pickRef.current(toPoint(marker.getLngLat())));

    mapRef.current = map;
    markerRef.current = marker;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      setReady(false);
    };
    // Стиль и карта создаются заново только при смене настроек; точка дальше двигается эффектами ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const lat = point?.lat;
  const lon = point?.lon;

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    if (lat === undefined || lon === undefined) marker.remove();
    else marker.setLngLat([lon, lat]).addTo(map);
  }, [config, lat, lon]);

  useEffect(() => {
    if (!ready) return;
    const src = mapRef.current?.getSource<GeoJSONSource>('pick');
    src?.setData(lat !== undefined && lon !== undefined && radiusM ? circle({ lat, lon }, radiusM) : EMPTY);
  }, [ready, lat, lon, radiusM]);

  useEffect(() => {
    const map = mapRef.current;
    if (!focus || !map || lat === undefined || lon === undefined) return;
    // Задержка — чтобы карта не прыгала на каждую набранную цифру («5» → «59» → «59.9»).
    const t = setTimeout(() => {
      if (!radiusM) {
        map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 13), duration: 400 });
        return;
      }
      const ring = circle({ lat, lon }, radiusM, 64).geometry.coordinates[0]!;
      const xs = ring.map((c) => c[0]!);
      const ys = ring.map((c) => c[1]!);
      map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 24, maxZoom: config.maxZoom, duration: 400 });
    }, 350);
    return () => clearTimeout(t);
    // Только по focus: точка, выбранная на самой карте, не должна двигать вид.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  return <div ref={box} className={className} />;
}

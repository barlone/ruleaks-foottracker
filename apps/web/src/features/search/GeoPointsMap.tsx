import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { EMPTY, MINT, boundsOf, circle, createMap, type GeoConfig } from './geoMap.ts';

/** Найденная геоточка: координаты, необязательный радиус и строки для подписи (значение, утечка, «Прочее»). */
export type FoundGeoPoint = { lat: number; lon: number; radiusM: number | null; lines: string[] };

/** Сколько строк показывать в подписи точки (одна точка может встречаться во многих записях). */
const POPUP_LINES = 8;

/**
 * Карта найденных геолокаций: точки, круги радиусов, масштаб — чтобы были видны все.
 * Щелчок по точке — подпись. Значения из утечек выводятся только как текст (textContent), не HTML.
 */
export function GeoPointsMap({ config, points, className }: { config: GeoConfig; points: FoundGeoPoint[]; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const pointsRef = useRef(points);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    const map = createMap(box.current!, config, [37.6173, 55.7558], 3);
    const popup = new maplibregl.Popup({ closeButton: false, maxWidth: '320px', className: 'ft-geo-popup' });
    map.on('load', () => {
      map.addSource('radii', { type: 'geojson', data: EMPTY });
      map.addSource('pts', { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'radii-fill', type: 'fill', source: 'radii', paint: { 'fill-color': MINT, 'fill-opacity': 0.08 } });
      map.addLayer({ id: 'radii-line', type: 'line', source: 'radii', paint: { 'line-color': MINT, 'line-width': 1, 'line-opacity': 0.6 } });
      map.addLayer({
        id: 'pts', type: 'circle', source: 'pts',
        paint: { 'circle-radius': 5, 'circle-color': MINT, 'circle-stroke-color': '#001a13', 'circle-stroke-width': 2 },
      });
      setReady(true);
    });
    map.on('click', 'pts', (e) => {
      const f = e.features?.[0];
      const p = f ? pointsRef.current[f.properties.i as number] : undefined;
      if (!p) return;
      const el = document.createElement('div');
      for (const [n, line] of p.lines.slice(0, POPUP_LINES).entries()) {
        const row = document.createElement('div');
        row.textContent = line;
        if (n === 0) row.className = 'ft-geo-popup-title';
        el.appendChild(row);
      }
      if (p.lines.length > POPUP_LINES) {
        const more = document.createElement('div');
        more.textContent = `… ещё ${p.lines.length - POPUP_LINES}`;
        el.appendChild(more);
      }
      popup.setLngLat([p.lon, p.lat]).setDOMContent(el).addTo(map);
    });
    map.on('mouseenter', 'pts', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'pts', () => (map.getCanvas().style.cursor = ''));
    mapRef.current = map;
    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, [config]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const pts: FeatureCollection = {
      type: 'FeatureCollection',
      features: points.map((p, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })),
    };
    const radii: FeatureCollection = {
      type: 'FeatureCollection',
      features: points.filter((p) => p.radiusM).map((p) => circle(p, p.radiusM!, 64)),
    };
    map.getSource<GeoJSONSource>('pts')?.setData(pts);
    map.getSource<GeoJSONSource>('radii')?.setData(radii);
    const b = boundsOf(points);
    if (b) map.fitBounds(b, { padding: 40, maxZoom: 14, animate: false });
  }, [ready, points]);

  return <div ref={box} className={className} />;
}

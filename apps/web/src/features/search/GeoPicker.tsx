import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource } from 'maplibre-gl';
import { EMPTY, MINT, boundsOf, circle, createMap, type GeoConfig, type GeoPoint } from './geoMap.ts';

export type { GeoConfig, GeoPoint } from './geoMap.ts';

const DEFAULT_CENTER: [number, number] = [37.6173, 55.7558];

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
    const map = createMap(box.current!, config, point ? [point.lon, point.lat] : DEFAULT_CENTER, 10);
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
      map.fitBounds(boundsOf([{ lat, lon, radiusM }])!, { padding: 24, maxZoom: config.maxZoom, duration: 400 });
    }, 350);
    return () => clearTimeout(t);
    // Только по focus: точка, выбранная на самой карте, не должна двигать вид.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  return <div ref={box} className={className} />;
}

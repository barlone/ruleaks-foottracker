import { lazy, Suspense } from 'react';
import { Link } from '@tanstack/react-router';
import { MapPin, Search, Wifi } from 'lucide-react';
import { GEO_RADIUS_MAX_M, geoQuery, type GoogleGeoReport } from '@ft/shared';
import { Card, CopyButton, Empty, Spinner, Tag } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { Ext, Mono, None, Row, SectionCard } from './GoogleParts.tsx';

// Отчёт геолокации точки доступа Wi-Fi (modules/geolocate.py): координаты и точность по базе Google, адрес от
// Nominatim. Если включён «Поиск по геоданным» — карта (MapLibre грузится отдельным чанком) и переход к поиску
// записей утечек в круге точности вокруг точки.

const GeoPointsMap = lazy(() => import('./GeoPointsMap.tsx').then((m) => ({ default: m.GeoPointsMap })));

/** Радиус поиска по утечкам: точность Google, но не меньше 50 м и не больше предела шлюза. */
const searchRadius = (accuracyM: number) => Math.min(GEO_RADIUS_MAX_M, Math.max(50, Math.round(accuracyM)));

export function GoogleGeoResult({ report }: { report: GoogleGeoReport }) {
  const geo = trpc.geo.config.useQuery(undefined, { staleTime: Infinity });
  if (!report.found || report.lat === null || report.lon === null) {
    return <Empty>Google не знает {report.bssids.length > 1 ? 'этих точек доступа' : 'эту точку доступа'} — координат нет.</Empty>;
  }
  const { lat, lon } = report;
  const accuracy = report.accuracyM ?? 0;
  const coords = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  const radius = searchRadius(accuracy);
  return (
    <>
      <Card title={<><Wifi size={13} /> Точка доступа Wi-Fi</>}>
        <div className="divide-y divide-line-soft">
          <Row label="BSSID">
            <div className="flex flex-wrap gap-1.5">{report.bssids.map((b) => <Tag key={b} tone="dim">{b}</Tag>)}</div>
          </Row>
          <Row label="Координаты"><span className="inline-flex items-center gap-2"><Mono>{coords}</Mono><CopyButton value={coords} title="Скопировать координаты" /></span></Row>
          <Row label="Точность">{accuracy ? `± ${accuracy.toLocaleString('ru-RU')} м` : <None />}</Row>
          <Row label="Открыть на карте">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Ext href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}>Google Карты</Ext>
              <Ext href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`}>OpenStreetMap</Ext>
            </div>
          </Row>
          {geo.data && (
            <Row label="Поиск по утечкам">
              <Link to="/search/geo" search={{ q: geoQuery(lat, lon, radius) }} className="inline-flex items-center gap-1.5 font-mono text-xs text-mint hover:underline">
                <Search size={12} /> записи с геолокацией в радиусе {radius.toLocaleString('ru-RU')} м
              </Link>
            </Row>
          )}
        </div>
      </Card>
      <SectionCard title="Адрес" icon={<MapPin size={13} />} section={report.address}>
        {(a) => (a ? (
          <div className="divide-y divide-line-soft">
            <Row label="Адрес">{a.display}</Row>
            {(a.city || a.country) && <Row label="Город, страна">{[a.city, a.country].filter(Boolean).join(', ')}</Row>}
          </div>
        ) : <None>адрес по координатам не определён</None>)}
      </SectionCard>
      {geo.data && (
        <Suspense fallback={<Empty><Spinner /></Empty>}>
          <GeoPointsMap config={geo.data} points={[{ lat, lon, radiusM: accuracy || null, lines: [report.bssids.join(', '), `± ${accuracy} м`] }]} className="ft-map h-[420px] w-full" />
        </Suspense>
      )}
    </>
  );
}

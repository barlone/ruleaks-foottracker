import { useCallback, useState, type ClipboardEvent } from 'react';
import { Crosshair, Eraser, MapPin } from 'lucide-react';
import { Button, Card, Empty, Field, Input, Spinner, Tag } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { GeoPicker, type GeoConfig, type GeoPoint } from './GeoPicker.tsx';

const MAX_RADIUS_KM = 1000;

/** Число с точкой или запятой в дробной части; null — пусто или не число. */
function num(s: string): number | null {
  const t = s.trim().replace(',', '.');
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** «55.7558, 37.6173» (как копируют из карт) — пара координат; «55,75» — одно число с запятой, не пара. */
function pair(s: string): [string, string] | null {
  const m = s.trim().match(/^([-+]?\d+(?:\.\d+)?)\s*(?:[;\s]|,\s*)\s*([-+]?\d+(?:\.\d+)?)$/);
  if (!m || /^[-+]?\d+,\d+$/.test(s.trim())) return null;
  return [m[1]!, m[2]!];
}

const fmt = (v: number) => v.toFixed(6);

/** «Поиск по геоданным» — прототип: точка на карте и радиус. API геопоиска пока нет, поиск не запускается. */
export function GeoSearchPage() {
  // null — раздел выключен в config.ini ([config] geo-search).
  const geo = trpc.geo.config.useQuery(undefined, { staleTime: Infinity });
  if (geo.isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6" />
      </div>
    );
  }
  if (!geo.data) {
    return (
      <div className="py-6 pl-6 pr-[30px]">
        <Empty>Поиск по геоданным выключен в настройках сервера.</Empty>
      </div>
    );
  }
  return <GeoSearch config={geo.data} />;
}

function GeoSearch({ config }: { config: GeoConfig }) {
  const [latText, setLatText] = useState('');
  const [lonText, setLonText] = useState('');
  const [radiusText, setRadiusText] = useState('1');
  // Счётчик для GeoPicker: изменился — карта показывает круг целиком.
  const [focus, setFocus] = useState(0);

  const lat = num(latText);
  const lon = num(lonText);
  const radiusKm = num(radiusText);
  const latBad = latText.trim() !== '' && (lat === null || Math.abs(lat) > 90);
  const lonBad = lonText.trim() !== '' && (lon === null || Math.abs(lon) > 180);
  const radiusBad = radiusText.trim() !== '' && (radiusKm === null || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM);
  const point: GeoPoint | null = lat !== null && lon !== null && !latBad && !lonBad ? { lat, lon } : null;
  const radiusM = radiusKm !== null && !radiusBad ? radiusKm * 1000 : null;

  const pick = useCallback((p: GeoPoint) => {
    setLatText(fmt(p.lat));
    setLonText(fmt(p.lon));
  }, []);

  function typeCoord(which: 'lat' | 'lon', v: string) {
    if (which === 'lat') setLatText(v);
    else setLonText(v);
    setFocus((f) => f + 1);
  }

  /** Вставленная в любое из полей пара «lat, lon» раскладывается по обоим (только при вставке — не мешает набору). */
  function pastePair(e: ClipboardEvent<HTMLInputElement>) {
    const p = pair(e.clipboardData.getData('text'));
    if (!p) return;
    e.preventDefault();
    setLatText(p[0]);
    setLonText(p[1]);
    setFocus((f) => f + 1);
  }

  return (
    <div className="space-y-6 py-6 pl-6 pr-[30px]">
      <header className="animate-fade-up">
        <h1 className="text-2xl font-extrabold">Поиск по геоданным</h1>
        <p className="mt-1 text-sm text-dim">Выберите точку на карте или введите координаты и задайте радиус области поиска.</p>
      </header>

      <Card className="animate-fade-up">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            setFocus((f) => f + 1);
          }}
        >
          <div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_160px_auto]">
            <Field label="Latitude">
              <Input
                value={latText}
                onChange={(e) => typeCoord('lat', e.target.value)}
                onPaste={pastePair}
                placeholder="55.755800"
                className={latBad ? 'h-12 font-mono !border-danger/60' : 'h-12 font-mono'}
                inputMode="decimal"
              />
            </Field>
            <Field label="Longitude">
              <Input
                value={lonText}
                onChange={(e) => typeCoord('lon', e.target.value)}
                onPaste={pastePair}
                placeholder="37.617300"
                className={lonBad ? 'h-12 font-mono !border-danger/60' : 'h-12 font-mono'}
                inputMode="decimal"
              />
            </Field>
            <Field label="Радиус, км">
              <Input
                value={radiusText}
                onChange={(e) => {
                  setRadiusText(e.target.value);
                  setFocus((f) => f + 1);
                }}
                placeholder="1"
                className={radiusBad ? 'h-12 font-mono !border-danger/60' : 'h-12 font-mono'}
                inputMode="decimal"
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" className="h-12" disabled={!point} title="Показать область на карте">
                <Crosshair size={16} /> Показать
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-12"
                disabled={!latText && !lonText}
                title="Убрать точку"
                onClick={() => {
                  setLatText('');
                  setLonText('');
                }}
              >
                <Eraser size={16} />
              </Button>
              <Button type="button" variant="primary" className="h-12 px-6" disabled title="API поиска по геоданным пока не подключено">
                Искать
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-dim">
            <span className="flex items-center gap-1.5"><MapPin size={14} className="text-mint/70" /> Щёлкните по карте или перетащите маркер; пару «широта, долгота» можно вставить в любое поле.</span>
            {latBad && <Tag tone="warn">широта — число от −90 до 90</Tag>}
            {lonBad && <Tag tone="warn">долгота — число от −180 до 180</Tag>}
            {radiusBad && <Tag tone="warn">радиус — от 0 до {MAX_RADIUS_KM} км</Tag>}
            <Tag tone="dim">прототип: поиск пока не подключён</Tag>
          </div>
        </form>
      </Card>

      {/* isolate — z-index элементов управления карты не выходят за её пределы и не перекрывают кнопку «наверх». */}
      <div className="isolate animate-fade-up overflow-hidden rounded-2xl border border-line">
        <GeoPicker config={config} point={point} radiusM={radiusM} onPick={pick} focus={focus} className="ft-map h-[560px] w-full" />
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState, type ClipboardEvent } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Crosshair, Eraser, Link2, MapPin } from 'lucide-react';
import { GEO_RADIUS_MAX_M, geoQuery, parseGeoloc } from '@ft/shared';
import { Button, Card, Dialog, Empty, Field, Input, Spinner, Tag } from '../../components/ui.tsx';
import { trpc } from '../../lib/trpc.ts';
import { errorText } from '../../lib/errors.ts';
import { JobView } from './AttrSearchPage.tsx';
import { SearchLayout, useRunOnMount, useSearchJob } from './common.tsx';
import { GeoPicker, type GeoConfig, type GeoPoint } from './GeoPicker.tsx';
import { isShortMapLink, parseMapLink } from './mapLinks.ts';

const MAX_RADIUS_KM = GEO_RADIUS_MAX_M / 1000;

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

/** Метры → текст поля «Радиус, км» без хвостовых нулей (500 → «0.5»). */
const kmText = (m: number) => String(Number((m / 1000).toFixed(3)));

/** «широта, долгота @метры» (geoQuery) → точка и радиус; null — не такой запрос. */
function parseQuery(q: string): { lat: number; lon: number; radiusM: number } | null {
  const g = parseGeoloc(q);
  const p = pair(g.coords);
  if (!p || g.radiusM === null) return null;
  const lat = Number(p[0]);
  const lon = Number(p[1]);
  const radiusM = Math.round(g.radiusM);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || radiusM < 1 || radiusM > GEO_RADIUS_MAX_M) return null;
  return { lat, lon, radiusM };
}

/** «Поиск по геоданным»: точка на карте и радиус → записи утечек с геолокациями в этом круге (raw_search.byloc_radius). */
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
  const params = useSearch({ from: '/search/geo' });
  const navigate = useNavigate({ from: '/search/geo' });
  const me = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const fromUrl = params.q ? parseQuery(params.q) : null;
  const [latText, setLatText] = useState(fromUrl ? fmt(fromUrl.lat) : '');
  const [lonText, setLonText] = useState(fromUrl ? fmt(fromUrl.lon) : '');
  const [radiusText, setRadiusText] = useState(fromUrl ? kmText(fromUrl.radiusM) : '1');
  // Счётчик для GeoPicker: изменился — карта показывает круг целиком.
  const [focus, setFocus] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const start = trpc.search.start.useMutation({
    onSuccess: (j) => {
      setJobId(j.id);
      void utils.search.recent.invalidate({ section: 'geo' });
    },
  });
  const job = useSearchJob(jobId);

  const lat = num(latText);
  const lon = num(lonText);
  const radiusKm = num(radiusText);
  const latBad = latText.trim() !== '' && (lat === null || Math.abs(lat) > 90);
  const lonBad = lonText.trim() !== '' && (lon === null || Math.abs(lon) > 180);
  const radiusBad = radiusText.trim() !== '' && (radiusKm === null || radiusKm <= 0 || radiusKm > MAX_RADIUS_KM);
  const point: GeoPoint | null = lat !== null && lon !== null && !latBad && !lonBad ? { lat, lon } : null;
  const radiusM = radiusKm !== null && !radiusBad ? radiusKm * 1000 : null;
  // Шлюз принимает радиус целыми метрами, от 1.
  const searchRadius = radiusM !== null ? Math.max(1, Math.round(radiusM)) : null;
  const disabled = !me.data?.access.active;

  function run(p = point, r = searchRadius) {
    if (!p || !r) return;
    void navigate({ search: { q: geoQuery(p.lat, p.lon, r) } });
    start.mutate({ section: 'geo', lat: p.lat, lon: p.lon, radius: r });
  }

  // Ссылка /search/geo?q=… (повтор снимка из досье) запускает поиск.
  useRunOnMount(() => {
    run({ lat: fromUrl!.lat, lon: fromUrl!.lon }, fromUrl!.radiusM);
    setFocus((f) => f + 1);
  }, !!(fromUrl && me.data?.access.active));

  // Открыт поиск из истории — точка и радиус на карте те же, что у него.
  const opened = job.data?.section === 'geo' ? job.data : null;
  useEffect(() => {
    if (!opened) return;
    const lat = num(opened.params.lat ?? '');
    const lon = num(opened.params.lon ?? '');
    const r = num(opened.params.radius ?? '');
    if (lat === null || lon === null || r === null) return;
    setLatText(fmt(lat));
    setLonText(fmt(lon));
    setRadiusText(kmText(r));
    setFocus((f) => f + 1);
  }, [opened?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // «Провалиться» в найденное значение — поиск по атрибутам.
  const pivot = (kind: string, value: string) => void navigate({ to: '/search', search: { kind, q: value } });

  const pick = useCallback((p: GeoPoint) => {
    setLatText(fmt(p.lat));
    setLonText(fmt(p.lon));
  }, []);

  function typeCoord(which: 'lat' | 'lon', v: string) {
    if (which === 'lat') setLatText(v);
    else setLonText(v);
    setFocus((f) => f + 1);
  }

  function setPoint(p: GeoPoint) {
    setLatText(fmt(p.lat));
    setLonText(fmt(p.lon));
    setFocus((f) => f + 1);
  }

  /**
   * Вставленная в любое из полей пара «lat, lon» или ссылка на карту раскладывается по обоим
   * (только при вставке — не мешает набору).
   */
  function pastePair(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    const p = pair(text);
    if (p) {
      e.preventDefault();
      setLatText(p[0]);
      setLonText(p[1]);
      setFocus((f) => f + 1);
      return;
    }
    const link = parseMapLink(text);
    if (link) {
      e.preventDefault();
      setPoint(link);
    }
  }

  return (
    <SearchLayout
      section="geo"
      title="Поиск по геоданным"
      subtitle="Выберите точку на карте или введите координаты и задайте радиус области поиска."
      activeId={jobId}
      onOpen={setJobId}
    >
      <Card className="animate-fade-up">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run();
          }}
        >
          {/* Колонки — по ширине самой формы (рядом может быть история), а не окна. */}
          <div className="@container">
            <div className="grid items-end gap-3 @xl:grid-cols-2 @4xl:grid-cols-[1fr_1fr_auto_120px_auto]">
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
              <Button type="button" className="h-12" onClick={() => setLinkOpen(true)} title="Координаты из ссылки Google Maps, Яндекс Карт или OpenStreetMap">
                <Link2 size={16} /> Из ссылки
              </Button>
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
                <Button type="button" className="h-12" disabled={!point} title="Показать область на карте" onClick={() => setFocus((f) => f + 1)}>
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
                <Button type="submit" variant="primary" className="h-12 px-6" disabled={disabled || !point || !searchRadius || start.isPending}>
                  {start.isPending ? <Spinner className="border-mint-ink/30 border-t-mint-ink" /> : 'Искать'}
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-dim">
            <span className="flex items-center gap-1.5"><MapPin size={14} className="text-mint/70" /> Щёлкните по карте или перетащите маркер; пару «широта, долгота» или ссылку на карту можно вставить в любое поле.</span>
            {latBad && <Tag tone="warn">широта — число от −90 до 90</Tag>}
            {lonBad && <Tag tone="warn">долгота — число от −180 до 180</Tag>}
            {radiusBad && <Tag tone="warn">радиус — от 0 до {MAX_RADIUS_KM} км</Tag>}
            {start.error && <Tag tone="danger">{errorText(start.error)}</Tag>}
          </div>
        </form>
      </Card>

      {/* isolate — z-index элементов управления карты не выходят за её пределы и не перекрывают кнопку «наверх». */}
      <div className="isolate animate-fade-up overflow-hidden rounded-2xl border border-line">
        <GeoPicker config={config} point={point} radiusM={radiusM} onPick={pick} focus={focus} className="ft-map h-[480px] w-full" />
      </div>

      {jobId && <JobView job={job.data} loading={job.isLoading} onPivot={pivot} />}

      <MapLinkDialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onPick={(p) => {
          setPoint(p);
          setLinkOpen(false);
        }}
      />
    </SearchLayout>
  );
}

/** Ввод ссылки на карту: сразу видно, какие координаты из неё возьмутся. */
function MapLinkDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (v: boolean) => void; onPick: (p: GeoPoint) => void }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  const found = text.trim() ? parseMapLink(text) : null;
  const short = !found && isShortMapLink(text);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Координаты из ссылки" wide>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (found) onPick(found);
        }}
      >
        <Input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://www.google.com/maps/place/…/@55.7558,37.6173,17z/…"
          className="h-12 font-mono"
        />
        <div className="min-h-6 text-sm">
          {found && (
            <span className="font-mono text-mint">
              {fmt(found.lat)}, {fmt(found.lon)} <span className="text-dim">· {found.what}</span>
            </span>
          )}
          {short && <Tag tone="warn">короткая ссылка без координат — откройте её в браузере и скопируйте полный адрес</Tag>}
          {text.trim() && !found && !short && <Tag tone="warn">в ссылке нет координат</Tag>}
          {!text.trim() && <span className="text-dim">Google Maps, Яндекс Карты или OpenStreetMap. Для ссылки на место берутся координаты места, иначе — центр карты.</span>}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={!found}>Подставить</Button>
        </div>
      </form>
    </Dialog>
  );
}

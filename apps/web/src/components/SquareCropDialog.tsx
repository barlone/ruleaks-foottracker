import { useEffect, useRef, useState } from 'react';
import { Button, Dialog } from './ui.tsx';
import { cropSquare } from '../lib/squareImage.ts';

const VIEW = 320;
const MAX_ZOOM = 5;

/**
 * Редактор квадратной обрезки, как при выборе аватара в Telegram: картинку двигают мышью и масштабируют
 * (колесо или ползунок), в квадратное окно попадает то, что останется на картинке. Минимальный масштаб —
 * картинка целиком закрывает окно, так что пустых полей не бывает.
 */
export function SquareCropDialog({ image, onDone, onCancel }: {
  /** Загруженное неквадратное изображение; null — окно закрыто. */
  image: HTMLImageElement | null;
  onDone: (dataUrl: string) => void;
  onCancel: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const w = image?.naturalWidth ?? 1;
  const h = image?.naturalHeight ?? 1;
  // Базовый масштаб: меньшая сторона ровно по окну.
  const scale = (VIEW / Math.min(w, h)) * zoom;
  const dw = w * scale;
  const dh = h * scale;
  const clamp = (p: { x: number; y: number }, width = dw, height = dh) => ({
    x: Math.min(0, Math.max(VIEW - width, p.x)),
    y: Math.min(0, Math.max(VIEW - height, p.y)),
  });

  // Новая картинка — по центру, без увеличения.
  useEffect(() => {
    if (!image) return;
    const s = VIEW / Math.min(image.naturalWidth, image.naturalHeight);
    setZoom(1);
    setPos({ x: (VIEW - image.naturalWidth * s) / 2, y: (VIEW - image.naturalHeight * s) / 2 });
  }, [image]);

  /** Масштаб вокруг точки окна (cx, cy): она остаётся на том же месте картинки. */
  function zoomTo(next: number, cx = VIEW / 2, cy = VIEW / 2) {
    const z = Math.min(MAX_ZOOM, Math.max(1, next));
    const k = z / zoom;
    setZoom(z);
    setPos((p) => clamp({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }, dw * k, dh * k));
  }

  function done() {
    if (!image) return;
    onDone(cropSquare(image, -pos.x / scale, -pos.y / scale, VIEW / scale));
  }

  return (
    <Dialog open={!!image} onOpenChange={(v) => !v && onCancel()} title="Область изображения" width="max-w-md" stacked>
      {image && (
        <div className="space-y-4">
          <div
            className="relative mx-auto cursor-grab touch-none select-none overflow-hidden rounded-xl border border-line bg-bg-soft active:cursor-grabbing"
            style={{ width: VIEW, height: VIEW }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
            }}
            onPointerUp={() => { drag.current = null; }}
            onPointerCancel={() => { drag.current = null; }}
            onWheel={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              zoomTo(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
            }}
          >
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute left-0 top-0 max-w-none"
              style={{ width: dw, height: dh, transform: `translate(${pos.x}px, ${pos.y}px)` }}
            />
          </div>
          <label className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-widest text-dim">
            Масштаб
            <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} className="flex-1 accent-mint" />
          </label>
          <p className="text-xs text-mute">Двигайте картинку мышью, масштаб — колесом или ползунком. В узел попадёт квадрат 128×128.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>Отмена</Button>
            <Button variant="primary" onClick={done}>Готово</Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

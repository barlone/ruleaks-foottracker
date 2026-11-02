import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { TAG_COLORS } from '@ft/shared';

/**
 * Квадрат-маркер: пустой контур, пока цвет не выбран, иначе залит цветом. По нажатию — палитра (цвета тегов + свой
 * цвет + «без цвета»). Без права правки — только показ.
 */
export function ColorMark({ value, editable, onChange, className }: {
  value: string | undefined;
  editable: boolean;
  onChange: (color: string | undefined) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!editable && !value) return null;
  const pick = (c: string | undefined) => {
    setOpen(false);
    if (c !== value) onChange(c);
  };

  return (
    <div ref={ref} className={clsx('relative flex items-center', className)}>
      <button
        type="button"
        disabled={!editable}
        onClick={() => setOpen((v) => !v)}
        title={editable ? (value ? 'Изменить цвет метки' : 'Пометить цветом') : undefined}
        className={clsx('size-3.5 shrink-0 rounded-sm border transition', editable && 'cursor-pointer hover:scale-110', value ? 'border-text/20' : 'border-text/40')}
        style={value ? { background: value } : undefined}
      />
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1.5 grid w-[7.5rem] grid-cols-4 gap-1.5 rounded-lg border border-line bg-panel p-2 shadow-glow-sm">
          {TAG_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => pick(c)}
              title={c}
              className={clsx('size-6 cursor-pointer rounded-md border border-text/25 transition hover:scale-110', value === c && 'ring-2 ring-mint ring-offset-2 ring-offset-panel')}
              style={{ background: c }}
            />
          ))}
          <label
            title="Свой цвет"
            className={clsx(
              'relative size-6 cursor-pointer rounded-md border border-dashed border-text/40',
              value && !TAG_COLORS.includes(value as (typeof TAG_COLORS)[number]) && 'ring-2 ring-mint ring-offset-2 ring-offset-panel',
            )}
            style={value && !TAG_COLORS.includes(value as (typeof TAG_COLORS)[number]) ? { background: value } : undefined}
          >
            <input type="color" value={value ?? '#2ee0ac'} onChange={(e) => pick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
          <button
            type="button"
            onClick={() => pick(undefined)}
            title="Без цвета"
            className="grid size-6 cursor-pointer place-items-center rounded-md border border-text/25 text-dim transition hover:text-danger"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

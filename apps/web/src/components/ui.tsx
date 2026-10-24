import clsx from 'clsx';
import * as RDialog from '@radix-ui/react-dialog';
import { Check, Copy, Trash2, X } from 'lucide-react';
import { copyText } from '../lib/clipboard.ts';
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

// Базовые компоненты в стилистике ruleaks.link: чёрный фон, мятный акцент, моноширинные подписи.

type Variant = 'primary' | 'ghost' | 'outline' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }>(
  function Button({ variant = 'outline', size = 'md', className, ...rest }, ref) {
    return (
      <button
        ref={ref}
        className={clsx(
          'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:pointer-events-none disabled:opacity-40 cursor-pointer whitespace-nowrap',
          size === 'sm' && 'h-8 px-3 text-sm',
          size === 'md' && 'h-10 px-4 text-sm',
          size === 'lg' && 'h-14 px-8 text-lg font-extrabold rounded-xl',
          variant === 'primary' && 'btn-sheen bg-mint text-mint-ink shadow-glow-sm hover:-translate-y-px hover:shadow-glow',
          variant === 'outline' && 'border border-line bg-mint/5 text-mint hover:bg-mint/10 hover:border-mint/50',
          variant === 'ghost' && 'text-dim hover:text-mint hover:bg-mint/5',
          variant === 'danger' && 'border border-danger/40 text-danger hover:bg-danger/10',
          className,
        )}
        {...rest}
      />
    );
  },
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return (
    <input
      ref={ref}
      className={clsx(
        'h-10 w-full rounded-lg border border-line bg-bg-soft px-3 text-sm text-text placeholder:text-mute outline-none transition focus:border-mint/70 focus:shadow-glow-sm',
        className,
      )}
      {...rest}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      className={clsx(
        'w-full rounded-lg border border-line bg-bg-soft px-3 py-2 text-sm text-text placeholder:text-mute outline-none transition focus:border-mint/70',
        className,
      )}
      {...rest}
    />
  );
});

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={clsx('h-10 rounded-lg border border-line bg-bg-soft px-3 text-sm text-text outline-none focus:border-mint/70', className)}
      {...rest}
    />
  );
}

/** compact — отступы на 20% меньше (p-4 вместо p-5, под заголовком 0.8rem вместо 1rem). */
export function Card({
  className, children, title, actions, compact,
}: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode; compact?: boolean }) {
  return (
    <section className={clsx('rounded-2xl border border-line bg-gradient-to-b from-mint/[0.04] to-mint/[0.01]', compact ? 'p-4' : 'p-5', className)}>
      {(title || actions) && (
        <header className={clsx('flex items-center justify-between gap-3', compact ? 'mb-[0.8rem]' : 'mb-4')}>
          {title && (
            <h3 className="label-mono flex items-center gap-2.5">
              <span className="size-1.5 rounded-full bg-mint shadow-[0_0_10px_var(--color-mint)]" />
              {title}
            </h3>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Tag({ children, tone = 'mint', className }: { children: ReactNode; tone?: 'mint' | 'dim' | 'warn' | 'danger' | 'info'; className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px] leading-5',
        tone === 'mint' && 'border-line bg-mint/8 text-mint',
        tone === 'dim' && 'border-white/10 bg-white/5 text-dim',
        tone === 'warn' && 'border-warn/30 bg-warn/10 text-warn',
        tone === 'danger' && 'border-danger/30 bg-danger/10 text-danger',
        tone === 'info' && 'border-info/30 bg-info/10 text-info',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dialog({
  open, onOpenChange, title, children, wide, width, stacked,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  /** Своя максимальная ширина (класс max-w-…) вместо max-w-lg / max-w-3xl. */
  width?: string;
  /** Поверх другого полноэкранного окна (просмотр скана — z-50). */
  stacked?: boolean;
}) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        {/* Центрирование без transform: иначе position:fixed внутри диалога (подсказки редактора) считается от него. */}
        <RDialog.Overlay className={clsx('fixed inset-0 grid place-items-center overflow-auto bg-black/70 p-4 backdrop-blur-sm', stacked ? 'z-[60]' : 'z-40')}>
          <RDialog.Content
            // Фокус ставят сами поля (autoFocus), а не первая кнопка диалога.
            onOpenAutoFocus={(e) => e.preventDefault()}
            className={clsx(
              'relative w-full animate-fade-up rounded-2xl border border-line bg-panel p-6 shadow-glow',
              width ?? (wide ? 'max-w-3xl' : 'max-w-lg'),
            )}
          >
            <div className="mb-5 flex items-center justify-between">
              <RDialog.Title className="label-mono">{title}</RDialog.Title>
              <RDialog.Close className="text-dim hover:text-mint cursor-pointer" aria-label="Закрыть">
                <X size={18} />
              </RDialog.Close>
            </div>
            <RDialog.Description className="sr-only">{typeof title === 'string' ? title : ''}</RDialog.Description>
            {children}
          </RDialog.Content>
        </RDialog.Overlay>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block font-mono text-[11px] uppercase tracking-widest text-dim">{label}</span>
      {children}
      {hint && <span className="block text-xs text-mute">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line p-8 text-center font-mono text-sm text-mute">{children}</div>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={clsx('inline-block size-4 animate-spin rounded-full border-2 border-mint/30 border-t-mint', className)} />;
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-bg-soft p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-md px-3 py-1.5 font-mono text-xs transition cursor-pointer',
            value === o.value ? 'bg-mint text-mint-ink font-bold' : 'text-dim hover:text-mint',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Иконка «скопировать в буфер обмена»; после копирования на секунду показывает галочку. */
export function CopyButton({ value, title = 'Скопировать', className }: { value: string; title?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const t = setTimeout(() => setState('idle'), 1200);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      onClick={async () => setState((await copyText(value)) ? 'ok' : 'fail')}
      title={state === 'ok' ? 'Скопировано' : state === 'fail' ? 'Не удалось скопировать' : title}
      aria-label={title}
      className={clsx('shrink-0 cursor-pointer transition', state === 'ok' ? 'text-mint' : state === 'fail' ? 'text-danger' : 'text-mute hover:text-mint', className)}
    >
      {state === 'ok' ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

/**
 * Удаление в два нажатия: первое превращает корзину в красный квадрат с «?», второе в течение 3 с удаляет,
 * иначе кнопка возвращается к обычному виду. Пока ждёт подтверждения, видна и без наведения на строку.
 */
export function ConfirmDeleteBtn({ onConfirm, className, title = 'Удалить' }: { onConfirm: () => void; className?: string; title?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
      title={armed ? 'Нажмите ещё раз, чтобы удалить' : title}
      aria-label={armed ? 'Подтвердить удаление' : title}
      data-armed={armed || undefined}
      className={clsx('grid size-3.5 shrink-0 cursor-pointer place-items-center transition', armed ? 'opacity-100' : 'text-mute opacity-0 hover:text-danger group-hover:opacity-100', className)}
    >
      {armed ? <span className="grid size-3.5 place-items-center rounded-sm bg-danger font-mono text-[10px] font-bold leading-none text-black">?</span> : <Trash2 size={13} />}
    </button>
  );
}

/**
 * Выбор файла. Подписи стандартного <input type="file"> рисует браузер на языке системы
 * («Вибрати файл», «Choose file»…) — поэтому свой вид: кнопка + имя выбранного файла, сам input скрыт.
 */
export function FilePicker({
  accept, multiple, disabled, onFiles, className,
}: {
  accept?: string;
  /** Несколько файлов сразу. */
  multiple?: boolean;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  return (
    <span className={clsx('flex min-w-0 items-center gap-3', className)}>
      <Button type="button" size="sm" disabled={disabled} onClick={() => ref.current?.click()}>
        {multiple ? 'Выбрать файлы' : 'Выбрать файл'}
      </Button>
      <span className={clsx('min-w-0 truncate text-sm', name ? 'text-text' : 'text-dim')}>{name ?? (multiple ? 'Файлы не выбраны' : 'Файл не выбран')}</span>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          setName(files.length > 1 ? `выбрано файлов: ${files.length}` : files[0]?.name ?? null);
          onFiles(files);
          // Тот же файл можно выбрать снова (иначе change не сработает).
          e.target.value = '';
        }}
      />
    </span>
  );
}

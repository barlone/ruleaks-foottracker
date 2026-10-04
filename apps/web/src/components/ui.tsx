import clsx from 'clsx';
import * as RDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

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

export function Card({ className, children, title, actions }: { className?: string; children: ReactNode; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={clsx('rounded-2xl border border-line bg-gradient-to-b from-mint/[0.04] to-mint/[0.01] p-5', className)}>
      {(title || actions) && (
        <header className="mb-4 flex items-center justify-between gap-3">
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
  open, onOpenChange, title, children, wide,
}: { open: boolean; onOpenChange: (v: boolean) => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        {/* Центрирование без transform: иначе position:fixed внутри диалога (подсказки редактора) считается от него. */}
        <RDialog.Overlay className="fixed inset-0 z-40 grid place-items-center overflow-auto bg-black/70 p-4 backdrop-blur-sm">
          <RDialog.Content
            // Фокус ставят сами поля (autoFocus), а не первая кнопка диалога.
            onOpenAutoFocus={(e) => e.preventDefault()}
            className={clsx(
              'relative w-full animate-fade-up rounded-2xl border border-line bg-panel p-6 shadow-glow',
              wide ? 'max-w-3xl' : 'max-w-lg',
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

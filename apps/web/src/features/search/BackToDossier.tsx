import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { trpc } from '../../lib/trpc.ts';

/** Возврат в досье, из которого пришли по «Искать» / «Исследовать» (?from=): текст-кнопка справа от заголовка. */
export function BackToDossier({ id }: { id: string }) {
  const d = trpc.dossiers.get.useQuery({ id }, { select: (x) => x.title, staleTime: 60_000 });
  return (
    <Link to="/dossiers/$id" params={{ id }} className="inline-flex items-center gap-1.5 font-mono text-xs text-mute transition hover:text-mint">
      <ArrowLeft size={13} /> в досье{d.data ? ` «${d.data}»` : ''}
    </Link>
  );
}

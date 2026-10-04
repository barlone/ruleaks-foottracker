import { useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Lightbox from 'yet-another-react-lightbox';
import Captions from 'yet-another-react-lightbox/plugins/captions';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/captions.css';
import { GripVertical, Star, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import type { DossierItem } from '@ft/shared';
import { SourceBadge } from '../../components/SourceBadge.tsx';

type Media = Extract<DossierItem, { type: 'media' }>;

/**
 * Сетка медиа досье: перетаскивание меняет порядок, клик открывает просмотр,
 * группировка по альбомам. Загрузка в S3 появится вместе с адаптером хранилища.
 */
export function MediaGallery({
  items, editable, coverUrl, onReorder, onRemove, onCover,
}: {
  items: Media[];
  editable: boolean;
  coverUrl: string | null;
  onReorder: (orderedIds: string[]) => void;
  onRemove: (id: string) => void;
  onCover: (url: string) => void;
}) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [open, setOpen] = useState(-1);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const byId = new Map(items.map((m) => [m.id, m]));
  const ids = order?.filter((id) => byId.has(id)) ?? items.map((m) => m.id);
  const sorted = ids.map((id) => byId.get(id)!);

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id)));
    setOrder(next);
    onReorder(next);
  }

  return (
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {sorted.map((m, i) => (
              <Tile
                key={m.id}
                m={m}
                editable={editable}
                isCover={m.url === coverUrl}
                onOpen={() => setOpen(i)}
                onRemove={() => onRemove(m.id)}
                onCover={() => onCover(m.url)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <Lightbox
        open={open >= 0}
        index={open}
        close={() => setOpen(-1)}
        plugins={[Captions]}
        slides={sorted.map((m) => ({ src: m.url, title: m.caption, description: m.album }))}
        styles={{ container: { backgroundColor: 'rgba(0,0,0,.92)' } }}
      />
    </>
  );
}

function Tile({
  m, editable, isCover, onOpen, onRemove, onCover,
}: { m: Media; editable: boolean; isCover: boolean; onOpen: () => void; onRemove: () => void; onCover: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: m.id, disabled: !editable });
  return (
    <figure
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        'group relative overflow-hidden rounded-xl border border-line-soft bg-bg-soft',
        isDragging && 'z-10 border-mint shadow-glow',
      )}
    >
      <button onClick={onOpen} className="block aspect-[4/3] w-full cursor-zoom-in">
        <img src={m.url} alt={m.caption ?? ''} className="size-full object-cover" draggable={false} />
      </button>
      <figcaption className="flex items-center gap-2 px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate text-xs text-dim">{m.caption ?? '—'}</span>
        <SourceBadge source={m.source} />
      </figcaption>
      {m.album && <span className="absolute left-2 top-2 rounded bg-black/70 px-1.5 font-mono text-[10px] text-mint">{m.album}</span>}
      {editable && (
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
          <button onClick={onCover} title="Сделать обложкой" className={clsx('grid size-7 cursor-pointer place-items-center rounded bg-black/70', isCover ? 'text-mint' : 'text-dim hover:text-mint')}>
            <Star size={13} fill={isCover ? 'currentColor' : 'none'} />
          </button>
          <button onClick={onRemove} title="Удалить" className="grid size-7 cursor-pointer place-items-center rounded bg-black/70 text-dim hover:text-danger">
            <Trash2 size={13} />
          </button>
          <span {...attributes} {...listeners} title="Перетащить" className="grid size-7 cursor-grab place-items-center rounded bg-black/70 text-dim hover:text-mint">
            <GripVertical size={13} />
          </span>
        </div>
      )}
    </figure>
  );
}

import { useState, type ReactNode } from 'react';
import { FileDown, FileText, Share2, Trash2 } from 'lucide-react';
import { Button, Dialog } from './ui.tsx';

// Кнопки в правом верхнем углу досье и расследования: экспорт (всем, кто видит объект),
// доступ и удаление (только владельцу). Удаление отодвинуто от остальных и подтверждается диалогом.

const NOUN = { dossier: 'досье', investigation: 'расследование' } as const;

export function ObjectActions({
  kind, title, isOwner, size = 'md', onShare, onDelete, onExportFile, onExportPdf,
}: {
  kind: keyof typeof NOUN;
  title: string;
  isOwner: boolean;
  size?: 'sm' | 'md';
  onShare: () => void;
  onDelete: () => void;
  /** Экспорт в PDF пока не написан. */
  onExportFile?: () => void;
  onExportPdf?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const icon = size === 'sm' ? 14 : 15;
  return (
    <div className="flex items-center gap-2">
      <Button size={size} onClick={onExportFile} disabled={!onExportFile} title="Экспорт в файл"><FileDown size={icon} /> Файл</Button>
      <Button size={size} onClick={onExportPdf} disabled={!onExportPdf} title="Экспорт в PDF"><FileText size={icon} /> PDF</Button>
      {isOwner && (
        <>
          <Button size={size} onClick={onShare}><Share2 size={icon} /> Доступ</Button>
          {/* Отступ слева — половина ширины кнопки, чтобы не нажать «удалить» вместо соседней. */}
          <Button size={size} variant="danger" onClick={() => setConfirming(true)} title="Удалить" className={size === 'sm' ? 'ml-3' : 'ml-4'}>
            <Trash2 size={icon} />
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={`Удалить ${NOUN[kind]}`}
            confirmLabel="Удалить"
            onConfirm={() => {
              setConfirming(false);
              onDelete();
            }}
          >
            Вы действительно хотите удалить {NOUN[kind]} «{title}»? Это действие необратимо.
          </ConfirmDialog>
        </>
      )}
    </div>
  );
}

function ConfirmDialog({
  open, onOpenChange, title, children, confirmLabel, onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      <p className="text-sm leading-relaxed text-text">{children}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)} autoFocus>Отмена</Button>
        <Button variant="danger" onClick={onConfirm}><Trash2 size={15} /> {confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

import { useState, type ReactNode } from 'react';
import { FileDown, FileText, Share2, Trash2 } from 'lucide-react';
import { Button, Dialog } from './ui.tsx';
import { t, tj } from '../lib/i18n.ts';

// Кнопки в правом верхнем углу досье и расследования: экспорт (всем, кто видит объект),
// доступ и удаление (только владельцу). Удаление отодвинуто от остальных и подтверждается диалогом.

// Заголовок и текст подтверждения — целыми фразами: в других языках слова стоят иначе.
type Kind = 'dossier' | 'investigation';

export function ObjectActions({
  kind, title, isOwner, size = 'md', onShare, onDelete, onExportFile, onExportPdf,
}: {
  kind: Kind;
  title: string;
  isOwner: boolean;
  size?: 'sm' | 'md';
  onShare: () => void;
  onDelete: () => void;
  onExportFile?: () => void;
  onExportPdf?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const icon = size === 'sm' ? 14 : 15;
  return (
    <div className="flex items-center gap-2">
      <Button size={size} onClick={onExportFile} disabled={!onExportFile} title={t('Экспорт в файл')}><FileDown size={icon} /> {t('Файл')}</Button>
      <Button size={size} onClick={onExportPdf} disabled={!onExportPdf} title={t('Экспорт в PDF')}><FileText size={icon} /> PDF</Button>
      {isOwner && (
        <>
          <Button size={size} onClick={onShare}><Share2 size={icon} /> {t('Доступ')}</Button>
          {/* Отступ слева — половина ширины кнопки, чтобы не нажать «удалить» вместо соседней. */}
          <Button size={size} variant="danger" onClick={() => setConfirming(true)} title={t('Удалить')} className={size === 'sm' ? 'ml-3' : 'ml-4'}>
            <Trash2 size={icon} />
          </Button>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={kind === 'dossier' ? t('Удалить досье') : t('Удалить расследование')}
            confirmLabel={t('Удалить')}
            onConfirm={() => {
              setConfirming(false);
              onDelete();
            }}
          >
            {kind === 'dossier'
              ? tj('Вы действительно хотите удалить досье «{title}»? Это действие необратимо.', { title })
              : tj('Вы действительно хотите удалить расследование «{title}»? Это действие необратимо.', { title })}
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
        <Button variant="ghost" onClick={() => onOpenChange(false)} autoFocus>{t('Отмена')}</Button>
        <Button variant="danger" onClick={onConfirm}><Trash2 size={15} /> {confirmLabel}</Button>
      </div>
    </Dialog>
  );
}

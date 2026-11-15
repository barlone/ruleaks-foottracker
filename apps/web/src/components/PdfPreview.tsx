import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { FileText } from 'lucide-react';
import { t } from '../lib/i18n.ts';

// PDF в медиа досье. Файл лежит в элементе как data URL (файлового хранилища нет). Картинкой его не показать:
// в сетке и формах — плитка-заглушка, просмотр — встроенным средством браузера в iframe.

/** Плитка вместо картинки: значок документа и подпись «PDF». */
export function PdfThumb({ className }: { className?: string }) {
  return (
    <span className={clsx('grid place-items-center bg-bg-soft text-dim', className)}>
      <span className="flex flex-col items-center gap-1.5">
        <FileText size={34} strokeWidth={1.4} />
        <span className="font-mono text-[11px] tracking-widest text-mute">PDF</span>
      </span>
    </span>
  );
}

/**
 * data URL → адрес blob: с типом application/pdf. Тип задаём сами, а содержимое сверяем с сигнатурой %PDF-:
 * что бы ни лежало в элементе досье (его мог прислать другой пользователь), браузер откроет это только как PDF.
 */
function pdfBlobUrl(dataUrl: string): string | null {
  const m = /^data:application\/pdf((?:;[^;,]*)*),/i.exec(dataUrl);
  if (!m || !m[1]!.toLowerCase().includes(';base64')) return null;
  try {
    const bin = atob(dataUrl.slice(m[0].length));
    if (!bin.startsWith('%PDF-')) return null;
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  } catch {
    return null;
  }
}

/** Просмотр PDF в окне: iframe со встроенным просмотрщиком браузера. Адрес blob: освобождается при закрытии. */
export function PdfFrame({ url, title }: { url: string; title: string }) {
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const blob = pdfBlobUrl(url);
    setSrc(blob);
    return () => {
      if (blob) URL.revokeObjectURL(blob);
    };
  }, [url]);
  if (src === undefined) return null;
  if (!src) return <div className="text-sm text-danger">{t('Файл не похож на PDF — открыть его нельзя')}</div>;
  return (
    <div className="space-y-2">
      <iframe src={src} title={title} className="h-[75vh] w-full rounded-lg border border-line bg-bg" />
      <a href={src} target="_blank" rel="noreferrer noopener" className="inline-block font-mono text-xs text-mint hover:underline">{t('Открыть в новой вкладке')}</a>
    </div>
  );
}

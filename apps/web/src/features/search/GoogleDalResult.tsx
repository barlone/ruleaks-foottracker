import { Globe, Package } from 'lucide-react';
import type { GoogleDalReport } from '@ft/shared';
import { Card, CopyButton, Empty, Tag, WarnNote } from '../../components/ui.tsx';
import { Ext, None } from './GoogleParts.tsx';

// Отчёт «паука» Digital Asset Links (modules/spiderdal.py): сайты и Android-приложения, связанные с целью через
// assetlinks.json, — по кругам обхода. Пакет, которого нет в Google Play, — приватное (внутреннее, тестовое) приложение.

const via = (leakedBy: string | null) => (leakedBy ? <span className="font-mono text-[11px] text-mute">через {leakedBy}</span> : <Tag tone="dim">цель</Tag>);

export function GoogleDalResult({ report }: { report: GoogleDalReport }) {
  if (!report.found) return <Empty>Связей не найдено: у цели нет опубликованных Digital Asset Links.</Empty>;
  return (
    <>
      {report.truncated && (
        <WarnNote>Обход остановлен на пределе: опрошено {report.scanned} активов за {report.rounds} кругов — граф связей больше, показана его часть.</WarnNote>
      )}
      <div className="grid items-start gap-6 2xl:grid-cols-2">
        <Card title={<><Globe size={13} /> Сайты: {report.sites.length}</>}>
          {!report.sites.length ? <None>сайтов нет</None> : (
            <div className="space-y-1">
              {report.sites.map((s) => (
                <div key={s.site} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <Ext href={s.site}>{s.site}</Ext>
                  {via(s.leakedBy)}
                </div>
              ))}
            </div>
          )}
        </Card>
        <Card title={<><Package size={13} /> Android-пакеты: {report.packages.length}</>}>
          {!report.packages.length ? <None>пакетов нет</None> : (
            <div className="divide-y divide-line-soft">
              {report.packages.map((p) => (
                <div key={p.name} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold">{p.name}</span>
                    <CopyButton value={p.name} title="Скопировать имя пакета" />
                    {p.public === true && <Tag>есть в Google Play</Tag>}
                    {p.public === false && <Tag tone="warn">нет в Google Play — приватный</Tag>}
                    {p.public === null && <Tag tone="dim">в Google Play не проверен</Tag>}
                  </div>
                  {p.public === true && <Ext href={`https://play.google.com/store/apps/details?id=${encodeURIComponent(p.name)}`}>страница в Google Play</Ext>}
                  <div className="space-y-0.5">
                    {p.fingerprints.map((f) => (
                      <div key={f.sha256} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="break-all font-mono text-[11px] text-dim">SHA-256 {f.sha256}</span>
                        <CopyButton value={f.sha256} title="Скопировать отпечаток" />
                        {via(f.leakedBy)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

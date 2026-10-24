import { CREDIBILITY_LABELS, RELIABILITY_LABELS, type Source } from '@ft/shared';
import { Field, Input, Select } from './ui.tsx';
import type { SourceDraft } from './source.ts';

export function SourceFields({ value, onChange }: { value: SourceDraft; onChange: (s: SourceDraft) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border border-line-soft p-3">
      <Field label="Источник">
        <Select value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value as Source['kind'] })} className="w-full">
          <option value="manual">Вручную</option>
          <option value="url">Веб-страница</option>
          <option value="humint">HUMINT (человек)</option>
          <option value="document">Документ</option>
          <option value="search">Поиск RuLeaks</option>
        </Select>
      </Field>
      <Field label={value.kind === 'url' ? 'URL' : value.kind === 'humint' ? 'Псевдоним источника' : 'Ссылка / описание'}>
        <Input value={value.ref ?? ''} onChange={(e) => onChange({ ...value, ref: e.target.value })} />
      </Field>
      <Field label="Надёжность источника">
        <Select value={value.reliability} onChange={(e) => onChange({ ...value, reliability: e.target.value as Source['reliability'] })} className="w-full">
          {Object.entries(RELIABILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
        </Select>
      </Field>
      <Field label="Достоверность сведений">
        <Select value={value.credibility} onChange={(e) => onChange({ ...value, credibility: e.target.value as Source['credibility'] })} className="w-full">
          {Object.entries(CREDIBILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{k} — {v}</option>)}
        </Select>
      </Field>
    </div>
  );
}

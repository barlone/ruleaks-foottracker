import { CREDIBILITY_LABELS, RELIABILITY_LABELS, type Source } from '@ft/shared';
import { Field, Input, Select } from './ui.tsx';
import type { SourceDraft } from './source.ts';
import { t } from '../lib/i18n.ts';

export function SourceFields({ value, onChange }: { value: SourceDraft; onChange: (s: SourceDraft) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 rounded-xl border border-line-soft p-3">
      <Field label={t('Источник')}>
        <Select value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value as Source['kind'] })} className="w-full">
          <option value="manual">{t('Вручную')}</option>
          <option value="url">{t('Веб-страница')}</option>
          <option value="humint">{t('HUMINT (человек)')}</option>
          <option value="document">{t('Документ')}</option>
          <option value="search">{t('Поиск RuLeaks')}</option>
        </Select>
      </Field>
      <Field label={value.kind === 'url' ? 'URL' : value.kind === 'humint' ? t('Псевдоним источника') : t('Ссылка / описание')}>
        <Input value={value.ref ?? ''} onChange={(e) => onChange({ ...value, ref: e.target.value })} />
      </Field>
      <Field label={t('Надёжность источника')}>
        <Select value={value.reliability} onChange={(e) => onChange({ ...value, reliability: e.target.value as Source['reliability'] })} className="w-full">
          {Object.entries(RELIABILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{k} — {t(v)}</option>)}
        </Select>
      </Field>
      <Field label={t('Достоверность сведений')}>
        <Select value={value.credibility} onChange={(e) => onChange({ ...value, credibility: e.target.value as Source['credibility'] })} className="w-full">
          {Object.entries(CREDIBILITY_LABELS).map(([k, v]) => <option key={k} value={k}>{k} — {t(v)}</option>)}
        </Select>
      </Field>
    </div>
  );
}

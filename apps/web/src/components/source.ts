import type { Source } from '@ft/shared';

// Черновик источника в формах (SourceFields): без времени, оно ставится при сохранении.

export type SourceDraft = Omit<Source, 'capturedAt'>;

export const emptySource = (): SourceDraft => ({ kind: 'manual', reliability: 'F', credibility: '6' });

export const finishSource = (s: SourceDraft): Source => ({ ...s, ref: s.ref || undefined, capturedAt: new Date().toISOString() });

/** Происхождение сведений + оценка по системе Адмиралтейства. */

-- Доводы гипотезы: два списка записей — «за» и «против» (текст в Markdown, как заметки досье). Хранятся в самой
-- гипотезе: [{ id, stance: supports | contradicts, textMd, createdAt }]. Отметки фактов (hypothesis_evidence) остаются.

-- Up Migration

ALTER TABLE hypotheses
  ADD COLUMN arguments jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(arguments) = 'array');


-- Down Migration
-- Доводы теряются.

ALTER TABLE hypotheses DROP COLUMN arguments;

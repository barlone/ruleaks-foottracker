-- Колонка investigations.public_slug не использовалась: публичное расследование открывается по своему id
-- (uuid v7 — 74 случайных бита, не угадать), а слаг только генерировался при публикации. Вместе с колонкой
-- уходят её UNIQUE и CHECK (visibility <> 'public' OR public_slug IS NOT NULL).

-- Up Migration

ALTER TABLE investigations DROP COLUMN public_slug;


-- Down Migration
-- Слаги публичных расследований будут новыми (прежние не восстанавливаются — их никто не читал).

ALTER TABLE investigations ADD COLUMN public_slug text UNIQUE;
UPDATE investigations SET public_slug = substr(md5(random()::text || id::text), 1, 16) WHERE visibility = 'public';
ALTER TABLE investigations ADD CONSTRAINT investigations_check CHECK (visibility <> 'public' OR public_slug IS NOT NULL);

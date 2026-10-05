-- Пояснение связи — своё у каждой стороны: тип общий («родственник»), а уточнение зависит от того,
-- из чьего досье смотреть («сын» в одном, «отец» в другом).
--   from_note — пояснение в досье from_id (кем приходится персона to_id), to_note — в досье to_id.

-- Up Migration

ALTER TABLE dossier_relations RENAME COLUMN note TO from_note;
ALTER TABLE dossier_relations ADD COLUMN to_note text CHECK (length(to_note) <= 500);


-- Down Migration
-- Пояснения со стороны to_id теряются.

ALTER TABLE dossier_relations DROP COLUMN to_note;
ALTER TABLE dossier_relations RENAME COLUMN from_note TO note;

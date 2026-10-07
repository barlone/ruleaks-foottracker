-- Сквозной идентификатор досье и расследования для экспорта и импорта (uid). Один и тот же объект несёт его
-- в файлах экспорта и в базах, куда его импортировали: по нему повторный импорт находит прежнюю копию
-- у того же владельца и перезаписывает её, а не заводит вторую. Это не первичный ключ: у разных владельцев
-- бывают копии с одним uid, у одного владельца — не больше одной живой (не удалённой).

-- Up Migration

ALTER TABLE dossiers ADD COLUMN uid uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE investigations ADD COLUMN uid uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX dossiers_owner_uid_idx ON dossiers (owner_id, uid) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX investigations_owner_uid_idx ON investigations (owner_id, uid) WHERE deleted_at IS NULL;


-- Down Migration
-- Связь импортированных копий с исходными объектами теряется: повторный импорт создаст новые.

DROP INDEX investigations_owner_uid_idx;
DROP INDEX dossiers_owner_uid_idx;
ALTER TABLE investigations DROP COLUMN uid;
ALTER TABLE dossiers DROP COLUMN uid;

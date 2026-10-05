-- Посты, комментарии, ответы и реакции персоны в соцсетях — новый тип элемента досье.
-- Тело — в dossier_items.data (PostItem в @ft/shared):
--   post {kind: post|comment|reply|reaction, platform, place, url, at, text, replyTo, emoji, author, extId}
-- extId (tg:<группа>:<сообщение>:<вид>) не даёт перенести одно сообщение из поиска дважды.

-- Up Migration

ALTER TYPE dossier_item_type ADD VALUE IF NOT EXISTS 'post';


-- Down Migration
-- Значение из enum в PostgreSQL не удаляется; удаляются только сами элементы-посты.

DELETE FROM dossier_items WHERE type::text = 'post';

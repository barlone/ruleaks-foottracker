import { tgTimeToIso, type TgComment, type TgGroup, type TgUser } from '@ft/shared';
import type { PendingPost } from './AddToDossierDialog.tsx';

/** Ключ комментария: msg_id уникален только внутри группы. */
export const ckey = (c: TgComment) => `${c.grp_id}:${c.msg_id}`;

/**
 * Сообщение из поиска → пост досье. reaction — режим «Реакции» (сообщения, на которые персона реагировала);
 * author — для чужих сообщений (ответы персоне, полнотекстовый поиск).
 */
export function commentToPost(c: TgComment, group: TgGroup | undefined, opts: { reaction?: boolean; author?: TgUser } = {}): PendingPost {
  const kind = opts.reaction ? 'reaction' : c.r2msg_id || c.r2text ? 'reply' : 'comment';
  const a = opts.author;
  const author = a ? [a.names?.[0], a.niks?.[0] && `@${a.niks[0]}`, `ID ${a.id}`].filter(Boolean).join(' · ') : undefined;
  return {
    kind,
    platform: 'telegram',
    place: group?.name ?? `группа ${c.grp_id}`,
    url: c.url || undefined,
    at: tgTimeToIso(opts.reaction ? c.likes?.[0]?.at ?? c.dt : c.dt),
    text: c.text,
    replyTo: c.r2text || undefined,
    emoji: opts.reaction ? c.likes?.map((l) => l.emoji).join(' ') || undefined : undefined,
    author,
    extId: `tg:${c.grp_id}:${c.msg_id}:${kind}${a ? `:${a.id}` : ''}`,
  };
}

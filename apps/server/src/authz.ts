import type { Role, Share } from '@ft/shared';

// Единственное место, где решается доступ к досье и расследованиям.
// Все процедуры роутеров проходят через can()/roleOf() — не проверять права по месту.

export type Action = 'read' | 'edit' | 'manage';

interface Guarded {
  ownerId: string;
  visibility: 'private' | 'shared' | 'public';
  shares: Share[];
}

export function roleOf(userId: string | null, obj: Guarded): Role | null {
  if (userId && obj.ownerId === userId) return 'owner';
  const share = userId ? obj.shares.find((s) => s.userId === userId) : undefined;
  if (share && obj.visibility !== 'private') return share.role;
  if (obj.visibility === 'public') return 'viewer';
  return null;
}

export function can(userId: string | null, action: Action, obj: Guarded): boolean {
  const role = roleOf(userId, obj);
  if (!role) return false;
  switch (action) {
    case 'read':
      return true;
    case 'edit':
      return role === 'owner' || role === 'editor';
    case 'manage': // видимость, доступы, удаление
      return role === 'owner';
  }
}

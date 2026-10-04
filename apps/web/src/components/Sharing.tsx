import { useState } from 'react';
import { Globe, Lock, Users, X } from 'lucide-react';
import type { Share } from '@ft/shared';
import { Button, Dialog, Field, Input, Select, Tag } from './ui.tsx';

export type Visibility = 'private' | 'shared' | 'public';

export function VisibilityTag({ v }: { v: Visibility }) {
  if (v === 'public') return <Tag tone="info"><Globe size={11} /> публичное</Tag>;
  if (v === 'shared') return <Tag><Users size={11} /> общее</Tag>;
  return <Tag tone="dim"><Lock size={11} /> личное</Tag>;
}

/** Диалог доступа: общий для досье и расследований. Публичность — только у расследований. */
export function ShareDialog({
  open, onOpenChange, visibility, shares, allowPublic, onVisibility, onShare, onUnshare, error,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  visibility: Visibility;
  shares: Share[];
  allowPublic: boolean;
  onVisibility: (v: Visibility) => void;
  onShare: (username: string, role: 'viewer' | 'editor') => void;
  onUnshare: (userId: string) => void;
  error?: string | null;
}) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('viewer');
  const levels: { v: Visibility; icon: typeof Lock; title: string; text: string }[] = [
    { v: 'private', icon: Lock, title: 'Личное', text: 'Видите только вы. Список доступа сохраняется, но не действует.' },
    { v: 'shared', icon: Users, title: 'Общее', text: 'Видят исследователи из списка ниже — с правами чтения или правки.' },
    ...(allowPublic
      ? [{ v: 'public' as const, icon: Globe, title: 'Публичное', text: 'Доступно по ссылке любому, даже без входа. Привязанные личные досье остаются скрытыми.' }]
      : []),
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Доступ">
      <div className="space-y-5">
        <div className="space-y-2">
          {levels.map(({ v, icon: Icon, title, text }) => (
            <button
              key={v}
              onClick={() => onVisibility(v)}
              className={`flex w-full cursor-pointer gap-3 rounded-xl border p-3 text-left transition ${visibility === v ? 'border-mint/60 bg-mint/10' : 'border-line-soft hover:border-line'}`}
            >
              <Icon size={18} className={visibility === v ? 'text-mint' : 'text-mute'} />
              <span>
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs text-dim">{text}</span>
              </span>
            </button>
          ))}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (username.trim()) onShare(username.trim(), role);
            setUsername('');
          }}
        >
          <Field label="Telegram @username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@colleague_dev" />
          </Field>
          <Select value={role} onChange={(e) => setRole(e.target.value as 'viewer' | 'editor')}>
            <option value="viewer">чтение</option>
            <option value="editor">правка</option>
          </Select>
          <Button type="submit">Добавить</Button>
        </form>
        {error && <div className="font-mono text-xs text-danger">{error}</div>}
        <div className="space-y-1">
          {shares.length === 0 && <div className="font-mono text-xs text-mute">Ни с кем не поделено</div>}
          {shares.map((s) => (
            <div key={s.userId} className="flex items-center justify-between rounded-lg border border-line-soft px-3 py-2 text-sm">
              <span>{s.displayName}</span>
              <span className="flex items-center gap-2">
                <Tag tone={s.role === 'editor' ? 'mint' : 'dim'}>{s.role === 'editor' ? 'правка' : 'чтение'}</Tag>
                <button onClick={() => onUnshare(s.userId)} className="cursor-pointer text-mute hover:text-danger"><X size={14} /></button>
              </span>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

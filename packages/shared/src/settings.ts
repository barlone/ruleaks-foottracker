import { UserSettings, type UserSettingsPatch } from './domain.ts';

export const DEFAULT_USER_SETTINGS: UserSettings = {
  theme: 'dark',
};

/** Записанные ключи → полные настройки. Ключ, не прошедший схему (устарел, сменился тип), считается не заданным. */
export function resolveUserSettings(stored: unknown): UserSettings {
  const raw = (stored ?? {}) as Record<string, unknown>;
  const settings: Record<string, unknown> = { ...DEFAULT_USER_SETTINGS };
  for (const [key, schema] of Object.entries(UserSettings.shape)) {
    const value = schema.safeParse(raw[key]);
    if (value.success) settings[key] = value.data;
  }
  return settings as UserSettings;
}

/** Изменение → что записать и что убрать: значение по умолчанию в БД не хранится. */
export function settingsChanges(patch: UserSettingsPatch): { set: Record<string, unknown>; reset: string[] } {
  const set: Record<string, unknown> = {};
  const reset: string[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === DEFAULT_USER_SETTINGS[key as keyof UserSettings]) reset.push(key);
    else set[key] = value;
  }
  return { set, reset };
}

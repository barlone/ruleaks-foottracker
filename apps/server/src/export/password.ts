import { pbkdf2 } from 'node:crypto';
import { promisify } from 'node:util';

// Пароль ZIP-архива экспорта (формат v1) не равен паролю, который ввёл пользователь: он выводится из него
// PBKDF2-HMAC-SHA256 с солью системы. Пароль не задан — выводится из пустой строки: файл всё равно зашифрован
// длинным случайным на вид паролем, но открыть его может любая установка Следопыта (импорт без пароля).
// Соль и число итераций — часть формата: их смена = новая версия формата (version.v2) и чтение старых по-старому.

const SALT = 'RuLeaks.Foottracker/export/v1/2c7d0a9e41f35b86e0d4a17f9b3c52e8';
const ITERATIONS = 600_000;
const derive = promisify(pbkdf2);

/** Пароль архива (43 символа base64url) из пароля экспорта; пустая строка — экспорт без пароля. */
export async function archivePassword(exportPassword: string): Promise<string> {
  const key = await derive(exportPassword.normalize('NFC'), SALT, ITERATIONS, 32, 'sha256');
  return key.toString('base64url');
}

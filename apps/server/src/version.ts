import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from '@ft/shared';

// Версия приложения для лога и /health: APP_VERSION из @ft/shared и коммит, из которого запущен сервер.
// Коммит читается из .git напрямую, без вызова git: служба может работать под другим пользователем,
// и git откажется работать с чужим репозиторием («dubious ownership»). FT_COMMIT — переопределение
// (сборка без .git).

const here = dirname(fileURLToPath(import.meta.url));

function findGitDir(): string | null {
  for (let dir = here; ; dir = dirname(dir)) {
    const git = join(dir, '.git');
    if (existsSync(git)) return git;
    if (dirname(dir) === dir) return null;
  }
}

/** sha коммита HEAD (с учётом packed-refs) или null. */
function headCommit(): string | null {
  try {
    const git = findGitDir();
    if (!git) return null;
    const head = readFileSync(join(git, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref: ')) return head;
    const ref = head.slice(5);
    const loose = join(git, ref);
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim();
    const packed = join(git, 'packed-refs');
    if (!existsSync(packed)) return null;
    const line = readFileSync(packed, 'utf8').split('\n').find((l) => l.endsWith(` ${ref}`));
    return line ? line.split(' ')[0]! : null;
  } catch {
    return null;
  }
}

const commit = process.env.FT_COMMIT || headCommit();

export const appVersion = {
  version: APP_VERSION,
  commit: commit ? commit.slice(0, 7) : null,
  startedAt: new Date().toISOString(),
};

export const versionLine = `${appVersion.version} · коммит ${appVersion.commit ?? 'неизвестен'} · node ${process.version}`;

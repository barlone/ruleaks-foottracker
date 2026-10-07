import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { text } from 'node:stream/consumers';

// sha256 пароля для [config] password-sha256: npm run password-hash
// В терминале пароль вводится без эха (дважды); иначе читается первая строка stdin.

async function prompt(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  // Подавляем эхо введённых символов, но не текст вопроса.
  (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => {
    if (!muted) process.stdout.write(s);
    else if (s.includes('\n')) process.stdout.write('\n');
  };
  const ask = (q: string) =>
    new Promise<string>((res) => {
      muted = false;
      rl.question(q, res);
      muted = true;
    });
  const first = await ask('Пароль: ');
  const second = await ask('Ещё раз: ');
  rl.close();
  if (first !== second) {
    console.error('Пароли не совпадают');
    process.exit(1);
  }
  return first;
}

const password = process.stdin.isTTY ? await prompt() : (await text(process.stdin)).split(/\r?\n/)[0]!;
if (!password) {
  console.error('Пустой пароль');
  process.exit(1);
}
console.log(`password-sha256 = ${createHash('sha256').update(password, 'utf8').digest('hex')}`);

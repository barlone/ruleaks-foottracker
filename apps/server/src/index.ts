import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import { describeConfig } from '@ft/config';
import { appConfig, config } from './config.ts';
import { createDeps } from './deps.ts';
import { registerGeoFiles } from './geo-files.ts';
import { appRouter, type AppRouter } from './router.ts';
import { registerScanFiles } from './scan-files.ts';
import { registerSameOriginGuard } from './same-origin.ts';
import { makeCreateContext } from './trpc.ts';
import { appVersion, versionLine } from './version.ts';
import { alert, errorLine, finalAlert, startAlerter } from './alerting.ts';

const app = Fastify({
  bodyLimit: 15 * 1024 * 1024,
  logger: { level: 'info' },
  logController: new LogController({ disableRequestLogging: true }),
  routerOptions: { maxParamLength: 5000 },
  // За nginx/Cloudflare req.ip иначе был бы адресом прокси (лимит попыток пароля — на один адрес).
  trustProxy: appConfig.server.trustProxy,
});

app.log.info(`версия:    ${versionLine}`);
for (const line of describeConfig(appConfig)) app.log.info(line);
for (const w of appConfig.warnings) app.log.warn(`config: ${w}`);

// Алертинг — до подключения к базам: уже неудачный запуск должен быть сообщён.
startAlerter(appConfig.alerting, (m) => app.log.warn(m));

/** Процесс падает: запись в журнал, алерт (с ожиданием доставки) и выход. */
async function die(code: number, what: string, e: unknown): Promise<never> {
  app.log.fatal(e instanceof Error ? { err: e } : {}, `${what}: ${errorLine(e)}`);
  await finalAlert(`${what}: ${errorLine(e)}`);
  process.exit(code);
}
// Ошибка вне обработчиков запросов. Node после неё продолжать не должен — завершаемся, но сначала сообщаем.
process.on('uncaughtException', (e) => void die(1, 'Сервер остановлен: необработанное исключение', e));
process.on('unhandledRejection', (e) => void die(1, 'Сервер остановлен: необработанное отклонение промиса', e));

let deps;
try {
  deps = await createDeps(appConfig, (m) => app.log.info(m));
} catch (e) {
  await die(2, 'Сервер не запустился', e);
  throw e; // недостижимо: die завершает процесс
}

await app.register(cookie, { secret: config.cookieSecret });
// До маршрутов: запросы с чужих страниц, в т.ч. с соседних поддоменов (плеер архивов), не доходят до обработчиков.
registerSameOriginGuard(app);
await app.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: {
    router: appRouter,
    createContext: makeCreateContext(deps),
    onError({ path, error }) {
      if (error.code !== 'INTERNAL_SERVER_ERROR') return;
      app.log.error({ path, err: error }, 'trpc error');
      // Имя процедуры приходит из адреса запроса: в ключ и текст — только похожее на имя, вход запроса не прикладывается.
      const proc = path && /^[\w.]{1,80}$/.test(path) ? path : '?';
      alert(`trpc:${proc}`, `Ошибка обработчика ${proc}: ${errorLine(error)}`);
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
});

// Ошибки остальных маршрутов (/scans, /geo): 5xx — наши, 4xx — запросы клиента.
app.addHook('onError', async (req, _reply, error) => {
  if ((error.statusCode ?? 500) < 500) return;
  const route = req.routeOptions?.url ?? '?';
  alert(`http:${route}`, `Ошибка маршрута ${route}: ${errorLine(error)}`);
});

await registerGeoFiles(app, deps);
registerScanFiles(app, deps);

app.get('/health', async () => ({ ok: true, ...appVersion }));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    app.log.fatal(`Порт ${config.host}:${config.port} занят — видимо, сервер уже запущен в другом терминале. Остановите его или смените [server] port в config.ini.`);
    process.exit(1);
  }
  throw err;
}

import Fastify, { LogController } from 'fastify';
import cookie from '@fastify/cookie';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import { describeConfig } from '@ft/config';
import { appConfig, config } from './config.ts';
import { createDeps } from './deps.ts';
import { appRouter, type AppRouter } from './router.ts';
import { makeCreateContext } from './trpc.ts';

const app = Fastify({
  bodyLimit: 15 * 1024 * 1024,
  logger: { level: 'info' },
  logController: new LogController({ disableRequestLogging: true }),
  routerOptions: { maxParamLength: 5000 },
});

for (const line of describeConfig(appConfig)) app.log.info(line);
for (const w of appConfig.warnings) app.log.warn(`config: ${w}`);

let deps;
try {
  deps = createDeps(appConfig);
} catch (e) {
  app.log.fatal((e as Error).message);
  process.exit(2);
}

await app.register(cookie, { secret: config.cookieSecret });
await app.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: {
    router: appRouter,
    createContext: makeCreateContext(deps),
    onError({ path, error }) {
      if (error.code === 'INTERNAL_SERVER_ERROR') app.log.error({ path, err: error }, 'trpc error');
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
});

app.get('/health', async () => ({ ok: true }));

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    app.log.fatal(`Порт ${config.host}:${config.port} занят — видимо, сервер уже запущен в другом терминале. Остановите его или смените [server] port в config.ini.`);
    process.exit(1);
  }
  throw err;
}

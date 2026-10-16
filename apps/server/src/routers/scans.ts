import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { isUuid } from '@ft/shared';
import { ScanStoreError, type ScanMeta } from '../ports.ts';
import { SCANS_PATH } from '../scan-files.ts';
import { authedProcedure, router } from '../trpc.ts';

// Сканы документов ([scanstore-api]): uuid приходят в записях утечек (ключ scans), картинки — по /scans/<uuid>.

/** Сколько запросов метаданных одновременно уходит в хранилище. */
const META_CONCURRENCY = 4;

export const scansRouter = router({
  /** null — хранилище сканов выключено, бокс со сканами не показывается. */
  config: authedProcedure.query(({ ctx }) => (ctx.deps.scans ? { imagePath: SCANS_PATH } : null)),

  /** Тип документа, номер и владелец каждого скана; null — скана нет в хранилище. */
  meta: authedProcedure
    .input(z.object({ ids: z.array(z.string()).max(500) }))
    .query(async ({ ctx, input }) => {
      const store = ctx.deps.scans;
      if (!store) throw new TRPCError({ code: 'NOT_FOUND', message: 'NOT_FOUND' });
      const ids = [...new Set(input.ids.map((s) => s.toLowerCase()).filter(isUuid))];
      const out: Record<string, ScanMeta | null> = {};
      let next = 0;
      try {
        await Promise.all(
          Array.from({ length: Math.min(META_CONCURRENCY, ids.length) }, async () => {
            while (next < ids.length) {
              const id = ids[next++]!;
              out[id] = await store.meta(id);
            }
          }),
        );
      } catch (e) {
        if (e instanceof ScanStoreError) throw new TRPCError({ code: 'BAD_GATEWAY', message: 'SCANSTORE_UNAVAILABLE', cause: e });
        throw e;
      }
      return out;
    }),
});

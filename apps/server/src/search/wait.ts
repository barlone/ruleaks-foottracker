import { appConfig } from '../config.ts';
import type { GatewayAnswer, SearchGateway } from '../ports.ts';

/** Дожидается ответа шлюза (служебные запросы вроде телефон → tgid, поиски второго шага). */
export async function waitDone(gateway: SearchGateway, tok: string, service: 'ruleaks' | 'tgcmnts', first: GatewayAnswer, timeoutMs = 60_000): Promise<unknown> {
  let ans = first;
  const until = Date.now() + timeoutMs;
  while (ans.state === 'running' && Date.now() < until) {
    await new Promise((r) => setTimeout(r, appConfig.api.pollIntervalMs));
    ans = await gateway.poll(tok, service, ans.jobId);
  }
  if (ans.state === 'done') return ans.result;
  throw new Error(ans.state === 'failed' ? ans.error : 'Шлюз не ответил вовремя');
}

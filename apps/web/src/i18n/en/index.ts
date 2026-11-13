// Английский словарь интерфейса: «русский текст → английский» (lib/i18n.ts). Грузится отдельным чанком, только
// когда выбран английский. Части — по областям, чтобы правки не мешали друг другу; ключ может повторяться в
// нескольких частях, но перевод у него должен быть один (npm run i18n-check сообщит о расхождении).
import common from './common.ts';
import components from './components.ts';
import dossiers from './dossiers.ts';
import email from './email.ts';
import investigations from './investigations.ts';
import search from './search.ts';
import searchExtra from './searchExtra.ts';
import server from './server.ts';
import shared from './shared.ts';

export const PARTS = { shared, server, common, components, dossiers, investigations, search, searchExtra, email };

export const EN: Record<string, string> = Object.assign({}, ...Object.values(PARTS));

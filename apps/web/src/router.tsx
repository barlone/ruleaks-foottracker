import { createRootRoute, createRoute, createRouter, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { Root } from './components/AppShell.tsx';
import { AttrSearchPage } from './features/search/AttrSearchPage.tsx';
import { TgSearchPage } from './features/search/TgSearchPage.tsx';
import { FuzzySearchPage } from './features/search/FuzzySearchPage.tsx';
import { DossiersPage } from './features/dossiers/DossiersPage.tsx';
import { InvestigationsPage } from './features/investigations/InvestigationsPage.tsx';

// Маршруты описаны в коде (не file-based), чтобы структура была видна в одном месте.
// Тяжёлые страницы (TipTap, React Flow, ELK) грузятся отдельными чанками.

const rootRoute = createRootRoute({ component: Root });

// Роутер разбирает значения из адреса как JSON: ?q=123456789 приходит числом, а не строкой.
// Набранная руками ссылка с цифрами не должна ронять страницу — приводим к строке.
const text = z.preprocess((v) => (v === undefined || v === null ? undefined : String(v)), z.string().optional());

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/search' });
  },
});

export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  validateSearch: z.object({ kind: text, q: text, deep: z.boolean().optional().catch(undefined) }),
  component: AttrSearchPage,
});

export const tgSearchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search/telegram',
  validateSearch: z.object({ mode: text, q: text }),
  component: TgSearchPage,
});

// MapLibre — отдельным чанком.
export const geoSearchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search/geo',
  validateSearch: z.object({ q: text }),
  component: lazyRouteComponent(() => import('./features/search/GeoSearchPage.tsx'), 'GeoSearchPage'),
});

export const pagesSearchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search/pages',
  validateSearch: z.object({ q: text }),
  component: lazyRouteComponent(() => import('./features/search/PagesSearchPage.tsx'), 'PagesSearchPage'),
});

export const fuzzySearchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search/fuzzy',
  validateSearch: z.object({ mode: text, q: text, vehicpart: text }),
  component: FuzzySearchPage,
});

export const dossiersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dossiers',
  validateSearch: z.object({ scope: z.enum(['all', 'mine', 'shared']).optional() }),
  component: DossiersPage,
});

export const dossierRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dossiers/$id',
  component: lazyRouteComponent(() => import('./features/dossiers/DossierPage.tsx'), 'DossierPage'),
});

export const investigationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/investigations',
  validateSearch: z.object({ scope: z.enum(['all', 'mine', 'shared', 'public']).optional() }),
  component: InvestigationsPage,
});

export const investigationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/investigations/$id',
  validateSearch: z.object({ tab: z.enum(['graph', 'facts', 'hypotheses']).optional().catch(undefined), focus: text }),
  component: lazyRouteComponent(() => import('./features/investigations/InvestigationPage.tsx'), 'InvestigationPage'),
});

const routeTree = rootRoute.addChildren([
  indexRoute, searchRoute, tgSearchRoute, geoSearchRoute, pagesSearchRoute, fuzzySearchRoute, dossiersRoute, dossierRoute, investigationsRoute, investigationRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

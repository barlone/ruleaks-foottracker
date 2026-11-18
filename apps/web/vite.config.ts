import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadConfig } from '@ft/config';

// Адрес API-сервера для прокси /trpc и /geo (свои тайлы карты) — из того же config.ini, что читает сервер.
const { server } = loadConfig();
// Host передаётся как есть (как nginx на проде): сервер сверяет с ним Origin запросов (same-origin.ts), а строковая
// форма прокси Vite подменила бы его на адрес API.
const api = { target: `http://${server.host}:${server.port}`, changeOrigin: false };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Воркер MapLibre — ES-модуль (GeoPicker создаёт его с type: 'module').
  worker: { format: 'es' },
  build: {
    // Порог предупреждения о крупных файлах (кБ, по умолчанию 500). Выше порога — только библиотеки, которые
    // уже грузятся по требованию и меньше не станут: авторасстановка графа ELK (~1400), карта MapLibre (~1100) и её
    // воркер, редактор Markdown (~480). Стартовый файл — около 590; если вырастет заметно, смотреть, что в него попало.
    chunkSizeWarningLimit: 1500,
  },
  server: {
    port: 5173,
    // Не уходить молча на 5174: вторая копия фронта работала бы с чужим API-сервером.
    strictPort: true,
    proxy: { '/trpc': api, '/geo': api, '/scans': api, '/site-archive': api },
  },
});

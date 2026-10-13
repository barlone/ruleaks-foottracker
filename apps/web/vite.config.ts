import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadConfig } from '@ft/config';

// Адрес API-сервера для прокси /trpc и /geo (свои тайлы карты) — из того же config.ini, что читает сервер.
const { server } = loadConfig();
const api = `http://${server.host}:${server.port}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Воркер MapLibre — ES-модуль (GeoPicker создаёт его с type: 'module').
  worker: { format: 'es' },
  server: {
    port: 5173,
    // Не уходить молча на 5174: вторая копия фронта работала бы с чужим API-сервером.
    strictPort: true,
    proxy: { '/trpc': api, '/geo': api },
  },
});

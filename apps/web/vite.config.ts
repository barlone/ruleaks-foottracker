import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { loadConfig } from '@ft/config';

// Адрес API-сервера для прокси /trpc — из того же config.ini, что читает сервер.
const { server } = loadConfig();

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Не уходить молча на 5174: вторая копия фронта работала бы с чужим API-сервером.
    strictPort: true,
    proxy: { '/trpc': `http://${server.host}:${server.port}` },
  },
});

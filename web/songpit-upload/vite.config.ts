import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pagesBuild = process.env.PAGES_BUILD === '1';
const base = pagesBuild
  ? (() => {
      const b = process.env.BASE_PATH;
      if (!b || !b.trim()) {
        throw new Error(
          'PAGES_BUILD=1 requires BASE_PATH (e.g. /my-repo/ for a GitHub Pages project site)'
        );
      }
      return b.replace(/\/?$/, '/');
    })()
  : '/app/';

export default defineConfig({
  plugins: [svelte()],
  base,
  build: {
    outDir: pagesBuild
      ? resolve(__dirname, 'dist')
      : resolve(__dirname, '../../services/songpit-api/web-dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/v1': { target: 'http://127.0.0.1:3030', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:3030', changeOrigin: true },
    },
  },
});

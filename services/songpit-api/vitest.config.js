import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    /** Integration tests share `test-staging/` and usage state; run files sequentially. */
    fileParallelism: false,
    include: ['test/**/*.test.js'],
    env: {
      SONGPIT_JWT_SECRET: 'test-secret-key-32-bytes-minimum!!',
      SONGPIT_API_KEY: 'test-api-key',
      SONGPIT_SPA_PUBLIC_URL: 'http://localhost/app',
      SONGPIT_STAGING_ROOT: path.join(__dirname, 'test-staging'),
    },
  },
});

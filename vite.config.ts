import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// VITE_BASE: sottocartella del sito se l'app non sta nella root del dominio (es. "/party/").
const base = process.env.VITE_BASE || '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // in sviluppo l'API PHP gira con: npm run dev:api
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: { target: 'es2020', sourcemap: false },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    testTimeout: 20000,
  },
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Provider schema documents are served without CORS headers, so the dev and
// preview servers relay them. Generation and chat calls go direct (CORS ok).
const proxy = {
  '/x/atlas-static': {
    target: 'https://static.atlascloud.ai',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/x\/atlas-static/, ''),
  },
  '/x/fal-web': {
    target: 'https://fal.ai',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/x\/fal-web/, ''),
  },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  preview: { port: 4173, proxy },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});

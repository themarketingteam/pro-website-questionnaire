import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { createLocalApiMiddleware } from './scripts/local-preview-api.mjs';
const root = fileURLToPath(new URL('.', import.meta.url));
const localHtml = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local preview | Content Questionnaire</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/src/local/main.jsx"></script></body></html>`;
export default defineConfig({
  plugins: [react(), {
    name: 'isolated-local-questionnaire',
    transformIndexHtml: { order: 'pre', handler: () => localHtml },
    configureServer(server) { server.middlewares.use(createLocalApiMiddleware(root)); }
  }],
  define: { 'import.meta.env.VITE_LOCAL_PREVIEW': JSON.stringify(true) },
  resolve: { alias: [
    { find: '@/api/base44Client', replacement: root + 'src/local/base44Client.js' },
    { find: '@/lib/app-params', replacement: root + 'src/local/app-params.js' },
    { find: '@/components/pro-form/ThankYouModal', replacement: root + 'src/local/LocalThankYouModal.jsx' },
    { find: '@/components/pro-form/MultiGeographicQuestion', replacement: root + 'src/local/LocalGeographicQuestion.jsx' },
    { find: '@', replacement: root + 'src' }
  ] },
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws://localhost:5173 ws://127.0.0.1:5173; object-src 'none'; base-uri 'self'; form-action 'self'; frame-src 'self' blob:",
      'Referrer-Policy': 'no-referrer'
    },
    fs: { allow: [root, '/Users/isaachines/Desktop/Kaseya-Automation-Repos/pro-website-questionnaire-early2026/node_modules'] }
  },
  build: { outDir: 'dist-local', emptyOutDir: true }
});

import { defineConfig } from 'vite';
import { appView, pageInputs, serviceWorker, siteLayout } from './scripts/site-plugin';

export default defineConfig({
  plugins: [appView(), siteLayout(), serviceWorker()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: pageInputs(),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});

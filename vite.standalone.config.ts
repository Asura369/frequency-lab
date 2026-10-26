import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { appView } from './scripts/site-plugin';

/**
 * Single-file offline edition: everything inlined into one HTML document so it
 * can be opened from file:// with no server and no network.
 */
export default defineConfig({
  plugins: [appView(), viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist-offline',
    emptyOutDir: true,
    rollupOptions: {
      input: 'standalone/index.html',
    },
  },
});

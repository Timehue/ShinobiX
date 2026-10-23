import { defineConfig } from 'vite';
import gameQa from './vite.world-map-qa.config.mjs';

// Keep this audit's optimizer output local and separate from other QA servers.
export default defineConfig({
    ...gameQa,
    cacheDir: '.tmp/vite-iphone',
    optimizeDeps: { ...gameQa.optimizeDeps, entries: ['index.html'] },
});

import { defineConfig } from 'vite';
import worldMapQa from './vite.world-map-qa.config.mjs';

export default defineConfig({ ...worldMapQa,
    cacheDir: '.cache/weekly-model',
    optimizeDeps: { ...worldMapQa.optimizeDeps, noDiscovery: true,
        entries: ['e2e/fixtures/weekly-model.html'] },
});

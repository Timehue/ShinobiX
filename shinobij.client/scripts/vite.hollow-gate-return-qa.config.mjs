import { defineConfig } from 'vite';
import worldMapQa from './vite.world-map-qa.config.mjs';
export default defineConfig({ ...worldMapQa,
    cacheDir: '.cache/hollow-gate-return',
    optimizeDeps: { ...worldMapQa.optimizeDeps, noDiscovery: true, entries: ['e2e/fixtures/hollow-gate-return.html', 'e2e/fixtures/hollow-gate-warden.html'] },
});

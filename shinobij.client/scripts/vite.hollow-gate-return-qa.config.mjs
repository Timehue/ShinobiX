import { defineConfig } from 'vite';
import worldMapQa from './vite.world-map-qa.config.mjs';
export default defineConfig({ ...worldMapQa,
    cacheDir: '.cache/hollow-gate-return',
    optimizeDeps: { ...worldMapQa.optimizeDeps, noDiscovery: true,
        include: [...worldMapQa.optimizeDeps.include, 'socket.io-client'],
        entries: ['e2e/fixtures/hollow-gate-return.html', 'e2e/fixtures/hollow-gate-warden.html', 'e2e/fixtures/rift-entry-preview.html', 'e2e/fixtures/clan-boss-result.html', 'e2e/fixtures/arena-practice.html'] },
});

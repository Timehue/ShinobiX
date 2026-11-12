import { defineConfig } from 'vite';
import worldMapQa from './vite.world-map-qa.config.mjs';

export default defineConfig({ ...worldMapQa,
    cacheDir: '.cache/stronghold-model',
    optimizeDeps: { ...worldMapQa.optimizeDeps, noDiscovery: true,
        include: [...worldMapQa.optimizeDeps.include, 'socket.io-client'],
        entries: ['e2e/fixtures/stronghold-model.html'] },
});

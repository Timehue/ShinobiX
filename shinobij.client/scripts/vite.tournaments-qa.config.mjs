import { defineConfig } from 'vite';
import worldMapQa from './vite.world-map-qa.config.mjs';
export default defineConfig({
    ...worldMapQa,
    server: { ...worldMapQa.server, proxy: { '/api': 'http://127.0.0.1:5198', '/qa-tournament': 'http://127.0.0.1:5198' } },
    optimizeDeps: { ...worldMapQa.optimizeDeps, entries: ['tournament-qa.html'] },
});

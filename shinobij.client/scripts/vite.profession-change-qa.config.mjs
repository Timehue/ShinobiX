import { defineConfig } from 'vite';
import worldMapQa from './vite.world-map-qa.config.mjs';
export default defineConfig({ ...worldMapQa, optimizeDeps: { ...worldMapQa.optimizeDeps, noDiscovery: true, entries: ['e2e/fixtures/profession-change.html'] } });

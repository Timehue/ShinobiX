import { defineConfig } from 'vite';
import worldMapQa from './vite.world-map-qa.config.mjs';

// The 3D Showdown renderer pulls several CommonJS helpers. Let Vite discover
// them for this focused fixture while the lighter world-map QA keeps its
// deliberately narrow prebundle list.
export default defineConfig({
    ...worldMapQa,
    optimizeDeps: { ...worldMapQa.optimizeDeps, noDiscovery: false },
});

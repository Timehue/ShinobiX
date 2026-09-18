import { mergeConfig } from 'vite';
import gameConfig from './vite.config.ts';

// Scan the game entry only; this workspace can contain many archived E2E builds.
export default mergeConfig(gameConfig, {
    cacheDir: 'node_modules/.vite-professions',
    optimizeDeps: { entries: ['index.html'] },
    server: { watch: { ignored: ['**/.playwright-dist-*/**', '**/test-results/**', '**/dist/**'] } },
});

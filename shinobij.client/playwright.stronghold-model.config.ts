import { defineConfig } from '@playwright/test';
import { uiAuditE2ePort } from './e2e-ports';

const port = process.env.STRONGHOLD_MODEL_PORT ?? uiAuditE2ePort();
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
    testDir: './e2e', testMatch: '**/stronghold-model.spec.ts', workers: 1, retries: 0,
    timeout: 60_000, expect: { timeout: 15_000 }, reporter: 'line',
    outputDir: 'test-results/stronghold-model',
    use: { baseURL, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure',
        contextOptions: { reducedMotion: 'no-preference' } },
    webServer: {
        command: `node node_modules/vite/bin/vite.js --config scripts/vite.stronghold-model-qa.config.mjs --configLoader runner --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL, reuseExistingServer: false, timeout: 120_000, env: { VITE_SKIP_HTTPS: '1' },
    },
    projects: [
        { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'phone', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

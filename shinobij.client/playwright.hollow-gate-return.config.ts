import { defineConfig } from '@playwright/test';
import { uiAuditE2ePort } from './e2e-ports';
const port = process.env.HOLLOW_GATE_RETURN_PORT ?? uiAuditE2ePort();
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
    testDir: './e2e', testMatch: ['**/hollow-gate-return.spec.ts', '**/clan-boss-result.spec.ts', '**/arena-practice.spec.ts'], workers: 1, retries: 0,
    timeout: 60_000, expect: { timeout: 15_000 }, reporter: 'line', outputDir: 'test-results/hollow-gate-return',
    use: { baseURL, serviceWorkers: 'block', trace: 'retain-on-failure', screenshot: 'only-on-failure',
        contextOptions: { reducedMotion: 'reduce' } },
    webServer: { command: `node node_modules/vite/bin/vite.js --config scripts/vite.hollow-gate-return-qa.config.mjs --configLoader runner --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL, reuseExistingServer: false, timeout: 120_000, env: { VITE_SKIP_HTTPS: '1' } },
    projects: [
        { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'phone', use: { browserName: 'chromium', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true } },
    ],
});

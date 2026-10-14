import { defineConfig } from '@playwright/test';
import { smokeE2ePort } from './e2e-ports';
const port = smokeE2ePort();
const external = process.env.TRAVEL_HANDOFF_BASE_URL;
const baseURL = external ?? `http://127.0.0.1:${port}`;
export default defineConfig({
    testDir: './e2e', testMatch: 'travel-handoff.spec.ts', workers: 1, timeout: 120_000,
    expect: { timeout: 30_000 }, reporter: 'line', outputDir: 'test-results/travel-handoff',
    use: { baseURL, browserName: 'chromium', serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' },
        screenshot: 'only-on-failure', trace: 'retain-on-failure' },
    webServer: external ? undefined : {
        command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL, env: { VITE_SKIP_HTTPS: '1' }, reuseExistingServer: false, timeout: 120_000,
    },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1366, height: 900 } } },
        { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

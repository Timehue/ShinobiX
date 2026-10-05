import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './e2e', testMatch: '**/village-transfer.spec.ts', timeout: 60_000,
    expect: { timeout: 15_000 }, workers: 1, reporter: 'line', outputDir: 'test-results/village-transfer',
    use: { baseURL: 'http://127.0.0.1:5197', serviceWorkers: 'block', screenshot: 'only-on-failure' },
    webServer: {
        command: 'node node_modules/vite/bin/vite.js --config scripts/vite.village-transfer-qa.config.mjs --configLoader runner --host 127.0.0.1 --port 5197 --strictPort',
        url: 'http://127.0.0.1:5197', reuseExistingServer: false, timeout: 120_000,
        env: { VITE_SKIP_HTTPS: '1' },
    },
    projects: [
        { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true } },
    ],
});

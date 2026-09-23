import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/wild-binding.spec.ts',
    timeout: 90_000,
    expect: { timeout: 15_000 },
    workers: 1,
    reporter: 'line',
    outputDir: 'test-results/wild-binding',
    use: {
        baseURL: 'http://127.0.0.1:5188',
        serviceWorkers: 'block',
        contextOptions: { reducedMotion: 'reduce' },
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: 'node node_modules/vite/bin/vite.js --config scripts/vite.wild-binding-qa.config.mjs --configLoader runner --host 127.0.0.1 --port 5188 --strictPort',
        url: 'http://127.0.0.1:5188',
        reuseExistingServer: false,
        timeout: 120_000,
        env: { VITE_SKIP_HTTPS: '1' },
    },
    projects: [
        { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'chromium-mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

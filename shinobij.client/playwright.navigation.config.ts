import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e', testMatch: '**/navigation-recovery.spec.ts', timeout: 120_000,
    expect: { timeout: 20_000 }, workers: 1, reporter: 'line', outputDir: 'test-results/navigation',
    use: { baseURL: 'http://127.0.0.1:5207', actionTimeout: 30_000, serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' }, screenshot: 'only-on-failure' },
    webServer: {
        command: 'node node_modules/vite/bin/vite.js --config scripts/vite.world-map-qa.config.mjs --configLoader runner --host 127.0.0.1 --port 5207 --strictPort',
        url: 'http://127.0.0.1:5207', reuseExistingServer: false, timeout: 120_000,
    },
    projects: [
        { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 900 } } },
        { name: 'chromium-mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

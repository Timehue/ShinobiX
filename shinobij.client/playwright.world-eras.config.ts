import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './e2e', testMatch: '**/world-eras.spec.ts', workers: 1, reporter: 'line', timeout: 45_000,
    outputDir: 'test-results/world-eras',
    use: { baseURL: 'http://127.0.0.1:5194', serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' }, screenshot: 'only-on-failure' },
    webServer: { command: 'node node_modules/vite/bin/vite.js --config scripts/vite.world-eras-qa.config.mjs --configLoader runner --host 127.0.0.1 --port 5194 --strictPort', url: 'http://127.0.0.1:5194/e2e/fixtures/world-eras.html', reuseExistingServer: false, timeout: 90_000 },
    projects: [
        { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e', testMatch: 'profession-change.spec.ts', timeout: 60_000,
    expect: { timeout: 15_000 }, workers: 1, reporter: 'line', outputDir: 'test-results/profession-change',
    use: { baseURL: 'http://127.0.0.1:5197', serviceWorkers: 'block', screenshot: 'only-on-failure', contextOptions: { reducedMotion: 'reduce' } },
    webServer: {
        command: 'node node_modules/vite/bin/vite.js --config scripts/vite.profession-change-qa.config.mjs --host 127.0.0.1 --port 5197 --strictPort',
        url: 'http://127.0.0.1:5197/e2e/fixtures/profession-change.html', reuseExistingServer: !process.env.CI, timeout: 60_000,
    },
    projects: [
        { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
        { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

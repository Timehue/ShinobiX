import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e', testMatch: '**/rally-recovery.spec.ts', timeout: 60_000,
    expect: { timeout: 20_000 }, workers: 1, reporter: 'line', outputDir: 'test-results/rally-recovery',
    use: { baseURL: 'http://127.0.0.1:5197', serviceWorkers: 'block', screenshot: 'only-on-failure',
        contextOptions: { reducedMotion: 'reduce' } },
    webServer: {
        command: 'node node_modules/vite/bin/vite.js --config scripts/vite.world-map-qa.config.mjs --configLoader runner --host 127.0.0.1 --port 5197 --strictPort',
        url: 'http://127.0.0.1:5197', reuseExistingServer: false, timeout: 120_000,
        env: { VITE_SKIP_HTTPS: '1' },
    },
    projects: [
        { name: 'chromium-mobile', use: { browserName: 'chromium', viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true } },
        { name: 'webkit-mobile', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

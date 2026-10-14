import { defineConfig } from '@playwright/test';

const externalBaseURL = process.env.PRESENTATION_SOURCE_BASE_URL;

export default defineConfig({
    testDir: './e2e', testMatch: ['**/profession-change.spec.ts', '**/village-transfer.spec.ts', '**/dungeon-presentation.spec.ts'],
    timeout: 60_000, expect: { timeout: 15_000 }, workers: 1, reporter: 'line',
    outputDir: 'test-results/presentation-source',
    use: { baseURL: externalBaseURL ?? 'http://127.0.0.1:5197', serviceWorkers: 'block', screenshot: 'only-on-failure' },
    webServer: externalBaseURL ? undefined : {
        command: 'node node_modules/vite/bin/vite.js --config scripts/vite.profession-change-qa.config.mjs --configLoader runner --host 127.0.0.1 --port 5197 --strictPort',
        url: 'http://127.0.0.1:5197', reuseExistingServer: false, timeout: 120_000,
        env: { VITE_SKIP_HTTPS: '1' },
    },
    projects: [
        { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'small-phone', use: { browserName: 'chromium', viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true } },
        { name: 'landscape', use: { browserName: 'chromium', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
        { name: 'webkit-phone', use: { browserName: 'webkit', viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true } },
    ],
});

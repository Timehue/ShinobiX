import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './e2e', testMatch: '**/tournaments.spec.ts', timeout: 120_000,
    expect: { timeout: 20_000 }, workers: 1, reporter: 'line', outputDir: 'test-results/tournaments',
    use: { baseURL: 'http://127.0.0.1:5197', actionTimeout: 30_000, serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' }, screenshot: 'only-on-failure' },
    webServer: {
        command: 'node node_modules/vite/bin/vite.js --config scripts/vite.tournaments-qa.config.mjs --configLoader runner --host 127.0.0.1 --port 5197 --strictPort',
        url: 'http://127.0.0.1:5197', reuseExistingServer: false, timeout: 120_000,
    },
    projects: [{ name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 900 } } }],
});

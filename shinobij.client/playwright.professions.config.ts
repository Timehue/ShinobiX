import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    testMatch: 'profession-hubs.spec.ts',
    // The first visit compiles the full game module graph in this dev preview.
    timeout: 300_000,
    expect: { timeout: 30_000 },
    workers: 1,
    reporter: 'line',
    outputDir: 'test-results/profession-hubs',
    use: {
        baseURL: 'http://127.0.0.1:5191',
        serviceWorkers: 'block',
        contextOptions: { reducedMotion: 'reduce' },
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: 'node node_modules/vite/bin/vite.js --config vite.professions.config.ts --host 127.0.0.1 --port 5191 --strictPort',
        url: 'http://127.0.0.1:5191',
        env: { VITE_SKIP_HTTPS: '1' },
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
    },
    projects: [
        { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
        { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4174';

export default defineConfig({
    testDir: './e2e-visual',
    snapshotDir: './e2e-visual/__snapshots__',
    snapshotPathTemplate: '{snapshotDir}/{arg}{ext}',
    outputDir: 'test-results/visual',
    timeout: 60_000,
    expect: {
        timeout: 10_000,
        toHaveScreenshot: {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.005,
            threshold: 0.2,
        },
    },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
    use: {
        baseURL,
        browserName: 'chromium',
        viewport: { width: 1366, height: 768 },
        colorScheme: 'dark',
        locale: 'en-US',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: 'npm run preview -- --host 127.0.0.1 --port 4174',
        url: baseURL,
        env: { VITE_SKIP_HTTPS: '1' },
        reuseExistingServer: false,
        timeout: 120_000,
    },
    projects: [{ name: 'chromium-windows', use: { browserName: 'chromium' } }],
});

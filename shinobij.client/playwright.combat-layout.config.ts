import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4183';

export default defineConfig({
    testDir: './e2e-live',
    testMatch: 'combat-layout-matrix.spec.ts',
    timeout: 240_000,
    expect: { timeout: 20_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'line',
    outputDir: 'test-results/combat-layout',
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
        viewport: { width: 1440, height: 900 },
    },
    webServer: {
        command: 'node ../dist/server.js',
        url: `${baseURL}/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
            NODE_ENV: 'test',
            SHINOBIX_QA_MEMORY_KV: '1',
            PORT: '4183',
            SESSION_SECRET: 'combat-layout-e2e-session-secret-32-bytes-minimum',
            ADMIN_PASSWORD: 'live-express-e2e-admin',
            DISABLE_SCHEDULED_JOBS: '1',
            DISABLE_REALTIME: '1',
            DISABLE_SNAPSHOT_CRON: '1',
            SENTRY_DSN: '',
        },
    },
    projects: [
        { name: 'chromium-layout', use: { browserName: 'chromium' } },
        { name: 'chromium-dpr125', use: { browserName: 'chromium', deviceScaleFactor: 1.25 } },
        { name: 'chromium-dpr15', use: { browserName: 'chromium', deviceScaleFactor: 1.5 } },
        { name: 'chromium-dpr2', use: { browserName: 'chromium', deviceScaleFactor: 2 } },
        { name: 'firefox-layout', use: { browserName: 'firefox' } },
        { name: 'webkit-layout', use: { browserName: 'webkit' } },
    ],
});

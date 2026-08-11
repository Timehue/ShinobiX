import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4183';

export default defineConfig({
    testDir: './e2e-live',
    timeout: 180_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: 'line',
    outputDir: 'test-results/live-express',
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
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
            SESSION_SECRET: 'live-express-e2e-session-secret-32-bytes-minimum',
            ADMIN_PASSWORD: 'live-express-e2e-admin',
            DISABLE_SCHEDULED_JOBS: '1',
            // Keep the real Socket.IO layer on for the built-Express suite. The
            // resilience spec below certifies two independently authenticated
            // players, cross-visible presence, movement, and transport recovery.
            // Ordinary browser specs do not need to open a socket themselves.
            DISABLE_REALTIME: '0',
            DISABLE_SNAPSHOT_CRON: '1',
            SENTRY_DSN: '',
        },
    },
    projects: [
        { name: 'chromium-desktop-live', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'chromium-mobile-live', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

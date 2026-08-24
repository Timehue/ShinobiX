import { defineConfig } from '@playwright/test';
import { liveE2ePort } from './e2e-ports';

const port = liveE2ePort();
const baseURL = `http://127.0.0.1:${port}`;

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
            PORT: port,
            SESSION_SECRET: 'live-express-e2e-session-secret-32-bytes-minimum',
            ADMIN_PASSWORD: 'live-express-e2e-admin',
            DISABLE_SCHEDULED_JOBS: '1',
            DISABLE_REALTIME: '1',
            DISABLE_SNAPSHOT_CRON: '1',
            // Both default ON (api/_release-flags.ts kills them only on '1'),
            // but village-stores-express.spec.ts asserts the Cafeteria kitchen,
            // the Town Hall Provisions/Materials rows and the Supply log — all
            // of which vanish when either switch is set. Spelled out so an
            // ambient DISABLE_VILLAGE_* in a developer's shell cannot silently
            // turn the loop's whole surface off and leave the failure looking
            // like a missing element.
            DISABLE_VILLAGE_WAR: '',
            DISABLE_VILLAGE_STORES: '',
            SENTRY_DSN: '',
        },
    },
    projects: [
        { name: 'chromium-desktop-live', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'chromium-mobile-live', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

import { defineConfig } from '@playwright/test';
import { combatLayoutE2ePort } from './e2e-ports';

// Per-worktree so parallel sessions stop fighting over one port: two
// simultaneous runs on a shared port kill each other's webServer mid-run
// (reuse is false, and the documented port-cleanup recipe kills whichever PID
// holds the port — including a sibling's live server). COMBAT_LAYOUT_PORT
// still overrides, and CI keeps 4183; see ./e2e-ports.ts.
const port = combatLayoutE2ePort();
const baseURL = `http://127.0.0.1:${port}`;

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
            PORT: port,
            SESSION_SECRET: 'combat-layout-e2e-session-secret-32-bytes-minimum',
            ADMIN_PASSWORD: 'live-express-e2e-admin',
            DISABLE_SCHEDULED_JOBS: '1',
            DISABLE_REALTIME: '1',
            DISABLE_SNAPSHOT_CRON: '1',
            // The matrix holds ONE PvP turn open across ten viewport captures
            // (>45s); this measures geometry, not the turn clock.
            DISABLE_PVP_TURN_DEADLINE: '1',
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

import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5185';

export default defineConfig({
    testDir: './e2e',
    testMatch: '**/dojo-circuit-gamepad.spec.ts',
    timeout: 45_000,
    expect: { timeout: 10_000 },
    fullyParallel: true,
    workers: 1,
    reporter: 'line',
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        serviceWorkers: 'block',
        contextOptions: { reducedMotion: 'reduce' },
    },
    webServer: {
        command: 'npm run build:dojo-qa && npm run preview -- --config scripts/vite.dojo-qa.config.mjs --configLoader runner --host 127.0.0.1 --port 5185 --strictPort',
        url: `${baseURL}/dojo-circuit-qa.html`,
        reuseExistingServer: false,
        timeout: 300_000,
        env: { VITE_SKIP_HTTPS: '1' },
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
        { name: 'firefox', use: { browserName: 'firefox', viewport: { width: 1280, height: 900 } } },
        { name: 'webkit', use: { browserName: 'webkit', viewport: { width: 1280, height: 900 } } },
    ],
});

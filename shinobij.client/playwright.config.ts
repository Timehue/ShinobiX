import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:4173';

export default defineConfig({
    testDir: './e2e',
    timeout: 45_000,
    expect: { timeout: 10_000 },
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : undefined,
    reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        reducedMotion: 'reduce',
    },
    webServer: {
        command: 'npm run preview -- --host 127.0.0.1 --port 4173',
        url: baseURL,
        env: { VITE_SKIP_HTTPS: '1' },
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
    projects: [
        { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'firefox-desktop', use: { browserName: 'firefox', viewport: { width: 1366, height: 768 } } },
        { name: 'webkit-desktop', use: { browserName: 'webkit', viewport: { width: 1366, height: 768 } } },
        { name: 'chromium-compact', use: { browserName: 'chromium', viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true } },
        { name: 'chromium-mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
        { name: 'webkit-mobile', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
        { name: 'chromium-tablet', use: { browserName: 'chromium', viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true } },
    ],
});

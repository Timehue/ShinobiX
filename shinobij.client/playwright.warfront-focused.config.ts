import { defineConfig } from '@playwright/test';

// Reuse the optimized, local Warfront QA preview for focused integration checks.
export default defineConfig({
    testDir: './e2e-warfront',
    timeout: 90_000,
    expect: { timeout: 20_000 },
    workers: 1,
    reporter: 'line',
    use: { baseURL: process.env.WARFRONT_QA_URL ?? 'http://127.0.0.1:5180', serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
        { name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
    ],
});

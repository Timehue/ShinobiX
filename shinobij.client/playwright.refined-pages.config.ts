import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    testMatch: 'pet-home-visual.spec.ts',
    grep: new RegExp(process.env.GAME_QA_TESTS || 'refined companion and Sunscar pages|refined integration'),
    timeout: 180_000,
    expect: { timeout: 20_000 },
    workers: 1,
    reporter: 'line',
    outputDir: '../tmp/refined-pages',
    use: {
        actionTimeout: 20_000,
        navigationTimeout: 90_000,
        baseURL: process.env.GAME_QA_URL || 'http://127.0.0.1:5187',
        serviceWorkers: 'block',
        contextOptions: { reducedMotion: 'reduce' },
        trace: 'retain-on-failure',
    },
    projects: [
        { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
        { name: 'phone', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
        { name: 'compact-desktop', use: { viewport: { width: 1100, height: 900 } } },
        { name: 'small-phone', use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
    ],
});

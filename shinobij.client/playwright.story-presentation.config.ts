import { defineConfig } from '@playwright/test';

const port = Number(process.env.STORY_PRESENTATION_PORT || 43127);
export default defineConfig({
    testDir: './e2e', testMatch: 'story-presentation.spec.ts', timeout: 180_000,
    outputDir: '../.tmp/story-presentation-browser-results',
    expect: { timeout: 30_000 }, workers: 1, reporter: 'line',
    use: { baseURL: `http://127.0.0.1:${port}`, serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' }, trace: 'retain-on-failure' },
    webServer: {
        command: `node node_modules/vite/bin/vite.js --config scripts/vite.story-presentation-qa.config.mjs --host 127.0.0.1 --port ${port}`,
        url: `http://127.0.0.1:${port}`, reuseExistingServer: false, timeout: 180_000,
    },
    projects: [
        { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'chromium-compact', use: { browserName: 'chromium', viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true } },
        { name: 'chromium-mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

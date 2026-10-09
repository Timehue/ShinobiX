import { defineConfig } from '@playwright/test';
import { resourceE2ePort } from './e2e-ports';
const port = resourceE2ePort(), baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
    testDir: './e2e', testMatch: '**/resource-gathering.spec.ts', timeout: 90_000,
    expect: { timeout: 15_000 }, workers: 1, reporter: 'line', outputDir: 'test-results/resource-gathering',
    use: { baseURL, serviceWorkers: 'block', screenshot: 'only-on-failure', contextOptions: { reducedMotion: 'reduce' } },
    webServer: {
        command: `node node_modules/vite/bin/vite.js --config scripts/vite.world-map-qa.config.mjs --configLoader runner --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL, reuseExistingServer: false, timeout: 120_000, env: { VITE_SKIP_HTTPS: '1' },
    },
    projects: [
        { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 900 } } },
        { name: 'desktop-motion', use: { browserName: 'chromium', viewport: { width: 1366, height: 900 }, contextOptions: { reducedMotion: 'no-preference' } } },
        { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true } },
        { name: 'webkit', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
        { name: 'firefox', use: { browserName: 'firefox', viewport: { width: 1366, height: 900 } } },
    ],
});

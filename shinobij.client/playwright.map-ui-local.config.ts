import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './e2e', testMatch: ['connected-sector-world.spec.ts', 'pet-mentor-guide.spec.ts', 'sector-hud.spec.ts', 'compact-map-notice.spec.ts'],
    timeout: 120_000, expect: { timeout: 15_000 }, workers: 1, reporter: 'line',
    outputDir: 'test-results/map-ui',
    use: { baseURL: 'http://127.0.0.1:5193', serviceWorkers: 'block', contextOptions: { reducedMotion: 'reduce' }, screenshot: 'only-on-failure' },
    webServer: { command: 'node node_modules/vite/bin/vite.js --config scripts/vite.world-map-qa.config.mjs --configLoader runner --host 127.0.0.1 --port 5193 --strictPort', url: 'http://127.0.0.1:5193', reuseExistingServer: false, timeout: 180_000, env: { VITE_SKIP_HTTPS: '1' } },
    projects: [
        { name: 'chromium-desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'chromium-phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
        { name: 'firefox-desktop', use: { browserName: 'firefox', viewport: { width: 1366, height: 768 } } },
        { name: 'webkit-phone', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

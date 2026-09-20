import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e', testMatch: '**/sector-hud.spec.ts', timeout: 90_000,
    expect: { timeout: 15_000 }, workers: 1, reporter: 'line',
    outputDir: 'test-results/sector-hud',
    use: { baseURL: 'http://127.0.0.1:5187', serviceWorkers: 'block',
        contextOptions: { reducedMotion: 'reduce' }, screenshot: 'only-on-failure' },
    webServer: {
        command: 'node node_modules/vite/bin/vite.js --config scripts/vite.world-map-qa.config.mjs --configLoader runner --host 127.0.0.1 --port 5187 --strictPort',
        url: 'http://127.0.0.1:5187', reuseExistingServer: false, timeout: 120_000,
        env: { VITE_SKIP_HTTPS: '1' },
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
        { name: 'webkit', use: { browserName: 'webkit', hasTouch: true } },
        { name: 'chromium-touch', use: { browserName: 'chromium', isMobile: true, hasTouch: true, viewport: {width:390,height:844} } },
    ],
});

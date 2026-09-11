import { defineConfig } from '@playwright/test';
import { visualE2ePort } from './e2e-ports';

const port = visualE2ePort();
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './e2e-visual',
    snapshotDir: './e2e-visual/__snapshots__',
    snapshotPathTemplate: '{snapshotDir}/{arg}{ext}',
    outputDir: 'test-results/visual',
    timeout: 60_000,
    expect: {
        timeout: 10_000,
        toHaveScreenshot: {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.005,
            threshold: 0.2,
        },
    },
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
    use: {
        baseURL,
        browserName: 'chromium',
        viewport: { width: 1366, height: 768 },
        colorScheme: 'dark',
        locale: 'en-US',
        // Deliberately full motion. In this app prefers-reduced-motion selects
        // the lite presentation, not just stopped animation: html.lite-fx swaps
        // in opaque panel backgrounds and hides decorative layers, the WebGL
        // backdrops stay off, and the canvas ambience draws one still frame
        // (src/lib/device-tier.ts). Baselines
        // taken that way stop showing what players see. `animations: 'disabled'`
        // above already freezes CSS animation for determinism. (The old
        // top-level `reducedMotion: 'reduce'` here was silently ignored, so the
        // committed baselines were always full motion.)
        contextOptions: { reducedMotion: 'no-preference' },
        serviceWorkers: 'block',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
    webServer: {
        command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
        url: baseURL,
        env: { VITE_SKIP_HTTPS: '1' },
        reuseExistingServer: false,
        timeout: 120_000,
    },
    projects: [{ name: 'chromium-windows', use: { browserName: 'chromium' } }],
});

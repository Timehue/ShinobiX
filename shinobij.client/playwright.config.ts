import { defineConfig } from '@playwright/test';

const port = process.env.PLAYWRIGHT_PORT ?? '4173';
const baseURL = `http://127.0.0.1:${port}`;
const previewRoot = `.playwright-dist-${port.replace(/[^a-z0-9_-]/gi, '_')}`;

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
        // Block the asset service worker (public/sw.js) during e2e. It caches only
        // hashed /assets/ files in production, but once it controls the page,
        // requests bypass Playwright's page.route() network stubs — on WebKit that
        // let the stubbed /api/perf-beacon fall through to the backend-less preview
        // server and 404, failing the runtime-failure assertions. These smoke tests
        // exercise the landing/creator journey and rely on deterministic mocking,
        // not SW behaviour, so disabling registration here is the standard fix.
        serviceWorkers: 'block',
    },
    webServer: {
        // Vite serves files directly from its output directory. A build in a
        // parallel task briefly empties dist, which used to blank live pages
        // and fail image/CSS checks mid-run. Snapshot the certified artifact
        // first so every browser worker sees one immutable release candidate.
        command: `node scripts/prepare-e2e-preview.mjs ${previewRoot} && npm run preview -- --host 127.0.0.1 --port ${port} --outDir ${previewRoot}`,
        url: baseURL,
        env: { VITE_SKIP_HTTPS: '1' },
        // Never certify an unrelated dev/preview process that happens to own
        // the port; the immutable snapshot above is part of the test contract.
        reuseExistingServer: false,
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

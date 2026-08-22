import { defineConfig } from '@playwright/test';
import { previewRootFor, smokeE2ePort } from './e2e-ports';

const port = smokeE2ePort();
const baseURL = `http://127.0.0.1:${port}`;
const previewRoot = previewRootFor(port);

// The non-combat screen walk visits ~20 screens per project. Layout-at-viewport
// is what it measures, and the two chromium viewports below cover that, so the
// other five projects were paying 31 tests each for the same answer — which is
// what took e2e-responsive from 8 min to 15 min.
//
// item-artwork-coverage is deliberately NOT in this list: it is only 2 tests and
// it decodes the actual WebP catalog, which is precisely the thing that can
// differ between Chromium, Firefox and WebKit. It keeps running everywhere.
const SCREEN_WALK_SPEC = ['**/non-combat-ui-audit.spec.ts'];

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
        { name: 'firefox-desktop', testIgnore: SCREEN_WALK_SPEC, use: { browserName: 'firefox', viewport: { width: 1366, height: 768 } } },
        { name: 'webkit-desktop', testIgnore: SCREEN_WALK_SPEC, use: { browserName: 'webkit', viewport: { width: 1366, height: 768 } } },
        { name: 'chromium-compact', testIgnore: SCREEN_WALK_SPEC, use: { browserName: 'chromium', viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true } },
        { name: 'chromium-mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
        { name: 'webkit-mobile', testIgnore: SCREEN_WALK_SPEC, use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
        { name: 'chromium-tablet', testIgnore: SCREEN_WALK_SPEC, use: { browserName: 'chromium', viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true } },
    ],
});

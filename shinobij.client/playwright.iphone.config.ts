import { defineConfig, devices } from '@playwright/test';
import { iphoneE2ePort, previewRootFor } from './e2e-ports';

const port = iphoneE2ePort();
const baseURL = `http://127.0.0.1:${port}`;
const auditBuiltRelease = process.env.IPHONE_AUDIT_BUILT === '1';
const previewRoot = previewRootFor(port);

export default defineConfig({
    testDir: './e2e',
    testMatch: ['**/iphone-experience.spec.ts', '**/non-combat-ui-audit.spec.ts'],
    timeout: 90_000,
    expect: { timeout: 20_000 },
    workers: 1,
    retries: 0,
    reporter: 'line',
    outputDir: 'test-results/iphone',
    use: {
        baseURL,
        colorScheme: 'dark',
        serviceWorkers: 'block',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        // Full effects are deliberate: reduced motion used to hide this path.
        contextOptions: { reducedMotion: 'no-preference' },
    },
    webServer: {
        command: auditBuiltRelease
            ? `node scripts/prepare-e2e-preview.mjs ${previewRoot} && node node_modules/vite/bin/vite.js preview --config scripts/vite.iphone-qa.config.mjs --configLoader runner --host 127.0.0.1 --port ${port} --strictPort --outDir ${previewRoot}`
            : `node node_modules/vite/bin/vite.js --config scripts/vite.iphone-qa.config.mjs --configLoader runner --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: auditBuiltRelease ? 300_000 : 120_000,
    },
    projects: [
        { name: 'iphone-small', use: { ...devices['iPhone SE'], browserName: 'webkit' } },
        { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
        { name: 'iphone-large', use: { ...devices['iPhone 13 Pro Max'], browserName: 'webkit' } },
        { name: 'iphone-landscape', use: { ...devices['iPhone 13 landscape'], browserName: 'webkit' } },
        { name: 'ipad', use: { ...devices['iPad Mini'], browserName: 'webkit' } },
        { name: 'android-parity', use: { ...devices['Pixel 5'], browserName: 'chromium' } },
    ],
});

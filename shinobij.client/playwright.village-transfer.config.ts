import { defineConfig } from '@playwright/test';
import responsiveConfig from './playwright.config';

const port = Number(process.env.VILLAGE_TRANSFER_E2E_PORT ?? 5197);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('VILLAGE_TRANSFER_E2E_PORT must be an integer from 1 to 65535');
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
    testDir: './e2e', testMatch: '**/village-transfer.spec.ts', timeout: 60_000,
    expect: { timeout: 15_000 }, workers: 1, reporter: 'line', outputDir: 'test-results/village-transfer',
    use: {
        baseURL, serviceWorkers: 'block', screenshot: 'only-on-failure',
        trace: 'retain-on-failure', video: 'retain-on-failure',
        contextOptions: { reducedMotion: 'reduce' },
    },
    webServer: {
        command: `node node_modules/vite/bin/vite.js --config scripts/vite.village-transfer-qa.config.mjs --configLoader runner --host 127.0.0.1 --port ${port} --strictPort`,
        url: `${baseURL}/e2e/fixtures/village-transfer.html`, reuseExistingServer: false, timeout: 120_000,
        env: { VITE_SKIP_HTTPS: '1' },
    },
    // Keep every responsive browser/viewport while serving the source fixture.
    // Production-preview testIgnore rules do not apply to this dedicated suite.
    projects: responsiveConfig.projects?.map(({ name, use }) => ({ name, use })),
});

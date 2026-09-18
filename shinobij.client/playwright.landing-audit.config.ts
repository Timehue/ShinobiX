import { defineConfig } from '@playwright/test';
import visualConfig from './playwright.visual.config';

// Functional coverage across engines; pixel baselines remain Chromium-specific.
export default defineConfig({
    ...visualConfig,
    outputDir: 'test-results/landing-audit',
    grep: /landing (entry points|policy links|navigation,|assets and|play buttons|atmosphere|scroll reveals|lifecycle)/,
    workers: 2,
    projects: [
        { name: 'firefox-desktop', use: { browserName: 'firefox' } },
        { name: 'webkit-desktop', use: { browserName: 'webkit' } },
    ],
});

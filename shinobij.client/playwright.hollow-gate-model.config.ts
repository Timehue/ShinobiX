import { defineConfig } from '@playwright/test';
import base from './playwright.hollow-gate-return.config';

export default defineConfig({
    ...base,
    testMatch: '**/hollow-gate-model.spec.ts',
    outputDir: 'test-results/hollow-gate-model',
    projects: [
        { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1366, height: 768 } } },
        { name: 'phone', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    ],
});

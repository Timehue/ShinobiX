import { defineConfig } from '@playwright/test';
import live from './playwright.live.config';
export default defineConfig({ ...live, testMatch: ['resource-recovery.spec.ts', 'resource-gathering.spec.ts'],
    outputDir: process.env.RESOURCE_RECOVERY_OUTPUT || 'test-results/resource-recovery',
    projects: [
        { name: 'chromium-desktop-recovery', use: { browserName: 'chromium', viewport: { width: 1366, height: 900 } } },
        { name: 'chromium-portrait-recovery', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
        { name: 'chromium-landscape-recovery', use: { browserName: 'chromium', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true } },
    ],
});

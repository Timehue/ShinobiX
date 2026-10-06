import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
    ...base,
    testMatch: '**/dojo-circuit-gamepad.spec.ts',
    testIgnore: [],
    timeout: 45_000,
    expect: { timeout: 10_000 },
    fullyParallel: true,
    workers: 1,
    reporter: 'line',
    // Exercise the immutable production preview for this focused flow. Preserve
    // this focused runner's project names for existing command-line callers.
    projects: [
        { name: 'chromium', use: { browserName: 'chromium', viewport: { width: 1280, height: 900 } } },
        { name: 'firefox', use: { browserName: 'firefox', viewport: { width: 1280, height: 900 } } },
        { name: 'webkit', use: { browserName: 'webkit', viewport: { width: 1280, height: 900 } } },
    ],
});

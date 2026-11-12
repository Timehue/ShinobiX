import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Run against the immutable game build with SECTOR_MODEL_TEST_CONTENT pointing
// at the staged objects. Missing portraits or packages remain hard failures.
export default defineConfig({
    ...base,
    testMatch: 'sector-model-roster.spec.ts',
    testIgnore: [],
    projects: base.projects?.map(project => ({...project, testIgnore: []})),
});

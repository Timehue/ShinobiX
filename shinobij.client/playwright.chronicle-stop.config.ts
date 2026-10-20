import { defineConfig } from '@playwright/test';
import base from './playwright.sector-life.config';
export default defineConfig({ ...base, testMatch: ['chronicle-stop.spec.ts', 'sector-life.spec.ts'],
    grep: /travelers play Chronicle|regional workers 42 /, outputDir: 'test-results/chronicle-stop' });

import { defineConfig } from '@playwright/test';
import base from './playwright.sector-life.config';
export default defineConfig({ ...base, testMatch: 'resource-surface.spec.ts', outputDir: 'test-results/resource-surface' });

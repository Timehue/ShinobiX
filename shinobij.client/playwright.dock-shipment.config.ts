import { defineConfig } from '@playwright/test';
import base from './playwright.sector-life.config';
export default defineConfig({ ...base, testMatch: 'dock-shipment.spec.ts', timeout: 240_000,
    outputDir: 'test-results/dock-shipment' });

import {defineConfig} from '@playwright/test';
import base from './playwright.sector-life.config';
export default defineConfig({...base,testMatch:'world-companion.spec.ts',timeout:180_000,outputDir:'test-results/world-companion'});

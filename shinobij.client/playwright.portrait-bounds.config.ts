import { defineConfig } from '@playwright/test';
import story from './playwright.story-presentation.config';

export default defineConfig(story, {
    testMatch: 'vn-portrait-bounds.spec.ts',
    outputDir: '../.tmp/portrait-clipping-browser-results',
});

import { defineConfig } from '@playwright/test';
import audit from './playwright.ui-audit.config';

// Populated companion workflows and both story readers complement the route walk.
// Inherits the same immutable production preview (or UI_AUDIT_BASE_URL for local review).
export default defineConfig({
    ...audit,
    testMatch: ['**/pet-home-visual.spec.ts', '**/story-presentation.spec.ts', '**/story-polish.spec.ts', '**/first-pact-rpg.spec.ts'],
    outputDir: 'test-results/presentation-workflows',
    projects: audit.projects?.filter(project => ['chromium-desktop', 'chromium-mobile'].includes(project.name ?? '')),
});

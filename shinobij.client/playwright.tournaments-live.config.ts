import { defineConfig } from '@playwright/test';
import fixture from './playwright.tournaments.config';
export default defineConfig({
    ...fixture, testMatch: '**/tournaments-live.spec.ts', timeout: 180_000,
    outputDir: 'test-results/tournaments-live',
    webServer: [{
        command: 'node --import tsx ../scripts/tournament-integration-server.ts',
        url: 'http://127.0.0.1:5198/health', reuseExistingServer: false, timeout: 120_000,
        env: { NODE_ENV: 'test', SHINOBIX_QA_MEMORY_KV: '1', ADMIN_PASSWORD: 'qa-admin', SESSION_SECRET: 'tournament-qa-session-secret-at-least-32-characters', DISABLE_REALTIME: '1', DISABLE_SCHEDULED_JOBS: '1' },
    }, fixture.webServer as NonNullable<typeof fixture.webServer> extends Array<infer T> ? T : NonNullable<typeof fixture.webServer>],
});

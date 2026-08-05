import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientAnalyticsConfig } from './index';
import { dispatchClientPostHogEvent } from './posthog';
import { createProductEvent } from '../../../../shared/product-analytics';

describe('client product analytics', () => {
    it('is disabled without every explicit build-time gate', () => {
        assert.equal(clientAnalyticsConfig({}), null);
        assert.equal(clientAnalyticsConfig({
            VITE_PRODUCT_ANALYTICS_ENABLED: '1',
            VITE_PRODUCT_ANALYTICS_PROVIDER: 'posthog',
            VITE_POSTHOG_KEY: 'phc_public_test',
        }), null);
    });

    it('keeps provider code behind a dynamic import', () => {
        const source = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'analytics', 'index.ts'), 'utf8');
        assert.match(source, /import\(['"]\.\/posthog['"]\)/);
        assert.doesNotMatch(source, /^import\s+.+from\s+['"]\.\/posthog['"]/m);
    });

    it('dispatches only the already-sanitized anonymous event', async () => {
        let body = '';
        const event = createProductEvent('landing_viewed', { screenId: 'landing', playerName: 'private' });
        assert.ok(event);
        const sent = await dispatchClientPostHogEvent({
            projectKey: 'phc_public_test', host: 'https://eu.i.posthog.com', timeoutMs: 1_500,
        }, event!, async (_url, init) => {
            body = String(init?.body ?? '');
            return new Response(null, { status: 200 });
        });
        assert.equal(sent, true);
        assert.match(body, /landing_viewed/);
        assert.doesNotMatch(body, /private/);
        assert.match(body, /\$process_person_profile/);
    });
});

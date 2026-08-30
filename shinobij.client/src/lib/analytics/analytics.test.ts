import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientAnalyticsConfig } from './runtime';
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
        assert.match(source, /import\(['"]\.\/runtime['"]\)/);
        assert.doesNotMatch(source, /^import\s+.+from\s+['"]\.\/posthog['"]/m);
        const runtime = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'analytics', 'runtime.ts'), 'utf8');
        assert.match(runtime, /import\(['"]\.\/posthog['"]\)/);
    });

    it('accepts the ambient surface and viewport buckets', () => {
        const event = createProductEvent('landing_viewed', {
            screenId: 'landing', surface: 'play-app', viewportClass: 'sm',
        });
        assert.equal(event?.properties.surface, 'play-app');
        assert.equal(event?.properties.viewportClass, 'sm');
    });

    it('still drops anything outside the allowlist', () => {
        // Widening the allowlist for `surface` must not have widened it generally.
        const event = createProductEvent('landing_viewed', { deviceId: 'abc-123', userAgent: 'Mozilla' });
        assert.equal(event?.properties && 'deviceId' in event.properties, false);
        assert.equal(event?.properties && 'userAgent' in event.properties, false);
    });

    it('stamps ambient properties AFTER the caller, so a call site cannot forge its surface', () => {
        // Ordering is the whole guarantee here: spread the caller first, then
        // overwrite with runtime truth. If these are ever swapped, a call site
        // could claim to be the Play app and quietly skew the split that the
        // storefront decision rests on.
        const runtime = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'analytics', 'runtime.ts'), 'utf8');
        const spread = runtime.indexOf('...properties,');
        const ambient = runtime.indexOf('...ambientProperties(),');
        assert.ok(spread >= 0 && ambient >= 0, 'both spreads should be present');
        assert.ok(ambient > spread, 'ambientProperties() must be spread after the caller properties');
    });

    it('leaves server-authoritative events without a surface or viewport', () => {
        // The server has no viewport and cannot tell the surfaces apart, so it
        // must never invent one.
        const server = readFileSync(join(process.cwd(), 'api', '_product-analytics.ts'), 'utf8');
        assert.doesNotMatch(server, /viewportClass|surface|getSurface/);
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

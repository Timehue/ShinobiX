import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { dispatchServerProductEvent, serverAnalyticsConfig } from './_product-analytics.js';

describe('server product analytics', () => {
    it('is disabled unless every explicit provider gate is present', () => {
        assert.equal(serverAnalyticsConfig({}), null);
        assert.equal(serverAnalyticsConfig({ PRODUCT_ANALYTICS_ENABLED: '1' }), null);
        assert.equal(serverAnalyticsConfig({
            PRODUCT_ANALYTICS_ENABLED: '1', PRODUCT_ANALYTICS_PROVIDER: 'posthog',
            POSTHOG_PROJECT_KEY: 'phc_public_test', POSTHOG_HOST: 'https://us.i.posthog.com/path',
        }), null);
    });

    it('does not call the network when disabled', async () => {
        let calls = 0;
        const result = await dispatchServerProductEvent('account_registered', {}, {
            env: {}, fetcher: async () => { calls += 1; return new Response(null, { status: 200 }); },
        });
        assert.equal(result, 'disabled');
        assert.equal(calls, 0);
    });

    it('posts an anonymous, personless allowlisted event with a bounded timeout', async () => {
        let request: { url: string; init?: RequestInit } | undefined;
        const result = await dispatchServerProductEvent('mission_settled', {
            source: 'combat', contentId: 'combat-e-drill', playerName: 'must-not-send', exactBalance: 999,
        }, {
            env: {
                PRODUCT_ANALYTICS_ENABLED: '1', PRODUCT_ANALYTICS_PROVIDER: 'posthog',
                POSTHOG_PROJECT_KEY: 'phc_public_test', POSTHOG_HOST: 'https://us.i.posthog.com',
            },
            fetcher: async (url, init) => {
                request = { url: String(url), init };
                return new Response(null, { status: 200 });
            },
        });
        assert.equal(result, 'sent');
        assert.equal(request?.url, 'https://us.i.posthog.com/i/v0/e/');
        const body = JSON.parse(String(request?.init?.body));
        assert.equal(body.event, 'mission_settled');
        assert.equal(body.distinct_id, 'shinobi-journey-aggregate-v1');
        assert.equal(body.properties.$process_person_profile, false);
        assert.equal(body.properties.eventAuthority, 'server_authoritative');
        assert.equal(body.properties.playerName, undefined);
        assert.equal(body.properties.exactBalance, undefined);
        assert.ok(request?.init?.signal instanceof AbortSignal);
    });
});

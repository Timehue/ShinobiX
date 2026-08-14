import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { createProductEvent, PRODUCT_EVENT_NAMES } from '../shared/product-analytics.js';

describe('product analytics schema', () => {
    it('keeps the explicit taxonomy intentionally bounded', () => {
        assert.ok(PRODUCT_EVENT_NAMES.length >= 8);
        assert.ok(PRODUCT_EVENT_NAMES.length <= 24);
    });

    it('keeps the data inventory complete for every allowlisted event', () => {
        const inventory = readFileSync('docs/PRODUCT_ANALYTICS_DATA_INVENTORY.md', 'utf8');
        for (const name of PRODUCT_EVENT_NAMES) assert.match(inventory, new RegExp('\\| `' + name + '` \\|'), name);
    });

    it('allowlists the requested aggregate supporter journey without identity or payment data', () => {
        const names = [
            'supporter_page_viewed',
            'patreon_connection_started',
            'patreon_connection_succeeded',
            'patreon_connection_failed',
            'locked_jutsu_slot_inspected',
            'sanctuary_overflow_explanation_viewed',
            'subscription_entitlement_refresh_failed',
        ] as const;
        for (const name of names) assert.ok(PRODUCT_EVENT_NAMES.includes(name), name);

        assert.deepEqual(createProductEvent('patreon_connection_succeeded', {
            source: 'patreon-oauth-callback', resultCategory: 'active',
            playerName: 'private', token: 'secret', paymentAmount: 1500,
        }), {
            name: 'patreon_connection_succeeded',
            properties: { source: 'patreon-oauth-callback', resultCategory: 'active' },
        });
    });

    it('drops unknown events, freeform properties, identifiers, and non-bucketed numbers', () => {
        assert.equal(createProductEvent('unknown', {}), null);
        assert.deepEqual(createProductEvent('feature_entry_clicked', {
            source: 'landing', contentId: 'guides', playerName: 'Visible Player',
            chat: 'private', exactBalance: 1000, screenId: 'bad value with spaces',
        }), {
            name: 'feature_entry_clicked', properties: { source: 'landing', contentId: 'guides' },
        });
    });

    it('tracks focus interactions with bounded aggregate properties', () => {
        assert.deepEqual(createProductEvent('activity_recommendation_viewed', {
            screenId: 'daily-briefing', mode: 'focus-selected', focus: 'towers-spire',
            playerName: 'Visible Player', exactLevel: 85,
        }), {
            name: 'activity_recommendation_viewed',
            properties: { screenId: 'daily-briefing', mode: 'focus-selected', focus: 'towers-spire' },
        });
    });
});

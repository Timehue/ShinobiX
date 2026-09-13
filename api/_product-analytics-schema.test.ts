import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { createProductEvent, PRODUCT_EVENT_NAMES } from '../shared/product-analytics.js';

describe('product analytics schema', () => {
    it('keeps the initial taxonomy intentionally small', () => {
        assert.ok(PRODUCT_EVENT_NAMES.length >= 8);
        assert.ok(PRODUCT_EVENT_NAMES.length <= 16); // one bounded first-hour milestone event, not one event per route
    });

    it('keeps first-hour milestones anonymous and bounded', () => {
        assert.deepEqual(createProductEvent('first_hour_milestone', {
            source: 'first-contract', stateCategory: 'activity-completed', mode: 'combat',
            playerName: 'Private Name', vow: 'private narrative', completedAt: 1234567,
        }), { name: 'first_hour_milestone', properties: { source: 'first-contract', stateCategory: 'activity-completed', mode: 'combat' } });
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

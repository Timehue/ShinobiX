import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { auraSphereDustNeeded, feedAuraSphere } from './_feed.js';

describe('Aura Sphere feed authority', () => {
    const base = { inventory: ['aura-sphere'], auraSphereLevel: 1, auraDust: 100, redeemedAuraFeeds: [] };

    it('matches the canonical dust curve and atomically spends one level', () => {
        assert.equal(auraSphereDustNeeded(1), 14);
        assert.equal(auraSphereDustNeeded(150), 387);
        const out = feedAuraSphere(base, 'feed_action_001');
        assert.equal(out.ok, true);
        if (!out.ok) return;
        assert.equal(out.character.auraSphereLevel, 2);
        assert.equal(out.character.auraDust, 86);
        assert.deepEqual(out.character.redeemedAuraFeeds, ['feed_action_001']);
    });

    it('is replay-safe and enforces ownership, funds, and the level cap', () => {
        const once = feedAuraSphere(base, 'feed_action_002');
        assert.equal(once.ok, true);
        if (!once.ok) return;
        const replay = feedAuraSphere(once.character, 'feed_action_002');
        assert.equal(replay.ok, true);
        if (replay.ok) assert.equal(replay.alreadyApplied, true);
        assert.equal(feedAuraSphere({ ...base, inventory: [] }, 'feed_action_003').ok, false);
        assert.equal(feedAuraSphere({ ...base, auraDust: 0 }, 'feed_action_004').ok, false);
        assert.equal(feedAuraSphere({ ...base, auraSphereLevel: 300 }, 'feed_action_005').ok, false);
    });
});

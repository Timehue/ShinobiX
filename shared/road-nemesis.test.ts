import test from 'node:test';
import assert from 'node:assert/strict';
import { WANDERER_BUCKET_MS, WANDERER_SECTOR_COUNT } from './wanderer-roster.js';
import {
    ROAD_NEMESIS_GRACE_MS,
    ROAD_NEMESIS_NAME,
    ROAD_NEMESIS_PRESENCE,
    roadNemesisActorId,
    roadNemesisAftermath,
    roadNemesisGreeting,
    roadNemesisPresentAt,
    roadNemesisPresentIn,
    roadNemesisTier,
    roadNemesisTitle,
} from './road-nemesis.js';

const BUCKET = 5000;

test('Kagero waits in about a quarter of the sectors, per player and window', () => {
    let seen = 0, total = 0;
    for (let bucket = BUCKET; bucket < BUCKET + 50; bucket++) {
        for (let sector = 1; sector <= WANDERER_SECTOR_COUNT; sector++) {
            total++;
            if (roadNemesisPresentIn('Roadwalker', sector, bucket)) seen++;
        }
    }
    assert.ok(Math.abs(seen / total - ROAD_NEMESIS_PRESENCE) < 0.04, `presence ${seen / total}`);
    assert.equal(roadNemesisPresentIn('Roadwalker', 0, BUCKET), false, 'never in the village');
    assert.equal(roadNemesisPresentIn('', 12, BUCKET), false);
    const a = Array.from({ length: 66 }, (_, i) => roadNemesisPresentIn('Roadwalker', i + 1, BUCKET));
    const b = Array.from({ length: 66 }, (_, i) => roadNemesisPresentIn('roadwalker ', i + 1, BUCKET));
    assert.deepEqual(a, b, 'keyed by the trimmed, lower-case name');
});

test('the server honours a fight started just across the turn of the window', () => {
    let sector = 1;
    while (!roadNemesisPresentIn('Roadwalker', sector, BUCKET - 1) || roadNemesisPresentIn('Roadwalker', sector, BUCKET)) sector++;
    const turn = BUCKET * WANDERER_BUCKET_MS;
    assert.equal(roadNemesisPresentAt('Roadwalker', sector, turn + 1_000), true);
    assert.equal(roadNemesisPresentAt('Roadwalker', sector, turn + ROAD_NEMESIS_GRACE_MS + 1), false);
});

test('his record, title and voice escalate with every win over you', () => {
    assert.equal(roadNemesisTier(null), 1);
    assert.equal(roadNemesisTier({ tier: 0 }), 1);
    assert.equal(roadNemesisTier({ tier: 4.7 }), 4);
    assert.equal(roadNemesisTitle(1), ROAD_NEMESIS_NAME);
    const titles = [1, 2, 3, 4, 9].map(roadNemesisTitle);
    assert.equal(new Set(titles.slice(0, 4)).size, 4, 'each of the first four tiers has its own title');
    for (const tier of [1, 2, 3, 4]) {
        assert.match(roadNemesisGreeting(tier, 'Aiko'), /Aiko/u);
        assert.match(roadNemesisAftermath(true, tier), new RegExp(ROAD_NEMESIS_NAME, 'u'));
        assert.match(roadNemesisAftermath(false, tier), new RegExp(ROAD_NEMESIS_NAME, 'u'));
    }
    assert.equal(roadNemesisActorId(12, BUCKET), 'nemesis-12-5000');
});

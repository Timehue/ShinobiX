import { test } from 'node:test';
import assert from 'node:assert/strict';
import { synthMercWanderer, mercTierName, mercEngageMessage, type RoamingMercView } from './merc-roam-client.js';

test('mercEngageMessage speaks to the attacker a sector band hunts (owner redesign 2026-10-08)', () => {
    assert.equal(mercEngageMessage({ context: 'sector', winner: 'merc' }), 'The mercenary overwhelmed you. The defenders gain ground in this sector.');
    assert.equal(mercEngageMessage({ context: 'sector', winner: 'player' }), 'You cut the mercenary down. Your siege gains a little ground.');
    assert.equal(mercEngageMessage({ context: 'village', winner: 'merc' }), 'The mercenary overwhelmed you. Your village pays for it.');
    assert.equal(mercEngageMessage({ context: 'village', winner: 'player' }), 'You cut the mercenary down.');
    assert.equal(mercEngageMessage({ winner: 'stall' }), 'You traded blows; the mercenary broke off.');
    assert.equal(mercEngageMessage({ error: 'That mercenary is no longer here.' }), 'That mercenary is no longer here.');
});

test('synthMercWanderer makes a hostile, attacking, wanderer-shaped NPC', () => {
    const merc: RoamingMercView = { id: 'merc-stormveilvillage-oni-0', village: 'Stormveil Village', tierId: 'oni', level: 95, context: 'sector' };
    const w = synthMercWanderer(merc);
    assert.equal(w.id, merc.id);        // the id (merc-…) is what engage + isMercAiId key off
    assert.equal(w.verb, 'attack');     // mercs hunt the player
    assert.equal(w.archetype, 'bandit');// renders with the existing bandit visuals
    assert.equal(w.level, 95);
    assert.equal(w.name, 'Oni Mercenary');
    assert.ok(w.homeTile >= 0 && w.homeTile < 144);
    assert.ok(w.waypoints.includes(w.homeTile));
});

test('synthMercWanderer is deterministic (no teleport between roster polls)', () => {
    const merc: RoamingMercView = { id: 'merc-ashenleaf-ronin-2', village: 'Ashenleaf Village', tierId: 'ronin', level: 75, context: 'village' };
    const a = synthMercWanderer(merc);
    const b = synthMercWanderer(merc);
    assert.equal(a.homeTile, b.homeTile);
    assert.deepEqual(a.waypoints, b.waypoints);
    assert.equal(a.greeting, b.greeting);
});

test('mercTierName maps tiers and falls back to "Mercenary"', () => {
    assert.equal(mercTierName('warlord'), 'Mercenary Warlord');
    assert.equal(mercTierName('ronin'), 'Rōnin Blade');
    assert.equal(mercTierName('unknown'), 'Mercenary');
});

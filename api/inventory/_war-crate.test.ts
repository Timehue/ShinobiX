import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    applyWarCrateOpen,
    DUNGEON_KEY_ID,
    LEGENDARY_WAR_CRATE_ID,
    WARFORGED_RELIC_ID,
} from './_war-crate.js';

function base(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: 'rill',
        profession: 'vanguard',
        ryo: 100,
        honorSeals: 2,
        boneCharms: 3,
        inventory: [],
        itemStacks: [{ itemId: LEGENDARY_WAR_CRATE_ID, count: 2 }],
        ...overrides,
    };
}

function count(character: Record<string, unknown>, itemId: string): number {
    return (character.itemStacks as Array<{ itemId: string; count: number }>)
        .filter((entry) => entry.itemId === itemId)
        .reduce((sum, entry) => sum + entry.count, 0);
}

test('opening a stacked crate consumes one and grants the sealed Vanguard payout', () => {
    const out = applyWarCrateOpen(base(), 0.1);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(count(out.character, LEGENDARY_WAR_CRATE_ID), 1);
    assert.equal(count(out.character, WARFORGED_RELIC_ID), 1);
    assert.equal(count(out.character, DUNGEON_KEY_ID), 1);
    assert.deepEqual(out.rewards, { ryo: 500, honorSeals: 10, boneCharms: 1, relic: true, dungeonKey: true });
    assert.equal(out.character.ryo, 600);
    assert.equal(out.character.honorSeals, 12);
    assert.equal(out.character.boneCharms, 4);
});

test('legacy inventory crates are consumed and non-Vanguards receive no Honor Seals', () => {
    const out = applyWarCrateOpen(base({
        profession: 'medic',
        inventory: [LEGENDARY_WAR_CRATE_ID, 'other-item'],
        itemStacks: [],
    }), 0.9);
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.deepEqual(out.character.inventory, ['other-item']);
    assert.equal(out.rewards.honorSeals, 0);
    assert.equal(out.rewards.boneCharms, 1);
    assert.equal(out.rewards.dungeonKey, false);
});

test('missing crates, malformed storage, and overflowing rewards fail without mutation', () => {
    const missing = base({ itemStacks: [] });
    assert.equal(applyWarCrateOpen(missing, 0).ok, false);
    assert.deepEqual(missing.itemStacks, []);
    assert.equal(applyWarCrateOpen(base({ itemStacks: [{ itemId: LEGENDARY_WAR_CRATE_ID, count: -1 }] }), 0).ok, false);
    assert.equal(applyWarCrateOpen(base({ ryo: Number.MAX_SAFE_INTEGER }), 0).ok, false);
    assert.equal(applyWarCrateOpen(base({
        itemStacks: [
            { itemId: LEGENDARY_WAR_CRATE_ID, count: 1 },
            { itemId: WARFORGED_RELIC_ID, count: 9999 },
        ],
    }), 0.9).ok, false);
});

test('route and client use authenticated locked settlement with no client random payout', () => {
    const route = readFileSync(join(process.cwd(), 'api', 'inventory', 'open-war-crate.ts'), 'utf8');
    const client = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'inventory-settlement.ts'), 'utf8');
    const screen = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'screens', 'Inventory.tsx'), 'utf8');
    assert.match(route, /await authedPlayerOrAdmin\(req, playerName\)/);
    assert.match(route, /await mutatePlayerSave\(playerName/);
    assert.match(route, /strict: true/);
    assert.match(route, /Promise\.allSettled/);
    assert.doesNotMatch(route, /await Promise\.all\(/,
        'economy projection failures must not turn a committed settlement into an HTTP failure');
    assert.match(client, /fetch\('\/api\/inventory\/open-war-crate'/);
    assert.match(screen, /openWarCrate\(character\.name\)/);
    assert.doesNotMatch(screen, /Math\.random\(\)/);
    // A reply refused as stale (a newer save was adopted first) is still an
    // opened, paid crate: the action closes and reports it either way.
    assert.match(screen, /onVersionedCharacter\(result\.character, result\._saveVersion\);\s*setSelectedInventoryItem\(null\)/,
        'the authoritative crate snapshot must be adopted before closing the item action');
    assert.doesNotMatch(screen, /if \(!onVersionedCharacter\(result\.character, result\._saveVersion\)\) return;\s*setSelectedInventoryItem\(null\)/,
        'a stale refusal must not leave the opened crate looking unopened');
});

test('level-100 crates can award any of the four equal offense relics without replacing base loot', () => {
    const ids = ['relic-duelists-red-cord', 'relic-mirror-mask-shard', 'relic-conquerors-war-seal', 'relic-fivefold-chakra-seal'];
    for (const [index, id] of ids.entries()) {
        const character = base({ level: 100 });
        const out = applyWarCrateOpen(character, 0.1, index * 0.001 + 0.0005);
        assert.equal(out.ok, true);
        if (!out.ok) continue;
        assert.equal(out.rewards.equippableRelicId, id);
        assert.deepEqual(out.character.inventory, [id]);
        assert.equal(count(out.character, LEGENDARY_WAR_CRATE_ID), 1);
        assert.equal(count(out.character, WARFORGED_RELIC_ID), 1);
        assert.equal(count(out.character, DUNGEON_KEY_ID), 1);
        assert.equal(out.character.ryo, 600);
        assert.deepEqual(character.inventory, [], 'pure settlement never mutates its input');
    }
    for (const [level, roll] of [[99, 0], [100, 0.004], [100, NaN], [100, -1], [100, 1]]) {
        const out = applyWarCrateOpen(base({ level }), 0.9, roll);
        assert.equal(out.ok, true);
        if (out.ok) assert.equal(out.rewards.equippableRelicId, undefined);
    }
});

test('a duplicate war-crate relic pays 15 shards once, including worn and stacked ownership', () => {
    const id = 'relic-duelists-red-cord';
    for (const owned of [
        { inventory: [LEGENDARY_WAR_CRATE_ID, id], itemStacks: [] },
        { inventory: [LEGENDARY_WAR_CRATE_ID], itemStacks: undefined, equipment: { relic: id } },
        { inventory: [LEGENDARY_WAR_CRATE_ID], itemStacks: [{ itemId: id, count: 1 }] },
    ]) {
        const out = applyWarCrateOpen(base({ ...owned, level: 100, fateShards: 7 }), 0.9, 0);
        assert.equal(out.ok, true);
        if (!out.ok) continue;
        assert.equal(out.rewards.fateShards, 15);
        assert.equal(out.rewards.equippableRelicId, undefined);
        assert.equal(out.character.fateShards, 22);
        assert.equal(applyWarCrateOpen(out.character, 0.9, 0).ok, false, 'spent crate cannot pay twice');
    }
});

test('unsafe duplicate compensation refuses the whole crate transaction', () => {
    for (const fateShards of [-1, NaN, Number.MAX_SAFE_INTEGER, '7']) {
        const before = base({ level: 100, fateShards, equipment: { relic: 'relic-duelists-red-cord' } });
        assert.equal(applyWarCrateOpen(before, 0.9, 0).ok, false);
        assert.equal(count(before, LEGENDARY_WAR_CRATE_ID), 2);
        assert.equal(before.ryo, 100);
    }
});

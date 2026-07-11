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
    assert.match(route, /await authedPlayer\(req, playerName\)/);
    assert.match(route, /await mutatePlayerSave\(playerName/);
    assert.match(route, /strict: true/);
    assert.match(client, /fetch\('\/api\/inventory\/open-war-crate'/);
    assert.doesNotMatch(screen, /Math\.random\(\)/);
    assert.match(screen, /updateCharacter\(result\.character\)/);
});

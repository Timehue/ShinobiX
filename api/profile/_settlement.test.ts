import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
    applyProfileSettlement,
    PROFILE_STAT_KEYS,
    parseProfileSettlementAction,
} from './_settlement.js';

function character(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name: 'rill',
        fateShards: 100,
        unspentStats: 5,
        stats: Object.fromEntries(PROFILE_STAT_KEYS.map((key) => [key, 10])),
        ...overrides,
    };
}

test('stat respec refunds only allocated points and debits the stored shard balance', () => {
    const input = character({
        stats: { ...character().stats as Record<string, number>, strength: 25, speed: 13 },
    });
    const out = applyProfileSettlement(input, { type: 'respec-stats' });
    assert.equal(out.ok, true);
    if (!out.ok) return;
    assert.equal(out.cost, 50);
    assert.equal(out.character.fateShards, 50);
    assert.equal(out.character.unspentStats, 23);
    assert.deepEqual(out.character.stats, Object.fromEntries(PROFILE_STAT_KEYS.map((key) => [key, 10])));
    assert.equal((input.stats as Record<string, number>).strength, 25, 'input remains immutable');
});

test('stat respec fails closed for malformed state, base stats, and insufficient shards', () => {
    assert.deepEqual(
        applyProfileSettlement(character({ stats: { strength: 20 } }), { type: 'respec-stats' }),
        { ok: false, status: 409, error: 'Stored stats are invalid. Contact support.' },
    );
    const base = applyProfileSettlement(character(), { type: 'respec-stats' });
    assert.equal(base.ok, false);
    if (!base.ok) assert.equal(base.status, 400);
    const poor = applyProfileSettlement(character({
        fateShards: 49,
        stats: { ...character().stats as Record<string, number>, strength: 11 },
    }), { type: 'respec-stats' });
    assert.equal(poor.ok, false);
    if (!poor.ok) assert.match(poor.error, /50 Fate Shards/);
});

test('paid title text is moderated, capped, idempotent, and server-debited', () => {
    const bought = applyProfileSettlement(character(), { type: 'purchase-title', title: '  Shadow Walker Long Name  ' });
    assert.equal(bought.ok, true);
    if (!bought.ok) return;
    assert.equal(bought.character.customTitle, 'Shadow Walker L');
    assert.equal(bought.character.fateShards, 90);

    const replay = applyProfileSettlement(bought.character, { type: 'purchase-title', title: 'Shadow Walker L' });
    assert.equal(replay.ok, true);
    if (replay.ok) {
        assert.equal(replay.changed, false);
        assert.equal(replay.cost, 0);
        assert.equal(replay.character.fateShards, 90);
    }

    const reserved = applyProfileSettlement(character(), { type: 'purchase-title', title: 'Server Admin' });
    assert.equal(reserved.ok, false);
    const earned = applyProfileSettlement(character(), { type: 'purchase-title', title: 'Warlord' });
    assert.equal(earned.ok, false);
});

test('paid title style and icon accept only canonical non-default values', () => {
    const styled = applyProfileSettlement(character(), { type: 'purchase-title-style', styleId: 'frost' });
    assert.equal(styled.ok, true);
    if (!styled.ok) return;
    assert.equal(styled.character.fateShards, 60);
    assert.equal(styled.character.customTitleStyle, 'frost');

    const icon = applyProfileSettlement(character(), { type: 'purchase-title-icon', icon: '⭐' });
    assert.equal(icon.ok, true);
    if (icon.ok) assert.equal(icon.character.fateShards, 75);

    assert.equal(applyProfileSettlement(character(), { type: 'purchase-title-style', styleId: '' }).ok, false);
    assert.equal(applyProfileSettlement(character(), { type: 'purchase-title-icon', icon: 'not-an-icon' }).ok, false);
});

test('request parser rejects incomplete and unknown actions', () => {
    assert.deepEqual(parseProfileSettlementAction({ type: 'respec-stats', title: 'ignored' }), { type: 'respec-stats' });
    assert.equal(parseProfileSettlementAction({ type: 'purchase-title' }), null);
    assert.equal(parseProfileSettlementAction({ type: 'unknown' }), null);
    assert.equal(parseProfileSettlementAction(null), null);
});

test('handler and client preserve the locked authoritative boundary', () => {
    const handler = readFileSync(join(process.cwd(), 'api', 'profile', 'settle.ts'), 'utf8');
    const client = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'lib', 'profile-settlement.ts'), 'utf8');
    const screen = readFileSync(join(process.cwd(), 'shinobij.client', 'src', 'screens', 'Profile.tsx'), 'utf8');
    assert.match(handler, /await authedPlayer\(req, playerName\)/);
    assert.match(handler, /await mutatePlayerSave\(playerName/);
    assert.match(handler, /enforceRateLimitKv[\s\S]+strict: true/);
    assert.match(client, /fetch\('\/api\/profile\/settle'/);
    assert.match(screen, /updateCharacter\(result\.character\)/);
    assert.doesNotMatch(screen, /stats: baseStats\(\)/);
});

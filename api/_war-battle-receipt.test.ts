import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    validateWarBattle,
    warBattleReceiptKey,
    warBattleDeclineMessage,
    normalizeWarMissionToken,
    warMissionTokenAuthorizes,
    warMissionTokenKey,
    WAR_BATTLE_DAMAGE_BUDGET,
    WAR_BATTLE_RECEIPT_LIMIT,
    WarBattleReceiptLedgerFullError,
    WarBattleReceiptLedgerMalformedError,
    embeddedWarBattleReplay,
    stampEmbeddedWarBattleReplay,
    type WarBattleShape,
} from './_war-battle-receipt.js';

const WAR_START = 1_000_000;
const ATTACKER = 'Moonshadow Village';
const DEFENDER = 'Frostfang Village';

function battle(over: Partial<WarBattleShape> = {}): WarBattleShape {
    return {
        status: 'done',
        winner: 'p1',
        createdAt: WAR_START + 5_000,
        endedAt: WAR_START + 6_000,
        rewardAuthority: 'world',
        joined: { p1: true, p2: true },
        p1: { name: 'aria' },
        p2: { name: 'kell' },
        ...over,
    };
}
// aria (p1) is Moonshadow, kell (p2) is Frostfang; aria won.
function args(over: Partial<Parameters<typeof validateWarBattle>[0]> = {}) {
    return {
        battle: battle(),
        actorName: 'aria',
        actorVillage: ATTACKER,
        warVillages: [ATTACKER, DEFENDER],
        p1Village: ATTACKER,
        p2Village: DEFENDER,
        warStartedAt: WAR_START,
        budgetSpent: 0,
        ...over,
    };
}

describe('validateWarBattle — the happy path', () => {
    it('accepts the winner reporting a finished cross-village battle', () => {
        const r = validateWarBattle(args());
        assert.equal(r.ok, true);
        assert.equal(r.ok && r.winnerName, 'aria');
        assert.equal(r.ok && r.loserName, 'kell');
        assert.equal(r.ok && r.budgetRemaining, WAR_BATTLE_DAMAGE_BUDGET);
    });

    it('accepts a p2 winner reported by p2', () => {
        const r = validateWarBattle(args({
            battle: battle({ winner: 'p2' }),
            actorName: 'kell',
            actorVillage: DEFENDER,
        }));
        assert.equal(r.ok, true);
        assert.equal(r.ok && r.winnerName, 'kell');
    });

    it('is case- and whitespace-insensitive on names', () => {
        assert.equal(validateWarBattle(args({ actorName: '  ARIA ' })).ok, true);
    });
});

describe('validateWarBattle — the exploit this closes', () => {
    it('refuses damage with NO battle at all (the drain-a-village-in-a-minute path)', () => {
        const r = validateWarBattle(args({ battle: null }));
        assert.equal(r.ok, false);
        assert.equal(!r.ok && r.reason, 'battle-not-found');
    });

    it('refuses a battle that has not finished', () => {
        const r = validateWarBattle(args({ battle: battle({ status: 'active' }) }));
        assert.equal(!r.ok && r.reason, 'battle-unfinished');
    });

    it('refuses a finished battle without a sanctioned reward authority', () => {
        const missing = validateWarBattle(args({
            battle: battle({ rewardAuthority: undefined }),
        }));
        assert.equal(!missing.ok && missing.reason, 'battle-unsanctioned');

        const forged = validateWarBattle(args({
            battle: battle({ rewardAuthority: 'forged' }),
        }));
        assert.equal(!forged.ok && forged.reason, 'battle-unsanctioned');
    });

    it('accepts exactly the sanctioned reward-authority set', () => {
        for (const rewardAuthority of ['challenge', 'clan-war', 'ranked', 'world', 'admin'] as const) {
            const r = validateWarBattle(args({ battle: battle({ rewardAuthority }) }));
            assert.equal(r.ok, true, rewardAuthority);
        }
    });

    it('refuses a battle unless both fighters joined it', () => {
        for (const joined of [undefined, { p1: false, p2: true }, { p1: true, p2: false }]) {
            const r = validateWarBattle(args({ battle: battle({ joined }) }));
            assert.equal(!r.ok && r.reason, 'battle-unjoined');
        }
    });

    it('refuses a draw', () => {
        const r = validateWarBattle(args({ battle: battle({ winner: 'draw' }) }));
        assert.equal(!r.ok && r.reason, 'battle-drawn');
    });

    it('refuses a non-participant piggybacking on someone else’s battle', () => {
        const r = validateWarBattle(args({ actorName: 'stranger' }));
        assert.equal(!r.ok && r.reason, 'not-a-participant');
    });

    it('refuses the LOSER trying to bank damage against the winner', () => {
        // kell lost (winner is p1/aria) but reports from the Frostfang side.
        const r = validateWarBattle(args({ actorName: 'kell', actorVillage: DEFENDER }));
        assert.equal(!r.ok && r.reason, 'loser-cannot-deal-damage');
    });

    it('refuses a same-village spar recycled as war damage', () => {
        const r = validateWarBattle(args({ p2Village: ATTACKER }));
        assert.equal(!r.ok && r.reason, 'not-a-cross-village-battle');
    });

    it('refuses a battle against a village not in this war', () => {
        const r = validateWarBattle(args({ p2Village: 'Stormveil Village' }));
        assert.equal(!r.ok && r.reason, 'not-a-cross-village-battle');
    });

    it('refuses a battle fought before the war opened', () => {
        const r = validateWarBattle(args({ battle: battle({ createdAt: WAR_START - 1 }) }));
        assert.equal(!r.ok && r.reason, 'battle-predates-war');
    });

    it('refuses missing, zero, non-finite, fractional, or unsafe battle timestamps', () => {
        const timestamps = [
            undefined,
            0,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            WAR_START + 0.5,
            Number.MAX_SAFE_INTEGER + 1,
        ];
        for (const createdAt of timestamps) {
            const r = validateWarBattle(args({ battle: battle({ createdAt }) }));
            assert.equal(!r.ok && r.reason, 'battle-invalid-timestamp', String(createdAt));
        }
    });

    it('refuses an invalid war start instead of authorizing against it', () => {
        for (const warStartedAt of [0, Number.NaN, Number.POSITIVE_INFINITY, WAR_START + 0.5]) {
            const r = validateWarBattle(args({ warStartedAt }));
            assert.equal(!r.ok && r.reason, 'battle-invalid-timestamp', String(warStartedAt));
        }
    });

    it('refuses missing, malformed, pre-creation, or future terminal timestamps', () => {
        const invalid = [
            undefined,
            0,
            Number.NaN,
            Number.POSITIVE_INFINITY,
            WAR_START + 4_999,
            Date.now() + 61_000,
        ];
        for (const endedAt of invalid) {
            const r = validateWarBattle(args({ battle: battle({ endedAt }), validationNow: Date.now() }));
            assert.equal(!r.ok && r.reason, 'battle-invalid-terminal-timestamp', String(endedAt));
        }
    });

    it('refuses a battle whose damage budget is already spent (replay)', () => {
        const r = validateWarBattle(args({ budgetSpent: WAR_BATTLE_DAMAGE_BUDGET }));
        assert.equal(!r.ok && r.reason, 'battle-budget-spent');
        assert.equal(!r.ok && validateWarBattle(args({ budgetSpent: WAR_BATTLE_DAMAGE_BUDGET + 999 })).ok, false);
    });

    it('reports the remaining budget so one battle cannot fund a whole war', () => {
        const r = validateWarBattle(args({ budgetSpent: 250 }));
        assert.equal(r.ok, true);
        assert.equal(r.ok && r.budgetRemaining, WAR_BATTLE_DAMAGE_BUDGET - 250);
    });

    it('leaves headroom for a full capture raid, but far less than a whole war', () => {
        // One battle must cover an honest capture raid (~250 across two writes)...
        assert.ok(WAR_BATTLE_DAMAGE_BUDGET >= 250, 'honest play is never refused');
        // ...while a 5000-HP village still costs many real wins.
        assert.ok(5000 / WAR_BATTLE_DAMAGE_BUDGET >= 12, 'one win cannot stand in for a war');
    });

    it('refuses a self-fight (same name on both sides)', () => {
        const r = validateWarBattle(args({ battle: battle({ p2: { name: 'aria' } }) }));
        assert.equal(!r.ok && r.reason, 'not-a-two-fighter-battle');
    });

    it('refuses a battle missing a fighter', () => {
        const r = validateWarBattle(args({ battle: battle({ p2: {} }) }));
        assert.equal(!r.ok && r.reason, 'not-a-two-fighter-battle');
    });

    it('every decline reason has a player-facing message', () => {
        const reasons = [
            'missing-battle-id', 'battle-not-found', 'battle-unfinished', 'battle-drawn',
            'battle-unsanctioned', 'battle-unjoined', 'battle-invalid-timestamp', 'battle-invalid-terminal-timestamp',
            'not-a-two-fighter-battle', 'not-a-participant', 'not-a-cross-village-battle',
            'loser-cannot-deal-damage', 'battle-predates-war', 'battle-budget-spent',
        ] as const;
        for (const reason of reasons) {
            const msg = warBattleDeclineMessage(reason);
            assert.ok(msg.length > 10, `${reason} has a real message`);
        }
    });
});

describe('receipt keys', () => {
    it('scopes a spent battle to its war, so the same fight cannot cross wars', () => {
        assert.notEqual(warBattleReceiptKey('war-a', 'b1'), warBattleReceiptKey('war-b', 'b1'));
        assert.equal(warBattleReceiptKey('war-a', 'b1'), 'war:battle:war-a:b1');
    });
    it('namespaces mission tokens', () => {
        assert.equal(warMissionTokenKey('t1'), 'war:mission-token:t1');
    });

    it('recognizes a row-embedded replay independently of a recomputed payload', () => {
        const receipts = stampEmbeddedWarBattleReplay(undefined, 'battle-1', ' Aria ');
        assert.equal(Object.prototype.hasOwnProperty.call(receipts, 'battle-1'), false, 'new stamps do not expose raw battle ids');
        assert.equal(Object.values(receipts).includes('aria'), false, 'new stamps do not expose actor names');
        assert.equal(embeddedWarBattleReplay(receipts, 'battle-1', 'ARIA'), true);
        assert.equal(embeddedWarBattleReplay(receipts, 'battle-1', 'kell'), false);
        assert.equal(embeddedWarBattleReplay(receipts, 'battle-2', 'aria'), false);
    });

    it('stamps another battle without losing prior atomic replay authority', () => {
        const first = stampEmbeddedWarBattleReplay(undefined, 'battle-1', 'aria');
        const second = stampEmbeddedWarBattleReplay(first, 'battle-2', 'kell');
        assert.equal(Object.keys(second).length, 2);
        assert.equal(embeddedWarBattleReplay(second, 'battle-1', 'aria'), true);
        assert.equal(embeddedWarBattleReplay(second, 'battle-2', 'kell'), true);
    });

    it('recognizes legacy raw receipts read-only while all new stamps use v2 tokens', () => {
        const legacy = { 'battle-old': 'aria' };
        assert.equal(embeddedWarBattleReplay(legacy, 'battle-old', 'ARIA'), true);
        const replay = stampEmbeddedWarBattleReplay(legacy, 'battle-old', 'aria');
        assert.deepEqual(replay, legacy, 'an exact legacy replay does not grow the row');

        const migrated = stampEmbeddedWarBattleReplay(legacy, 'battle-new', 'kell');
        assert.equal(migrated['battle-old'], 'aria', 'legacy authority remains readable');
        assert.equal(Object.prototype.hasOwnProperty.call(migrated, 'battle-new'), false);
        assert.equal(embeddedWarBattleReplay(migrated, 'battle-new', 'kell'), true);
    });

    it('never evicts receipts and fails closed when the bounded ledger is full', () => {
        let receipts = stampEmbeddedWarBattleReplay(undefined, 'battle-0', 'aria');
        for (let i = 1; i < WAR_BATTLE_RECEIPT_LIMIT; i += 1) {
            receipts = stampEmbeddedWarBattleReplay(receipts, `battle-${i}`, i % 2 ? 'aria' : 'kell');
        }
        assert.equal(Object.keys(receipts).length, WAR_BATTLE_RECEIPT_LIMIT);
        assert.equal(embeddedWarBattleReplay(receipts, 'battle-0', 'aria'), true);
        assert.throws(
            () => stampEmbeddedWarBattleReplay(receipts, 'battle-over-limit', 'aria'),
            WarBattleReceiptLedgerFullError,
        );
        assert.equal(embeddedWarBattleReplay(receipts, 'battle-0', 'aria'), true, 'the oldest receipt was not evicted');
        assert.doesNotThrow(
            () => stampEmbeddedWarBattleReplay(receipts, 'battle-0', 'aria'),
            'known replay remains idempotent at cap',
        );
    });

    it('fails closed on garbage maps and an exact v2 token with an invalid authority value', () => {
        for (const malformed of [[], 'garbage', { '': 'aria' }, { battle: '' }]) {
            assert.throws(
                () => embeddedWarBattleReplay(malformed as never, 'battle', 'aria'),
                WarBattleReceiptLedgerMalformedError,
            );
        }
        const valid = stampEmbeddedWarBattleReplay(undefined, 'battle-exact-token', 'aria');
        const token = Object.keys(valid)[0]!;
        const corrupt = { ...valid, [token]: 'forged-outcome' };
        assert.throws(
            () => embeddedWarBattleReplay(corrupt, 'battle-exact-token', 'aria'),
            WarBattleReceiptLedgerMalformedError,
        );
        assert.throws(
            () => stampEmbeddedWarBattleReplay(corrupt, 'battle-exact-token', 'aria'),
            WarBattleReceiptLedgerMalformedError,
        );
    });
});

describe('war-mission tokens', () => {
    const NOW = 5_000;
    const good = { playerName: 'aria', village: ATTACKER, damage: 30, expiresAt: NOW + 60_000 };

    it('normalizes a well-formed token', () => {
        assert.deepEqual(normalizeWarMissionToken(good), good);
    });

    it('rejects malformed tokens', () => {
        assert.equal(normalizeWarMissionToken(null), null);
        assert.equal(normalizeWarMissionToken({ ...good, playerName: '' }), null);
        assert.equal(normalizeWarMissionToken({ ...good, village: '  ' }), null);
        assert.equal(normalizeWarMissionToken({ ...good, damage: 0 }), null);
        assert.equal(normalizeWarMissionToken({ ...good, damage: -5 }), null);
    });

    it('authorizes exactly the sealed damage, for the right player and village', () => {
        const base = { actorName: 'aria', actorVillage: ATTACKER, now: NOW };
        assert.equal(warMissionTokenAuthorizes(good, { ...base, claimedDamage: 30 }), true);
        assert.equal(warMissionTokenAuthorizes(good, { ...base, claimedDamage: 29 }), true);
        assert.equal(warMissionTokenAuthorizes(good, { ...base, claimedDamage: 31 }), false, 'cannot inflate past the seal');
        assert.equal(warMissionTokenAuthorizes(good, { ...base, claimedDamage: 0 }), false);
    });

    it('refuses another player’s token', () => {
        assert.equal(warMissionTokenAuthorizes(good, {
            actorName: 'kell', actorVillage: ATTACKER, claimedDamage: 30, now: NOW,
        }), false);
    });

    it('refuses a token spent from a different village', () => {
        assert.equal(warMissionTokenAuthorizes(good, {
            actorName: 'aria', actorVillage: DEFENDER, claimedDamage: 30, now: NOW,
        }), false);
    });

    it('refuses an expired token', () => {
        assert.equal(warMissionTokenAuthorizes(good, {
            actorName: 'aria', actorVillage: ATTACKER, claimedDamage: 30, now: good.expiresAt + 1,
        }), false);
    });

    it('refuses a missing token', () => {
        assert.equal(warMissionTokenAuthorizes(null, {
            actorName: 'aria', actorVillage: ATTACKER, claimedDamage: 30, now: NOW,
        }), false);
    });
});

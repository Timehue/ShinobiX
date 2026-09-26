import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, test } from 'node:test';
import { economyIntentSettled, pendingEconomyIntent, readPendingEconomyIntent } from './economy-request-intent';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
let sequence = 0;

beforeEach(() => {
    const entries = new Map<string, string>();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => entries.get(key) ?? null,
        setItem: (key: string, value: string) => { entries.set(key, value); },
        removeItem: (key: string) => { entries.delete(key); },
    } });
});

afterEach(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
});

test('an unconfirmed action keeps its id across a manual retry and a storage outage', () => {
    const parts = [`pilgrim${++sequence}`, 'heartwood', 1_000];
    assert.equal(readPendingEconomyIntent('shrine-offer', parts), null);
    const original = pendingEconomyIntent('shrine-offer', parts);
    assert.match(original.requestId, /^[0-9a-f-]{36}$/i, 'within the server bound (16-80 chars, [A-Za-z0-9_-])');
    assert.equal(pendingEconomyIntent('shrine-offer', parts).requestId, original.requestId);
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('Storage unavailable'); } });
    assert.equal(pendingEconomyIntent('shrine-offer', parts).requestId, original.requestId);
    original.complete();
    assert.equal(readPendingEconomyIntent('shrine-offer', parts), null);
});

test('a different action, scope or amount gets its own id; a late answer cannot clear a newer intent', () => {
    const player = `donor${++sequence}`;
    const first = pendingEconomyIntent('village-donate', [player, 'leaf', 'currency', 'ryo', 500]);
    assert.notEqual(pendingEconomyIntent('village-donate', [player, 'leaf', 'currency', 'ryo', 501]).requestId, first.requestId);
    assert.notEqual(pendingEconomyIntent('clan-donate', [player, 'leaf', 'currency', 'ryo', 500]).requestId, first.requestId);
    first.complete();
    const second = pendingEconomyIntent('village-donate', [player, 'leaf', 'currency', 'ryo', 500]);
    assert.notEqual(second.requestId, first.requestId);
    first.complete();
    assert.equal(readPendingEconomyIntent('village-donate', [player, 'leaf', 'currency', 'ryo', 500])?.requestId, second.requestId);
    second.complete();
});

test('only a final answer releases the id', () => {
    for (const status of [200, 201, 400, 403, 404, 422]) assert.equal(economyIntentSettled(status, {}), true, String(status));
    assert.equal(economyIntentSettled(409, { error: 'reused' }), true, 'a conflicting reuse is final');
    // Ambiguous: the first attempt may have been charged.
    for (const status of [0, 401, 408, 429, 500, 502, 503, 504]) assert.equal(economyIntentSettled(status, {}), false, String(status));
    assert.equal(economyIntentSettled(503, { refunded: true }), false, 'a refunded attempt is retried with the same id');
    assert.equal(economyIntentSettled(409, { reconcile: true }), false, 'an admin-pending one keeps its id so a second press repeats it');
});

test('every retry-safe economy call sends its retained id and settles it only on a final answer', () => {
    const wrappers = [
        ['shinobij.client/src/lib/sector-traces.ts', 'export async function offerAtShrine', '"shrine-offer"'],
        ['shinobij.client/src/lib/pvp-bounty.ts', 'export async function placeBounty', '"bounty-place"'],
        ['shinobij.client/src/lib/player-api.ts', 'export async function postVillageTreasuryDonation', '"village-donate"'],
        ['shinobij.client/src/lib/player-api.ts', 'export async function postClanTreasuryDonation', '"clan-donate"'],
        ['shinobij.client/src/lib/clan-seal-pool-api.ts', 'export async function postSealDonation', '"seal-donate"'],
        ['shinobij.client/src/lib/clan-seal-pool-api.ts', 'export async function postSealDistribution', '"seal-distribute"'],
        ['shinobij.client/src/lib/player-api.ts', 'export async function postHollowGateUnlock', '"hollow-gate-unlock"'],
        ['shinobij.client/src/lib/player-api.ts', 'export async function postKageChallengeDeclare', '"kage-challenge-declare"'],
        ['shinobij.client/src/lib/clan-war-api.ts', 'export async function cwDeclareWar', '"clan-war-declare"'],
    ] as const;
    for (const [file, start, scope] of wrappers) {
        const source = readFileSync(file, 'utf8');
        const at = source.indexOf(start);
        assert.ok(at >= 0, `${start} must stay discoverable in ${file}`);
        const body = source.slice(at, source.indexOf('\n}\n', at));
        assert.match(body, new RegExp(`pendingEconomyIntent\\(${scope}`), `${start} must retain one id per action`);
        assert.match(body, /requestId: intent\.requestId/, `${start} must send it`);
        assert.match(body, /if \(economyIntentSettled\(res\.status, data\)\) intent\.complete\(\)/, `${start} must release it only on a final answer`);
    }
    const guards = [
        ['shinobij.client/src/components/SectorTraces.tsx', /amount > playerRyo && !hasPendingShrineOffering\(/],
        ['shinobij.client/src/components/BountyBoardPanel.tsx', /< bountyAmount && !hasPendingBountyPlacement\(/],
        ['shinobij.client/src/screens/TownHall.tsx', /character\.ryo < amount && !hasPendingTreasuryDonation\("village"/],
        ['shinobij.client/src/screens/ClanHall.tsx', /character\.ryo < amount && !hasPendingTreasuryDonation\("clan"/],
        ['shinobij.client/src/screens/ClanSealPool.tsx', /donateAmount > remainingToday && !donationPending/],
        ['shinobij.client/src/screens/ClanSealPool.tsx', /< distributeAmount && !distributionPending/],
        ['shinobij.client/src/screens/TownHall.tsx', /< cost && !hollowGateUnlockPending/],
        ['shinobij.client/src/screens/TownHall.tsx', /< HOLLOW_GATE_UNLOCK_COST && !hollowGateUnlockPending/],
    ] as const;
    for (const [file, pattern] of guards) {
        assert.match(readFileSync(file, 'utf8'), pattern, `${file} must not refuse the retry of a pending charge locally`);
    }
});

import assert from 'node:assert/strict';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let memory: typeof import('./_storage.js')._makeMemoryKv;
let eligible: typeof import('./_sector-war-purse-eligibility.js').sectorWarPurseEligible;
let war: typeof import('./_sector-war.js');
let store: typeof import('./_sector-war-store.js');
let purse: typeof import('./war/_sector-purse.js');
before(async () => {
    ({ _makeMemoryKv: memory } = await import('./_storage.js'));
    ({ sectorWarPurseEligible: eligible } = await import('./_sector-war-purse-eligibility.js'));
    war = await import('./_sector-war.js');
    store = await import('./_sector-war-store.js');
    purse = await import('./war/_sector-purse.js');
});
const NOW = Date.UTC(2026, 9, 28, 12);
const AGE = 72 * 60 * 60 * 1000;
const names = { winnerName: 'winner', loserName: 'loser', endedAt: NOW };
async function saves(kv: ReturnType<typeof memory>, winnerLevel = 20, loserLevel = 20, createdAt: number | undefined = NOW - 1) {
    await kv.set('save:winner', { character: { level: winnerLevel } });
    await kv.set('save:loser', { character: { level: loserLevel, createdAt } });
}
test('sector purse uses established-account and one-sided level-gap boundaries', async () => {
    const kv = memory();
    for (const [winnerLevel, loserLevel, createdAt, expected] of [
        [20, 19, NOW - AGE + 1, false], [20, 19, NOW - AGE, true],
        [20, 20, NOW - 1, true], [40, 20, NOW - 1, true],
        [41, 20, NOW - AGE, false], [1, 100, NOW - 1, true],
        [19, 19, undefined, true], // Existing accounts without createdAt keep the existing rule.
    ] as const) {
        await saves(kv, winnerLevel, loserLevel, createdAt);
        // Explicit undefined above must represent a legacy field, not the helper's default.
        if (createdAt === undefined) await kv.set('save:loser', { character: { level: loserLevel } });
        assert.equal(await eligible(names, kv), expected, JSON.stringify({ winnerLevel, loserLevel, createdAt }));
    }
    await saves(kv, 20, 19, NOW - AGE + 1);
    assert.equal(await eligible({ ...names, endedAt: NOW + 1 }, kv), true);
    assert.equal(await eligible(names, kv), false, 'retry time cannot age an opponent past the battle-end gate');
});
test('PvP sealed levels take precedence over later account progression', async () => {
    const kv = memory();
    await saves(kv, 100, 100);
    assert.equal(await eligible({ ...names, winnerLevel: 20, loserLevel: 19 }, kv), false);
    await saves(kv, 1, 1);
    assert.equal(await eligible({ ...names, winnerLevel: 40, loserLevel: 20 }, kv), true);
});
test('unavailable account evidence throws rather than becoming eligibility', async () => {
    const kv = memory();
    await assert.rejects(eligible(names, kv), /account-evidence-unavailable/);
    await assert.rejects(eligible(names, { get: async () => { throw new Error('read-outage'); } }), /account-evidence-unavailable/);
    assert.equal(await eligible({ ...names, loserName: 'WINNER' }, kv), false);
});
test('eligibility commits with the score, survives externalization and freezes on replay', async () => {
    const kv = memory();
    await saves(kv, 20, 19);
    const original = war.newSectorWarSession({ sector: 23, attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village', winCondition: 'combat', now: NOW - 1000 });
    await kv.set(war.sectorWarKey(original.id), original);
    const commit = () => store.commitSectorWarBattle({
        contestId: original.id, battleId: 'purse-proof', store: kv, lock: (_key, fn) => fn(), now: () => NOW,
        decide: async contest => ({ kind: 'score', outcome: war.applySectorWarBattle(contest, true, { now: NOW, by: 'winner', roleSwing: 5 }),
            attackerWon: true, by: 'winner', at: NOW, purseEligible: await eligible(names, kv) }),
    });
    await kv.del('save:loser');
    await assert.rejects(commit(), /account-evidence-unavailable/);
    assert.equal((await kv.get<typeof original>(war.sectorWarKey(original.id)))!.attackerPoints, 0);
    await saves(kv, 20, 19);
    const applied = await commit();
    assert.equal(applied.status, 'applied');
    if (applied.status !== 'applied') throw Error('expected applied');
    assert.equal(applied.receipt.purseEligible, false);
    assert.equal(applied.session.attackerPoints, applied.receipt.points);
    assert.ok(applied.receipt.points > 0, 'territory still scores');
    const normalized = war.normalizeSectorWarSession(applied.session)!;
    assert.equal(normalized.appliedBattles![0].purseEligible, false);
    const external = await store.listSectorWarInstanceReceipts(normalized, kv);
    assert.equal(external[0].purseEligible, false);
    assert.deepEqual(purse.buildSectorWarPurseLedger({ ...normalized, flipped: true }, external)!.entries, {});
    await saves(kv, 20, 20);
    const replayed = await commit();
    assert.equal(replayed.status, 'applied');
    if (replayed.status !== 'applied') throw Error('expected replay');
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.receipt.purseEligible, false, 'a later level-up cannot rewrite a committed decision');
    assert.equal(replayed.session.attackerPoints, applied.session.attackerPoints);
});
test('a deferred external copy retains the currency gate in the atomic pending receipt', async () => {
    const kv = memory();
    const original = war.newSectorWarSession({ sector: 23, attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village', winCondition: 'combat', now: NOW - 1000 });
    await kv.set(war.sectorWarKey(original.id), original);
    const failingCopy = { ...kv, compareSet: async (...args: Parameters<typeof kv.compareSet>) => {
        if (args[0].startsWith(war.SECTOR_WAR_BATTLE_RECEIPT_PREFIX)) throw new Error('external copy unavailable');
        return kv.compareSet(...args);
    } };
    const first = await store.commitSectorWarBattle({
        contestId: original.id, battleId: 'deferred', store: failingCopy, lock: (_key, fn) => fn(), now: () => NOW,
        decide: contest => ({ kind: 'score', outcome: war.applySectorWarBattle(contest, true, { now: NOW, by: 'winner', roleSwing: 5 }),
            attackerWon: true, by: 'winner', at: NOW, purseEligible: false }),
    });
    assert.equal(first.status, 'applied');
    if (first.status !== 'applied') throw Error('expected applied');
    const pending = war.normalizeSectorWarSession((await kv.get(war.sectorWarKey(original.id))) as never)!;
    assert.equal(pending.battleLedger!.pending[0].purseEligible, false);
    const replay = await store.commitSectorWarBattle({
        contestId: original.id, battleId: 'deferred', store: kv, lock: (_key, fn) => fn(), now: () => NOW,
        decide: () => { throw Error('a committed receipt must never be recomputed'); },
    });
    assert.equal(replay.status, 'applied');
    if (replay.status !== 'applied') throw Error('expected replay');
    assert.equal(replay.replayed, true);
    assert.equal(replay.receipt.purseEligible, false);
    assert.equal(replay.session.attackerPoints, first.session.attackerPoints);
    // Existing protocol drains pending copies on the next new battle (or
    // terminal drain), not on an already-committed battle's read-only replay.
    const following = await store.commitSectorWarBattle({
        contestId: original.id, battleId: 'following', store: kv, lock: (_key, fn) => fn(), now: () => NOW + 1,
        decide: contest => ({ kind: 'score', outcome: war.applySectorWarBattle(contest, true, { now: NOW + 1, by: 'winner', roleSwing: 5 }),
            attackerWon: true, by: 'winner', at: NOW + 1, purseEligible: true }),
    });
    assert.equal(following.status, 'applied');
    if (following.status !== 'applied') throw Error('expected following battle');
    assert.equal((await store.loadSectorWarExternalReceipt(following.session, 'deferred', kv))!.purseEligible, false);
    assert.equal((await store.loadSectorWarExternalReceipt(following.session, 'following', kv))!.purseEligible, true);
});

test('strict readers retain boolean evidence, reject malformed flags, and accept old receipts', () => {
    const session = war.newSectorWarSession({ sector: 23, attackerVillage: 'Moonshadow Village', defenderVillage: 'Frostfang Village', winCondition: 'combat', now: NOW - 1000 });
    const receipt = { battleId: 'old', attackerWon: true, points: 5, by: 'winner', at: NOW };
    for (const flag of [undefined, false, true]) {
        const r = { ...receipt, ...(flag === undefined ? {} : { purseEligible: flag }) };
        const external = war.sectorWarExternalBattleReceipt(session, r);
        assert.deepEqual(war.parseSectorWarExternalBattleReceipt(external)?.receipt, r);
        assert.equal(purse.sectorPurseWinWeight(r), flag === false ? 0 : 1);
    }
    const bad = war.sectorWarExternalBattleReceipt(session, { ...receipt, purseEligible: 'false' } as never);
    assert.equal(war.parseSectorWarExternalBattleReceipt(bad), null);
    assert.equal(purse.sectorPurseWinWeight({ ...receipt, garrison: true }), 0.5);
    assert.equal(purse.sectorPurseWinWeight({ ...receipt, battleId: 'merc:x' }), 0.25);
});

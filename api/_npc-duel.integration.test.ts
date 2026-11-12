import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import type { PvpSession } from './pvp/session.js';

// A Cinderhold NPC duel through the REAL handlers: world attack admission →
// session create (the NPC stamp is sealed) → the server's seat joins and plays
// the NPC's turns via /api/pvp/move → KO or tiebreak → both claims. Nothing in
// the PvP engine is stubbed; only the clock is mocked.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-duel-integration-session-secret-32chars';
process.env.DISABLE_COMBAT_RECEIPTS = '1';
let kv: typeof import('./_storage.js').kv;
let online: typeof import('./_realtime/online-store.js').onlineStore;
let token: typeof import('./_auth.js').issuePlayerToken;
let attack: typeof import('./player/attack.js').default;
let create: typeof import('./pvp/session.js').default;
let move: typeof import('./pvp/move.js').default;
let claim: typeof import('./pvp/claim-rewards.js').default;
let driver: typeof import('./_npc-duel-driver.js');
let seed: typeof import('./_npc-village-seed.js');
let roster: typeof import('../shared/npc-village-roster.js');
let aggression: typeof import('./_npc-village-aggression.js');

const SECTOR = 67;
before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore: online } = await import('./_realtime/online-store.js'));
    ({ issuePlayerToken: token } = await import('./_auth.js'));
    attack = (await import('./player/attack.js')).default as unknown as typeof attack;
    create = (await import('./pvp/session.js')).default as unknown as typeof create;
    move = (await import('./pvp/move.js')).default as unknown as typeof move;
    claim = (await import('./pvp/claim-rewards.js')).default as unknown as typeof claim;
    driver = await import('./_npc-duel-driver.js');
    seed = await import('./_npc-village-seed.js');
    roster = await import('../shared/npc-village-roster.js');
    aggression = await import('./_npc-village-aggression.js');
    driver.setNpcActionBeatForTest(0);
    await kv.set('npc-village:state', { baseLevel: 60, target: 60, sample: 30, computedAt: Date.now() });
    const seeded = await seed.seedNpcVillage();
    assert.deepEqual(seeded.failures, []);
});

let seq = 0;
async function post(handler: typeof create, name: string, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(value: Record<string, any>) { out.body = value; return res; }, end: () => res };
    const ip = `10.82.${Math.floor(++seq / 250)}.${seq % 250}`;
    await handler({ method: 'POST', body: { playerName: name, ...body }, query: {}, headers: { 'x-player-token': token(name), 'x-player-name': name, 'x-forwarded-for': ip }, socket: { remoteAddress: ip } } as never, res as never);
    return out;
}

async function seedHuman(name: string, level: number) {
    const character = { name, level, village: 'Frostfang Village', ryo: 0, unspentStats: 0, hp: 10000, maxHp: 10000,
        chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, stats: {}, equipment: {},
        inventory: [], itemStacks: [], equippedJutsuIds: [], jutsu: [], jutsuMastery: [] };
    await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: SECTOR, character });
    online.upsert({ name, sector: SECTOR, character });
}

async function startDuel(human: string, npc: (typeof roster.NPC_VILLAGE_ROSTER)[number]) {
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    await seedHuman(human, Number(npcSave.character.level));
    online.upsert({ name: npc.name, sector: SECTOR, character: npcSave.character });
    const admission = await post(attack, human, { targetName: npc.name, attacker: { name: human } });
    assert.equal(admission.status, 200, JSON.stringify(admission.body));
    const made = await post(create, human, { p1Character: { name: human }, p2Character: npcSave.character,
        baseRewards: true, rewardSector: SECTOR, useCurrentVitals: true, requireWorldCoLocation: true });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const session = made.body.session as PvpSession;
    assert.equal((await post(move, human, { battleId: session.battleId, role: 'p1', action: 'join', moveToken: 'join-p1' })).status, 200);
    // The server's seat joins on its own (the create kicks it; the sweep is the safety net).
    await driver.driveNpcDuel(session.battleId, 'p2');
    const joined = (await kv.get<PvpSession>(`pvp:${session.battleId}`))!;
    assert.equal(joined.joined?.p2, true, 'the NPC took its seat through the real join');
    return session;
}

test('a Cinderhold shinobi plays a whole PvP duel under the real rules and wins it', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 12, 0, 0) });
    t.after(() => mock.timers.reset());
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'elite')!;
    const human = 'npcduelvictim';
    const npcSave0 = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    const session = await startDuel(human, npc);
    // May pay, and spends no slot until the player wins (owner ruling 2026-11-11).
    assert.deepEqual(session.npcDuel, { version: 1, npc: npc.id, seat: 'p2', paid: true, payOnWin: true });
    const battleId = session.battleId;
    mock.timers.tick(10_000); // past the prefight countdown
    let npcActions = 0;
    for (let guard = 0; guard < 200; guard++) {
        const live = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        if (live.status === 'done') break;
        if (live.activePlayer === 'p1') {
            // The human only ever ends their turn: the NPC must win on its own.
            const ended = await post(move, human, { battleId, role: 'p1', action: 'wait', moveToken: `w${guard}` });
            assert.equal(ended.status, 200, JSON.stringify(ended.body));
        } else {
            const before = live.log.length;
            assert.equal(await driver.driveNpcDuel(battleId, 'p2'), 'acted');
            const after = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
            npcActions += after.log.slice(before).filter((line) => line.includes(npc.name) && !/ends? (the|their|his|her) turn|waits/i.test(line)).length;
        }
        mock.timers.tick(1_000);
    }
    const done = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
    assert.equal(done.status, 'done', `ended at round ${done.round}`);
    assert.equal(done.winner, 'p2', 'an idle opponent loses to the NPC');
    assert.ok(npcActions > 0, 'the NPC really attacked rather than passing');
    // The player LOST: no pay slot was spent (owner ruling 2026-11-11, "Only player wins").
    const duelMod = await import('./_npc-duel.js');
    assert.equal(await kv.get(duelMod.npcDuelDayKey(human, Date.now())), null, 'a loss spends no NPC pay slot');
    assert.equal(await duelMod.npcDuelPayAvailable(human, npc.id), true);
    // It fights with its kit like a player: pills, throws, smoke, its weapon.
    const { ITEM_CATALOG } = await import('./pvp/_item-catalog.js');
    const kitNames = Object.values((npcSave0.character.equipment ?? {}) as Record<string, string>)
        .map((id) => ITEM_CATALOG[id]?.name).filter((name): name is string => !!name);
    assert.ok(done.log.some((line) => kitNames.some((name) => line.startsWith(`${npc.name} uses ${name}`))),
        `the NPC used its kit or weapon (${kitNames.join(', ')})`);
    // The seat claims for the NPC, which retires its pending battle; it is never credited.
    assert.equal(await driver.driveNpcDuel(battleId, 'p2'), 'finished');
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!.character;
    assert.equal(npcSave.ryo, 0, 'the NPC is never paid');
    assert.ok(!npcSave.hospitalized, 'the NPC is never left in the Hospital');
    const record = await kv.get<Record<string, any>>(`npc-village:record:${npc.id}`);
    assert.equal(record?.rivals?.[human]?.wins, 1);
    assert.deepEqual(await driver.sweepNpcDuels(), 0, 'nothing is left to drive');
});

test('a player who walks away still loses on the clock: the seat enforces their deadline', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 18, 0, 0) });
    t.after(() => mock.timers.reset());
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'chunin')!;
    const session = await startDuel('npcduelquitter', npc);
    // The player never acts again; only the seat and the clock move the fight.
    mock.timers.tick(10_000); // past the prefight countdown
    for (let guard = 0; guard < 400; guard++) {
        const live = (await kv.get<PvpSession>(`pvp:${session.battleId}`))!;
        // Only the absent player's clock runs out; the seat answers at once.
        if (live.status === 'active' && live.activePlayer === 'p1') mock.timers.tick(54_000); // 45 s + 8 s grace
        if ((await driver.driveNpcDuel(session.battleId, 'p2')) === 'finished') break;
        mock.timers.tick(1_000);
    }
    const done = (await kv.get<PvpSession>(`pvp:${session.battleId}`))!;
    assert.equal(done.status, 'done');
    assert.equal(done.winner, 'p2');
});

test('the paid slot is spent only on a player WIN, once, atomically: first win per NPC per day, five a day', async (t) => {
    const duel = await import('./_npc-duel.js');
    const now = Date.UTC(2026, 10, 9, 20, 0, 0);
    mock.timers.enable({ apis: ['Date'], now });
    t.after(() => mock.timers.reset());
    const npcs = roster.NPC_VILLAGE_ROSTER.filter((n) => n.rank === 'genin');
    const player = 'slotkeeper';
    const seal = (battleId: string, npcName: string, who = player) => duel.sealNpcDuel(
        { battleId, rewardAuthority: 'world', p1: { name: who }, p2: { name: npcName } }, { sessionsEnabled: true });
    const dayRow = async () => Object.keys((await kv.get<{ npcs: Record<string, string> }>(duel.npcDuelDayKey(player, Date.now())))?.npcs ?? {});
    /** The finished duel as the terminal replay and the claim see it. */
    const finished = (battleId: string, npcName: string, stamp: Awaited<ReturnType<typeof seal>>, winner: 'p1' | 'p2', who = player) => ({
        battleId, status: 'done', winner, endedAt: Date.now(), rewardAuthority: 'world', joined: { p1: true, p2: true },
        p1: { name: who }, p2: { name: npcName }, npcDuel: stamp,
    });
    const first = await seal('pay-a', npcs[0]!.name);
    assert.equal(first?.paid, true);
    assert.equal(first?.payOnWin, true, 'a world duel may pay');
    assert.deepEqual(await dayRow(), [], 'sealing a duel spends no slot');
    // The same battle sealed again (a retried create) gets the same stamp.
    assert.deepEqual(await seal('pay-a', npcs[0]!.name), first);
    // Another duel with the same NPC moments later: it is still being published, so it is busy.
    await assert.rejects(() => seal('pay-b', npcs[0]!.name), /npc-duel-busy/);
    // A LOSS (the NPC won): no WIN slot is spent. Its loss credit is gated by
    // its own loss slot (settleNpcDuelLoss, spent by the loser's settlement).
    const lost = finished('pay-a', npcs[0]!.name, first, 'p2');
    assert.equal(await duel.settleNpcDuelWin(lost), null);
    assert.equal(duel.npcDuelLossSlotGated(lost), true);
    assert.deepEqual(await dayRow(), [], 'a loss spends no win slot');
    // The NPC STARTED this one (a war strike / hunt: the NPC is p1) and the player lost it: still nothing spent.
    const ambush = await duel.sealNpcDuel({ battleId: 'pay-ambush', rewardAuthority: 'world', p1: { name: npcs[6]!.name }, p2: { name: player } }, { sessionsEnabled: true });
    assert.equal(ambush?.payOnWin, true);
    assert.equal(await duel.settleNpcDuelWin({ ...finished('pay-ambush', npcs[6]!.name, ambush, 'p1'), p1: { name: npcs[6]!.name }, p2: { name: player } }), null);
    assert.deepEqual(await dayRow(), [], 'an ambush the player lost spends no slot');
    mock.timers.tick(duel.NPC_DUEL_PUBLISH_GRACE_MS + 1);
    // A WIN spends the slot, once: a replay (another reader, another process) gets the same verdict.
    const stampB = await seal('pay-b', npcs[0]!.name);
    const wonB = finished('pay-b', npcs[0]!.name, stampB, 'p1');
    assert.deepEqual(await duel.settleNpcDuelWin(wonB), { pays: true });
    assert.equal(duel.npcDuelPays(wonB), true, 'the first win over this NPC today pays');
    duel.forgetNpcDuelVerdictsForTest(); // a second process
    assert.equal(duel.npcDuelPays(wonB), false, 'a reader that has not settled the verdict pays nothing (fail closed)');
    assert.deepEqual(await duel.settleNpcDuelWin(wonB), { pays: true }, 'the stored verdict is read back, not spent again');
    assert.deepEqual(await dayRow(), [npcs[0]!.id]);
    // A second win over the same NPC the same day: no pay, and says why.
    mock.timers.tick(duel.NPC_DUEL_PUBLISH_GRACE_MS + 1);
    const wonC = finished('pay-c', npcs[0]!.name, await seal('pay-c', npcs[0]!.name), 'p1');
    assert.deepEqual(await duel.settleNpcDuelWin(wonC), { pays: false, reason: 'npc-repeat' });
    assert.equal(duel.npcDuelUnpaidReason(wonC), 'npc-repeat');
    for (const [i, npc] of npcs.slice(1, 5).entries()) {
        const id = `pay-d${i}`;
        assert.equal((await duel.settleNpcDuelWin(finished(id, npc.name, await seal(id, npc.name), 'p1')))?.pays, true);
    }
    assert.equal((await dayRow()).length, 5);
    const sixth = finished('pay-e', npcs[5]!.name, await seal('pay-e', npcs[5]!.name), 'p1');
    assert.deepEqual(await duel.settleNpcDuelWin(sixth), { pays: false, reason: 'npc-daily-cap' }, 'a sixth paid win the same day pays nothing');
    assert.equal(duel.npcDuelUnpaidReason(sixth), 'npc-daily-cap');

    // LOSSES have their own allowance (2026-11-11): the first loss to each NPC
    // a day, at most five, and a loss never touches the win row (nor a win the loss row).
    const lossRow = async () => Object.keys((await kv.get<{ npcs: Record<string, string> }>(duel.npcDuelDayKey(player, Date.now(), 'combat', 'loss')))?.npcs ?? {});
    assert.deepEqual(await lossRow(), [], 'five paid wins spent no loss slot');
    const loss = (id: string, npcName: string) => ({ ...finished(id, npcName, { version: 1, npc: roster.NPC_VILLAGE_ROSTER.find((n) => n.name === npcName)!.id, seat: 'p2', paid: true, payOnWin: true }, 'p2') });
    // npcs[0] already gave a paid WIN today; its first LOSS still pays.
    assert.deepEqual(await duel.settleNpcDuelLoss(loss('loss-a', npcs[0]!.name)), { pays: true }, 'a win never spends the loss slot');
    assert.deepEqual(await duel.settleNpcDuelLoss(loss('loss-b', npcs[0]!.name)), { pays: false, reason: 'npc-loss-repeat' });
    assert.equal(await duel.npcDuelLossUnpaidReason(loss('loss-b', npcs[0]!.name)), 'npc-loss-repeat');
    for (const [i, npc] of npcs.slice(1, 5).entries()) assert.equal((await duel.settleNpcDuelLoss(loss(`loss-c${i}`, npc.name)))?.pays, true);
    assert.deepEqual(await duel.settleNpcDuelLoss(loss('loss-d', npcs[5]!.name)), { pays: false, reason: 'npc-loss-daily-cap' }, 'a sixth NPC loss the same day pays nothing');
    assert.equal((await lossRow()).length, 5);
    assert.equal((await dayRow()).length, 5, 'and the win row is untouched by losses');
    assert.equal(await duel.settleNpcDuelLoss(wonB), null, 'a win is no loss');
    // Anything but a world attack (a spar, a challenge, an admin-made duel) is refused outright, and spends nothing.
    await assert.rejects(() => duel.sealNpcDuel({ battleId: 'pay-spar', p1: { name: 'sparrer' }, p2: { name: npcs[6]!.name } }, { sessionsEnabled: true }), /npc-duel-open-world-only/);
    await assert.rejects(() => duel.sealNpcDuel({ battleId: 'pay-spar', rewardAuthority: 'admin', p1: { name: 'sparrer' }, p2: { name: npcs[6]!.name } }, { sessionsEnabled: true }), /npc-duel-open-world-only/);
    assert.equal(await duel.npcDuelPayAvailable('sparrer', npcs[6]!.id), true);
    // The kill switch refuses the duel outright.
    process.env.DISABLE_NPC_VILLAGE = '1';
    try { await assert.rejects(() => seal('pay-off', npcs[7]!.name, 'other'), /npc-duel-unavailable/); }
    finally { delete process.env.DISABLE_NPC_VILLAGE; }
    for (const id of ['pay-a', 'pay-b', 'pay-c', 'pay-d0', 'pay-d1', 'pay-d2', 'pay-d3', 'pay-e', 'pay-ambush']) await duel.forgetNpcDuel(id);
});

test('a second player attacking an NPC mid-duel is refused, and keeps no pending battle', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 22, 0, 0) });
    t.after(() => mock.timers.reset());
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'commander')!;
    const first = await startDuel('npcduelfirst', npc);
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    await seedHuman('npcduelsecond', Number(npcSave.character.level));
    online.clearPendingAttacker(npc.name);
    online.setInBattle(npc.name, false); // presence lag: only the seal can know
    const made = await post(create, 'npcduelsecond', { p1Character: { name: 'npcduelsecond' }, p2Character: npcSave.character,
        baseRewards: true, rewardSector: SECTOR, useCurrentVitals: true, requireWorldCoLocation: true });
    assert.equal(made.status, 409, JSON.stringify(made.body));
    assert.match(String(made.body.error), /already in a fight/);
    const { loadPvpPendingSessionPointer } = await import('./pvp/_pending-session.js');
    assert.equal(await loadPvpPendingSessionPointer(kv, 'npcduelsecond'), null, 'the refused create left no pending battle');
    const duel = await import('./_npc-duel.js');
    await duel.forgetNpcDuel(first.battleId);
    online.remove('npcduelfirst'); online.remove('npcduelsecond');
});

test('an attacked NPC is held where it stands from the attack until its seat joins; a second attacker meanwhile is refused as a player target refuses one', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 23, 0, 0) });
    t.after(() => mock.timers.reset());
    const holds = await import('./_npc-attack-hold.js');
    const duel = await import('./_npc-duel.js');
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'elite')!;
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    await seedHuman('npcholdfirst', Number(npcSave.character.level));
    await seedHuman('npcholdsecond', Number(npcSave.character.level));
    online.upsert({ name: npc.name, sector: SECTOR, character: npcSave.character });
    assert.deepEqual(holds.npcPins(npc.id), [], 'free before anyone attacks');
    const admitted = await post(attack, 'npcholdfirst', { targetName: npc.name, attacker: { name: 'npcholdfirst' } });
    assert.equal(admitted.status, 200, JSON.stringify(admitted.body));
    assert.deepEqual(holds.npcPins(npc.id), ['attack:npcholdfirst'], 'the attack pins it at once');
    assert.equal(online.get(npc.name)!.pendingAttacker ?? null, null, 'still no attack flag (repeated attacks cannot hold it out of reach)');
    const second = await post(attack, 'npcholdsecond', { targetName: npc.name, attacker: { name: 'npcholdsecond' } });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'Target is already engaged in combat.', 'the words a pending attacker on a player gives');
    assert.equal((await post(attack, 'npcholdfirst', { targetName: npc.name, attacker: { name: 'npcholdfirst' } })).status, 200, 'its own attacker may press Attack again');
    const made = await post(create, 'npcholdfirst', { p1Character: { name: 'npcholdfirst' }, p2Character: npcSave.character,
        baseRewards: true, rewardSector: SECTOR, useCurrentVitals: true, requireWorldCoLocation: true });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const battleId = String(made.body.battleId);
    assert.deepEqual(holds.npcPins(npc.id), [`duel:${battleId}`], 'the sealed duel holds it until its seat joins');
    assert.equal(online.get(npc.name)!.inBattle ?? false, false, 'its seat has not joined yet: only the hold keeps it still');
    // Every pin lapses on its own: a lost release costs seconds, never a stuck NPC.
    mock.timers.tick(holds.NPC_DUEL_HOLD_MS + 1);
    assert.deepEqual(holds.npcPins(npc.id), []);
    holds.pinNpc(npc.id, `duel:${battleId}`, Date.now() + holds.NPC_DUEL_HOLD_MS);
    await duel.forgetNpcDuel(battleId);
    assert.deepEqual(holds.npcPins(npc.id), [], 'the duel ending frees it');
    online.remove('npcholdfirst'); online.remove('npcholdsecond');
});

test('an admin cannot take over an NPC mid-duel, and a duel begun under control never pays', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 21, 0, 0) });
    t.after(() => mock.timers.reset());
    process.env.ADMIN_PASSWORD = 'npc-duel-admin';
    const possess = (await import('./admin/npc-possess.js')).default as unknown as typeof create;
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'genin' && n.id !== 'x')!;
    const session = await startDuel('npcduelwitness', npc);
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(v: Record<string, any>) { out.body = v; return res; }, end: () => res };
    await possess({ method: 'POST', body: { npc: npc.id, action: 'take' }, query: {}, headers: { 'x-admin-password': 'npc-duel-admin' }, socket: { remoteAddress: '10.83.0.1' } } as never, res as never);
    assert.equal(out.status, 409, JSON.stringify(out.body));
    assert.match(String(out.body.error), /in a duel/);
    assert.equal(session.npcDuel?.version, 1);
    // A duel sealed while the NPC is controlled is stamped unpaid, and
    // `controlled`: it still scores a sector war (pvpSessionMayScoreWar).
    const duel = await import('./_npc-duel.js');
    const { npcPossessKey } = await import('./_npc-possession.js');
    const other = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'jonin' && n.id !== npc.id)!;
    await kv.set(npcPossessKey(other.id), { by: 'admin', at: Date.now(), expiresAt: Date.now() + 60_000 });
    const stamp = await duel.sealNpcDuel({ battleId: 'controlled', rewardAuthority: 'world', p1: { name: 'anyone' }, p2: { name: other.name } }, { sessionsEnabled: true });
    assert.deepEqual(stamp, { version: 1, npc: other.id, seat: 'p2', paid: false, controlled: true });
    await kv.del(npcPossessKey(other.id));
    await duel.forgetNpcDuel('controlled');
    await duel.forgetNpcDuel(session.battleId);
    online.remove('npcduelwitness');
});

test('beating one pays the normal PvP purse once a day per NPC, and raises aggression', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 15, 0, 0) });
    t.after(() => mock.timers.reset());
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'jonin')!;
    const human = 'npcduelhero';
    for (const expectPaid of [true, false]) {
        const session = await startDuel(human, npc);
        // Both may pay when sealed: the slot is spent by the WIN, so the second win is the one refused.
        assert.equal(session.npcDuel?.payOnWin, true);
        const battleId = session.battleId;
        mock.timers.tick(61_000); // a full fight: past the 3-round, 60 s floor
        const live = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        await kv.set(`pvp:${battleId}`, { ...live, round: 4, turnStartedAt: Date.now(), lastMoveAt: Date.now(),
            activePlayer: 'p1', roundOpener: 'p1', p1: { ...live.p1, pos: 62 }, p2: { ...live.p2, pos: 63, hp: 1 } });
        const ko = await post(move, human, { battleId, role: 'p1', action: 'basicAttack', moveToken: 'ko' });
        assert.equal(ko.body.winner, 'p1', JSON.stringify(ko.body));
        const won = await post(claim, human, { battleId, outcome: 'win', completionVersion: 1 });
        assert.equal(won.status, 200, JSON.stringify(won.body));
        const paid = Number(won.body.base?.reward?.ryo ?? 0);
        if (expectPaid) {
            assert.ok(paid > 0, 'the first win over this NPC today pays a normal purse');
            assert.equal(won.body.npcPay, undefined);
        } else {
            assert.equal(paid, 0, 'a second win over the same NPC today pays nothing');
            assert.equal(won.body.npcPay, 'npc-repeat', 'and the claim says why');
        }
        await post(claim, human, { battleId, outcome: 'win', completionVersion: 1, completionAck: true });
        assert.equal(await driver.driveNpcDuel(battleId, 'p2'), 'finished', 'the NPC claims its loss and frees its seat');
        // Beaten like a player: in the hospital, then under the Field Recovery
        // shield, so the winner cannot rematch it at full HP on the spot.
        const again = async () => post(attack, human, { targetName: npc.name, attacker: { name: human } });
        assert.match(String((await again()).body.error), /already been defeated/);
        mock.timers.tick(61_000);
        const shielded = await again();
        assert.equal(shielded.status, 409);
        assert.match(String(shielded.body.error), /recovering from a recent defeat/);
        mock.timers.tick(60_000);
        online.remove(human);
    }
    const { npcDuelDayKey } = await import('./_npc-duel.js');
    assert.equal(await kv.get(npcDuelDayKey(human, Date.now(), 'combat', 'loss')), null, 'a win never spends a loss slot');
    await new Promise((resolve) => setTimeout(resolve, 20)); // the fire-and-forget aggression write
    assert.ok(((await aggression.readNpcAggression()).byVillage['Frostfang Village'] ?? 0) > 0);
});

test('losing to one pays the normal PvP loss credit for the first loss to that NPC a day; a repeat says why; a walk-away loss pays nothing', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 10, 15, 0, 0) });
    t.after(() => mock.timers.reset());
    const duel = await import('./_npc-duel.js');
    const npc = roster.NPC_VILLAGE_ROSTER.filter((n) => n.rank === 'jonin')[1]!;
    const human = 'npcduelbrave';
    /** A full, engaged fight (round 4, past a minute, the NPC down to half) that the NPC finishes. */
    const loseOnce = async () => {
        const session = await startDuel(human, npc);
        const battleId = session.battleId;
        mock.timers.tick(61_000);
        const live = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        await kv.set(`pvp:${battleId}`, { ...live, round: 4, turnStartedAt: Date.now() - 20_000, lastMoveAt: Date.now(),
            activePlayer: 'p2', roundOpener: 'p1', p1: { ...live.p1, pos: 62, hp: 1 }, p2: { ...live.p2, pos: 63, hp: Math.max(1, Math.floor(Number(live.p2.hp) * 0.5)) } });
        for (let guard = 0; guard < 60; guard++) {
            const now = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
            if (now.status === 'done') break;
            if (now.activePlayer === 'p2') await driver.driveNpcDuel(battleId, 'p2');
            else await post(move, human, { battleId, role: 'p1', action: 'wait', moveToken: `lw${guard}` });
            mock.timers.tick(1_000);
        }
        const done = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        assert.equal(done.winner, 'p2', 'the NPC won it');
        const claimed = await post(claim, human, { battleId, outcome: 'loss', completionVersion: 1 });
        assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
        await post(claim, human, { battleId, outcome: 'loss', completionVersion: 1, completionAck: true });
        assert.equal(await driver.driveNpcDuel(battleId, 'p2'), 'finished');
        online.remove(human);
        mock.timers.tick(60_000);
        return claimed.body;
    };
    const first = await loseOnce();
    assert.ok(Number(first.base?.reward?.ryo ?? 0) > 0, `the first loss to this NPC today pays the normal loss credit: ${JSON.stringify(first.base)}`);
    assert.equal(first.npcPay, undefined);
    assert.deepEqual(Object.keys((await kv.get<{ npcs: Record<string, string> }>(duel.npcDuelDayKey(human, Date.now(), 'combat', 'loss')))!.npcs), [npc.id]);
    assert.equal(await kv.get(duel.npcDuelDayKey(human, Date.now())), null, 'a loss never spends a win slot');
    const second = await loseOnce();
    assert.equal(Number(second.base?.reward?.ryo ?? 0), 0, 'a second loss to the same NPC today pays nothing');
    assert.equal(second.npcPay, 'npc-loss-repeat', 'and the claim says why');

    // A walk-away loss (the player never fights back: AFK on the clock) fails
    // the existing engaged-loser gate: no loss pay, and no loss slot spent.
    const other = roster.NPC_VILLAGE_ROSTER.filter((n) => n.rank === 'jonin')[2]!;
    const session = await startDuel(human, other);
    const battleId = session.battleId;
    mock.timers.tick(10_000);
    for (let guard = 0; guard < 400; guard++) {
        const live = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        if (live.status === 'done') break;
        if (live.activePlayer === 'p1') mock.timers.tick(54_000); // 45 s + 8 s grace: the player's clock runs out
        await driver.driveNpcDuel(battleId, 'p2');
        mock.timers.tick(1_000);
    }
    const walked = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
    assert.equal(walked.winner, 'p2');
    const afk = await post(claim, human, { battleId, outcome: 'loss', completionVersion: 1 });
    assert.equal(afk.status, 200, JSON.stringify(afk.body));
    assert.equal(Number(afk.body.base?.reward?.ryo ?? 0), 0, 'a walk-away loss pays nothing');
    assert.equal(await duel.npcDuelPayAvailable(human, other.id, Date.now(), 'combat', 'loss'), true, 'and spends no loss slot');
    await post(claim, human, { battleId, outcome: 'loss', completionVersion: 1, completionAck: true });
    await driver.driveNpcDuel(battleId, 'p2');
    online.remove(human);
});

test('NPCs are reached only by the world attack: no spar, challenge, bounty, message or friend request', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 23, 0, 0) });
    t.after(() => mock.timers.reset());
    const npc = roster.NPC_VILLAGE_ROSTER.filter((n) => n.rank === 'genin')[3]!;
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    const human = 'openworldonly';
    await seedHuman(human, Number(npcSave.character.level));
    online.remove(npc.name);
    online.upsert({ name: npc.name, sector: SECTOR, character: npcSave.character });
    // A spar from anywhere (no world attack behind it) is refused.
    const spar = await post(create, human, { p1Character: { name: human }, p2Character: npcSave.character, baseRewards: true });
    assert.equal(spar.status, 409, JSON.stringify(spar.body));
    // The world attack leaves no attack flag on the NPC: nothing to wake, and nothing to hold it with.
    assert.equal((await post(attack, human, { targetName: npc.name, attacker: { name: human } })).status, 200);
    assert.equal(online.get(npc.name)?.pendingAttacker ?? null, null);
    // The client's "you were attacked" notice is answered as delivered; a real challenge is refused.
    const challenge = (await import('./player/challenge.js')).default as unknown as typeof create;
    const notice = await post(challenge, human, { targetName: npc.name, challenge: { id: 'c-notice-1', fromName: human, toName: npc.name, createdAt: Date.now(), mode: 'standard', sectorAttack: true, battleId: 'pvp-notice' } });
    assert.equal(notice.status, 200, JSON.stringify(notice.body));
    const real = await post(challenge, human, { targetName: npc.name, challenge: { id: 'c-real-1', fromName: human, toName: npc.name, createdAt: Date.now(), mode: 'standard' } });
    assert.equal(real.status, 409, JSON.stringify(real.body));
    const bounty = (await import('./pvp/bounty.js')).default as unknown as typeof create;
    assert.equal((await post(bounty, human, { action: 'place', target: npc.name, amount: 1000 })).status, 409);
    const messages = (await import('./messages.js')).default as unknown as typeof create;
    assert.equal((await post(messages, human, { to: npc.name, text: 'hello' })).status, 409);
    online.remove(human);
});

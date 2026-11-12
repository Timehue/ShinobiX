import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';
import type { PvpSession } from './pvp/session.js';

// A Cinderhold war strike is a REAL world attack (owner ruling 2026-11-10),
// end to end through the real handlers: the war party picks a shinobi standing
// in the contested sector, it attacks an enemy player there exactly as a
// player's browser would (admission, duel, war registration, notice), the
// server plays its seat, and the fight scores the war when it is over.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-war-strike-integration-secret-32ch';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

const SECTOR = 18;
const CH = 'Cinderhold Village';
const MOON = 'Moonshadow Village';
const NOW = Date.UTC(2026, 10, 10, 13, 0, 0);

let kv: typeof import('./_storage.js').kv;
let online: typeof import('./_realtime/online-store.js').onlineStore;
let token: typeof import('./_auth.js').issuePlayerToken;
let driver: typeof import('./_npc-duel-driver.js');

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore: online } = await import('./_realtime/online-store.js'));
    ({ issuePlayerToken: token } = await import('./_auth.js'));
    driver = await import('./_npc-duel-driver.js');
    driver.setNpcActionBeatForTest(0);
    await kv.set('npc-village:state', { baseLevel: 60, target: 60, sample: 30, computedAt: Date.now() });
    const seed = await import('./_npc-village-seed.js');
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
    const { seedHomeSectorOwnership } = await import('./world-state.js');
    await seedHomeSectorOwnership(Date.now());
});

let seq = 0;
async function call(handler: unknown, name: string, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(value: Record<string, any>) { out.body = value; return res; }, end: () => res };
    const ip = `10.91.${Math.floor(++seq / 250)}.${seq % 250}`;
    await (handler as (req: unknown, res: unknown) => Promise<unknown>)({ method: 'POST', body: { playerName: name, ...body }, query: {}, headers: { 'x-player-token': token(name), 'x-player-name': name, 'x-forwarded-for': ip }, socket: { remoteAddress: ip } }, res);
    return out;
}

test('a Cinderhold shinobi in the contested sector attacks an enemy player for real, and the fight scores the war', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: NOW });
    t.after(() => mock.timers.reset());
    const roster = await import('./_npc-war-roster.js');
    const { npcOffDuty } = await import('./_npc-presence.js');
    const sw = await import('./_sector-war.js');
    const store = await import('./_sector-war-store.js');
    const party = await import('./_npc-war-party.js');

    // The war: Cinderhold besieging a Moonshadow sector.
    const contest = sw.newSectorWarSession({ sector: SECTOR, attackerVillage: CH, defenderVillage: MOON, winCondition: 'combat', now: NOW - 60_000 });
    await store.saveSectorWar(contest);

    // One Cinderhold shinobi standing at the front, and a Moonshadow defender there.
    const npc = roster.NPC_WAR_DEFENDERS.find((n) => !npcOffDuty(n.id, NOW))!;
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    online.upsert({ name: npc.name, sector: SECTOR, character: npcSave.character, tile: 60, tileSector: SECTOR } as never);
    const human = 'strikedefender';
    const character = { name: human, level: Number(npcSave.character.level), village: MOON, ryo: 0, unspentStats: 0, hp: 10000, maxHp: 10000,
        chakra: 1000, maxChakra: 1000, stamina: 1000, maxStamina: 1000, stats: {}, equipment: {},
        inventory: [], itemStacks: [], equippedJutsuIds: [], jutsu: [], jutsuMastery: [] };
    await kv.set(`save:${human}`, { _saveVersion: 1, currentSector: SECTOR, character });
    online.upsert({ name: human, sector: SECTOR, character, tile: 62, tileSector: SECTOR } as never);

    const [strike] = await party.runNpcWarParty({ now: NOW, listContests: async () => [contest] });
    assert.equal(strike?.kind, 'player', JSON.stringify(strike));
    assert.equal(strike?.npc, npc.id);
    assert.equal(strike?.target, human);
    const battleId = strike!.battleId!;
    assert.ok(battleId);

    // A real world duel, the NPC in seat p1 as the attacker, sealed as an NPC duel.
    const session = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
    assert.equal(session.rewardAuthority, 'world');
    assert.equal(String(session.p1.name), npc.name);
    assert.equal(String(session.p2.name).toLowerCase(), human);
    assert.equal(session.worldAttacker?.side, 'p1');
    assert.equal(session.npcDuel?.seat, 'p1');
    // Bound to the war before a move, and the player told they were attacked.
    assert.ok(await store.loadSectorWarToken(battleId), 'registered for the sector war');
    const inbox = (await kv.get<Array<Record<string, unknown>>>(`challenges:${human}`)) ?? [];
    assert.ok(inbox.some((c) => c.sectorAttack === true && c.battleId === battleId && c.fromName === npc.name), JSON.stringify(inbox));

    // The player joins (their client routes them in) and only ever ends their
    // turns; the server plays the NPC and wins.
    const move = (await import('./pvp/move.js')).default;
    assert.equal((await call(move, human, { battleId, role: 'p2', action: 'join', moveToken: 'join-p2' })).status, 200);
    await driver.driveNpcDuel(battleId, 'p1');
    mock.timers.tick(10_000);
    for (let guard = 0; guard < 300; guard++) {
        const live = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        if (live.status === 'done') break;
        if (live.activePlayer === 'p2') await call(move, human, { battleId, role: 'p2', action: 'wait', moveToken: `w${guard}` });
        else await driver.driveNpcDuel(battleId, 'p1');
        mock.timers.tick(1_000);
    }
    const done = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
    assert.equal(done.status, 'done');
    assert.equal(done.winner, 'p1', 'the NPC won the fight it started');

    // Both claim; the result scores the war for Cinderhold like any duel there.
    const claim = (await import('./pvp/claim-rewards.js')).default;
    const lost = await call(claim, human, { battleId, outcome: 'loss', completionVersion: 1 });
    assert.equal(lost.status, 200, JSON.stringify(lost.body));
    await call(claim, human, { battleId, outcome: 'loss', completionVersion: 1, completionAck: true });
    for (let i = 0; i < 5 && (await driver.driveNpcDuel(battleId, 'p1')) !== 'finished'; i++) mock.timers.tick(1_000);
    const war = (await kv.get<Record<string, any>>(sw.sectorWarKey(contest.id)))!;
    assert.ok(Number(war.attackerPoints) > 0, `Cinderhold scored the war (${war.attackerPoints})`);
    // A real loss for the player: they are in the hospital.
    const after = (await kv.get<Record<string, any>>(`save:${human}`))!.character;
    assert.ok(after.hospitalized === true || Number(after.hp) <= 0, 'the beaten player goes to the hospital');
    online.remove(human); online.remove(npc.name);
});

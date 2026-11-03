import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { VILLAGE_OUTSKIRTS } from '../../shared/sector-geo.js';
import type { PvpSession } from '../pvp/session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'outskirts-raid-journey-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
const missionId = 'fetch-d-supply-trail';
let kv: typeof import('../_storage.js').kv;
let online: typeof import('../_realtime/online-store.js').onlineStore;
let issueToken: typeof import('../_auth.js').issuePlayerToken;
let readSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let writeSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let receiptKey: typeof import('./_mission-progress-receipt.js').missionProgressReceiptKey;
let raid: Handler, start: Handler, report: Handler, challenge: Handler, pvp: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    ({ issuePlayerToken: issueToken } = await import('../_auth.js'));
    ({ readSoloPveSession: readSession, writeSoloPveSession: writeSession } = await import('../solo-pve/_store.js'));
    ({ missionProgressReceiptKey: receiptKey } = await import('./_mission-progress-receipt.js'));
    raid = (await import('./raid-start.js')).default as unknown as Handler;
    start = (await import('./ai-fight-start.js')).default as unknown as Handler;
    report = (await import('./report-ai-fight.js')).default as unknown as Handler;
    challenge = (await import('../village-guard/challenge.js')).default as unknown as Handler;
    pvp = (await import('../pvp/session.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const key of await kv.keys('*')) await kv.del(key);
    for (const player of online.list()) online.remove(player.name);
});

let callId = 0;
async function post(handler: Handler, player: string, body: Record<string, unknown>) {
    const result: { status: number; body: Record<string, any> } = { status: 200, body: {} };
    const res = {
        setHeader() { return res; },
        status(status: number) { result.status = status; return res; },
        json(value: Record<string, unknown>) { result.body = value; return res; },
        end() { return res; },
    };
    const ip = `127.21.0.${++callId}`;
    await handler({ method: 'POST', query: {}, body: { playerName: player, ...body },
        headers: { 'content-type': 'application/json', 'x-player-name': player, 'x-player-token': issueToken(player), 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    } as never, res as never);
    return result;
}

async function seed(player: string, village: string, sector: number) {
    const character = {
        name: player, village, level: 25, specialty: 'Ninjutsu', rankTitle: 'Genin', profession: 'healer', professionRank: 1,
        hp: 600, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300, ryo: 500,
        inventory: [], itemStacks: [], pets: [], equippedJutsuIds: ['starter-universal-flicker'],
        stats: { strength: 100, speed: 100, intelligence: 140, willpower: 120, ninjutsuOffense: 300, ninjutsuDefense: 250,
            taijutsuOffense: 100, taijutsuDefense: 100, bukijutsuOffense: 100, bukijutsuDefense: 100, genjutsuOffense: 100, genjutsuDefense: 100 },
        serverFieldMissionRuns: { [missionId]: { missionId, runId: `outskirts_run_${player}`, acceptedAt: Date.now() - 5_000 } },
    };
    await kv.set(`save:${player}`, { _saveVersion: 1, worldGeoV: 2, currentSector: sector, currentTile: 102,
        savedBloodlines: [], creatorJutsus: [], acceptedMissionIds: [missionId], missionProgress: {}, character });
    online.upsert({ name: player, sector, tile: 102, character });
}

async function finish(player: string, sector: number, outcome: 'win' | 'loss' = 'win') {
    const minted = await post(raid, player, { requestId: `outskirts_raid_${player}`, sector });
    assert.equal(minted.status, 200, JSON.stringify(minted.body));
    assert.equal(minted.body.sector, sector);
    const started = await post(start, player, { battleKind: 'raidAi', opponentId: minted.body.opponentId, sector, raidToken: minted.body.token });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const session = await readSession(started.body.sessionId);
    assert.ok(session);
    // Inject only a server-owned terminal result; the client report supplies no outcome or reward.
    const winner = outcome === 'win' ? 'player' as const : 'enemy' as const;
    await writeSession({ ...session, status: 'done', winner, outcome, settlementState: 'pending', version: session.version + 1,
        player: { ...session.player, hp: 420 }, enemy: { ...session.enemy, hp: outcome === 'win' ? 0 : session.enemy.hp },
        terminalEvidence: { finishedAt: Date.now(), finalMoveToken: `outskirts_terminal_${player}`, finalVersion: session.version + 1,
            finalEventSeq: session.eventSeq, winner, outcome, itemsUsed: {}, settlementState: 'pending' },
    });
    const settled = await post(report, player, { aiFightToken: started.body.token });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    return { token: started.body.token, minted };
}

const villages = Object.entries(VILLAGE_OUTSKIRTS);
for (const [homeIndex, [home]] of villages.entries()) for (const [village, sector] of villages) {
    if (home === village) continue;
    test(`${home} raids ${village} at its connected outskirts and credits one win once`, async () => {
        const player = `outskirts${homeIndex}s${sector}`;
        await seed(player, home, sector);
        const { token, minted } = await finish(player, sector);
        assert.equal(minted.body.source, 'field-raid');
        const proof = await kv.get<Record<string, unknown>>(receiptKey(player, missionId));
        assert.equal(proof?.raidCount, 1);
        const replay = await post(report, player, { aiFightToken: token });
        assert.equal(replay.status, 200, JSON.stringify(replay.body));
        assert.equal((await kv.get<Record<string, unknown>>(receiptKey(player, missionId)))?.raidCount, 1);
        assert.equal((await kv.get<Record<string, unknown>>(`save:${player}`))?.currentSector, sector);
        assert.equal(online.get(player)?.sector, sector);
    });
}

test('losing an outskirts raid does not credit a field-mission win', async () => {
    const player = 'outskirtsloss';
    await seed(player, 'Stormveil Village', 17);
    await finish(player, 17, 'loss');
    assert.equal((await kv.get<Record<string, unknown>>(receiptKey(player, missionId)))?.raidCount ?? 0, 0);
});

test('home villages and remote outskirts cannot mint a rival raid proof', async () => {
    for (const [village, sector] of villages) {
        const player = `outskirtshome${sector}`;
        await seed(player, village, sector);
        assert.equal((await post(raid, player, { requestId: `outskirts_home_${sector}`, sector })).status, 409);
    }
    await seed('outskirtsremote', 'Stormveil Village', 40);
    assert.equal((await post(raid, 'outskirtsremote', { requestId: 'outskirts_remote_raid', sector: 17 })).status, 409);
});

for (const [village, sector] of villages) test(`a posted ${village} guard can defend its real outskirts in PvP`, async () => {
    const home = villages.find(([name]) => name !== village)![0];
    const attacker = `outskirtsattacker${sector}`, guard = `outskirtsguard${sector}`;
    await seed(attacker, home, sector);
    await seed(guard, village, sector);
    await kv.set(`guard:${guard}`, { name: guard, village, level: 25, lastSeen: Date.now() }, { ex: 300 });
    const target = await post(challenge, attacker, { attackerCharacter: { name: attacker }, village, guardName: guard });
    assert.equal(target.status, 200, JSON.stringify(target.body));
    assert.equal(target.body.pvp, true);
    assert.equal((await post(raid, attacker, { requestId: `outskirts_human_${sector}`, sector })).status, 409, 'a reachable guard excludes the AI fallback');
    const duel = await post(pvp, attacker, { p1Character: { name: attacker }, p2Character: { name: guard },
        useCurrentVitals: true, requireWorldCoLocation: true, baseRewards: true, rewardSector: sector });
    assert.equal(duel.status, 200, JSON.stringify(duel.body));
    const session = await kv.get<PvpSession>(`pvp:${duel.body.battleId}`);
    assert.ok(session);
    assert.equal(session?.rewardAuthority, 'world');
    assert.equal(session?.rewardSector, sector);
    assert.deepEqual(session?.worldAttacker, { side: 'p1', name: attacker, village: home, clan: '' });
    const terminal: PvpSession = { ...session, status: 'done', winner: 'p1', endedAt: Date.now(), joined: { p1: true, p2: true },
        p1: { ...session.p1, hp: 420 }, p2: { ...session.p2, hp: 0 } };
    await kv.set(`pvp:${duel.body.battleId}`, terminal);
    const { settleTerminalWorldRaid } = await import('../pvp/_terminal-world-raid.js');
    const settled = await settleTerminalWorldRaid(terminal);
    assert.ok(settled.raid, 'the guard duel must settle as a world raid');
    assert.equal((await kv.get<Record<string, unknown>>(receiptKey(attacker, missionId)))?.raidCount, 1);
    await settleTerminalWorldRaid(terminal);
    assert.equal((await kv.get<Record<string, unknown>>(receiptKey(attacker, missionId)))?.raidCount, 1, 'a terminal replay cannot add another win');
});

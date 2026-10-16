import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { rollOrdinaryPveEncounter } from '../../shared/ordinary-pve-encounter.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'ordinary-encounter-handler-fixture';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let readSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let writeSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let start: Handler;
let report: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ readSoloPveSession: readSession, writeSoloPveSession: writeSession } = await import('../solo-pve/_store.js'));
    start = (await import('./ai-fight-start.js')).default as unknown as Handler;
    report = (await import('./report-ai-fight.js')).default as unknown as Handler;
});
after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

async function post(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = { setHeader: () => res, status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (value: Record<string, unknown>) => { out.body = value; return res; }, end: () => res };
    await handler({ method: 'POST', body: { playerName, ...body }, headers: {
        'content-type': 'application/json', 'x-player-token': issuePlayerToken(playerName) ?? '',
    }, socket: { remoteAddress: '127.8.0.1' } } as never, res as never);
    return out;
}

async function seed(playerName: string, sector = 61) {
    await kv.set(`save:${playerName}`, { _saveVersion: 1, currentSector: sector, acceptedMissionIds: [], missionProgress: {},
        savedBloodlines: [], creatorJutsus: [], character: {
            name: playerName, level: 100, rankTitle: 'Jounin', specialty: 'Ninjutsu',
            hp: 600, maxHp: 600, chakra: 300, maxChakra: 300, stamina: 300, maxStamina: 300,
            ryo: 50, robberStreak: 5, inventory: [], itemStacks: [], unspentStats: 0, stats: {}, equippedJutsuIds: [],
        } });
}

test('discovered Explore identity survives start, duplicate, resume, victory and duplicate settlement', async () => {
    const player = 'ordinaryreceiptjourney';
    const receiptId = 'ordinary-receipt-001';
    await seed(player);
    const encounter = rollOrdinaryPveEncounter({ sourceId: receiptId, playerLevel: 25, sector: 61,
        seed: 'earlier discovery', displayName: 'Receipt Assassin', portraitImage: '/art/receipt-assassin.webp',
        reward: { xp: 125, ryo: 75, trait: 'Swift' } });
    await kv.set(`world-explore-receipt:${player}:${receiptId}`, { version: 1, playerName: player, requestId: receiptId,
        sector: 61, reward: { sector: 61, xp: 0, ryo: 0 }, outcome: { kind: 'battle', encounter }, at: Date.now() });
    const request = { battleKind: 'explore', sector: 61, worldExploreRequestId: receiptId, encounterId: encounter.id,
        opponentId: 'builtin-ai-academy-sparring', opponentLevel: 1 };
    const first = await post(start, player, request);
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    assert.deepEqual(first.body?.encounter, encounter);
    assert.equal(first.body?.opponentName, encounter.displayName);
    assert.equal(first.body?.baseXp, 125);
    assert.equal(first.body?.baseRyo, 75);
    const sessionId = String(first.body?.sessionId);
    const session = await readSession(sessionId);
    assert.ok(session);
    assert.equal(session.enemy.name, encounter.displayName);
    assert.equal(session.enemy.character.level, encounter.level);
    assert.equal(session.enemy.character.visual, encounter.portraitImage);
    const duplicate = await post(start, player, request);
    assert.equal(duplicate.statusCode, 409);
    const resumed = await post(start, player, { resumeAiFight: true });
    assert.equal(resumed.statusCode, 200);
    assert.equal(resumed.body?.token, first.body?.token);
    assert.equal(resumed.body?.sessionId, sessionId);
    assert.deepEqual(resumed.body?.encounter, encounter);
    const version = session.version + 1;
    await writeSession({ ...session, enemy: { ...session.enemy, hp: 0 }, status: 'done', winner: 'player', outcome: 'win',
        settlementState: 'pending', version, terminalEvidence: { finishedAt: Date.now(), finalMoveToken: 'ordinary-victory',
            finalVersion: version, finalEventSeq: session.eventSeq, winner: 'player', outcome: 'win', itemsUsed: {}, settlementState: 'pending' } });
    const victory = await post(report, player, { aiFightToken: first.body?.token, xp: 999999, ryo: 999999 });
    assert.equal(victory.statusCode, 200, JSON.stringify(victory.body));
    assert.equal(victory.body?.outcome, 'win');
    assert.deepEqual(victory.body?.encounter, encounter);
    const balance = Number((victory.body?.character as Record<string, unknown>)?.ryo);
    const replay = await post(report, player, { aiFightToken: first.body?.token });
    assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
    assert.deepEqual(replay.body?.encounter, encounter);
    assert.equal(Number((replay.body?.character as Record<string, unknown>)?.ryo), balance, 'a repeated terminal report pays once');
    const reused = await post(start, player, request);
    assert.equal(reused.statusCode, 409);
    assert.match(String(reused.body?.error), /already started/);
});

test('a new World request cannot silently replace the active opponent and a lapsed fight is not resumed', async () => {
    const player = 'ordinaryworldconflict';
    await seed(player, 12);
    const first = await post(start, player, { worldEncounter: { kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 12 } });
    assert.equal(first.statusCode, 200, JSON.stringify(first.body));
    const duplicate = await post(start, player, { worldEncounter: { kind: 'wanderer-ambush', sourceId: 'wanderer-ambush', sector: 12 } });
    assert.equal(duplicate.statusCode, 200, JSON.stringify(duplicate.body));
    assert.equal(duplicate.body?.sessionId, first.body?.sessionId, 'the initial-wave retry reuses its server-generated chain id');
    const conflict = await post(start, player, { worldEncounter: { kind: 'wanderer', sourceId: 'nemesis', sector: 12 } });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.body?.reason, 'active-encounter-conflict');
    assert.deepEqual(conflict.body?.worldContext, first.body?.worldContext);
    const resume = await post(start, player, { resumeWorldFight: true });
    assert.equal(resume.statusCode, 200);
    assert.equal(resume.body?.sessionId, first.body?.sessionId);
    const session = await readSession(String(first.body?.sessionId));
    assert.ok(session);
    await writeSession({ ...session, expiresAt: Date.now() - 1000 });
    const expired = await post(start, player, { resumeWorldFight: true, recoveryProbeVersion: 2 });
    assert.equal(expired.statusCode, 204, JSON.stringify(expired.body));
    const terminal = await readSession(session.sessionId);
    assert.equal(terminal?.status, 'done');
    assert.ok(terminal?.terminalEvidence?.lapsedAt);
});

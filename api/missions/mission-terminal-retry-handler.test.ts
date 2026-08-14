import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'mission-terminal-retry-handler-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const MISSION_ID = 'combat-e-drill';
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let readSoloPveSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let writeSoloPveSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let combatStart: Handler;
let fightOutcome: Handler;
let queueClaim: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js'));
    combatStart = (await import('./combat-start.js')).default as unknown as Handler;
    fightOutcome = (await import('../pve/fight-outcome.js')).default as unknown as Handler;
    queueClaim = (await import('./queue-combat-claim.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [
        'save:missionretry*',
        'mission-combat-active:missionretry*',
        'mission-combat-binding:mission-*',
        'missions:combat-claim:missionretry*',
        'solo-pve:mission-*',
        'ratelimit:*missionretry*',
        'lock:*missionretry*',
    ]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { res: res as never, out };
}

async function post(handler: Handler, playerName: string, body: Record<string, unknown>): Promise<Out> {
    const output = response();
    await handler({
        method: 'POST',
        body: { playerName, ...body },
        headers: {
            'content-type': 'application/json',
            'x-player-token': issuePlayerToken(playerName) ?? '',
        },
        socket: { remoteAddress: `127.5.0.${playerName.length}` },
    } as never, output.res);
    return output.out;
}

async function seedPlayer(playerName: string) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        savedBloodlines: [],
        creatorJutsus: [],
        character: {
            name: playerName,
            level: 10,
            rankTitle: 'Genin',
            specialty: 'Ninjutsu',
            hp: 500,
            maxHp: 500,
            chakra: 250,
            maxChakra: 250,
            stamina: 250,
            maxStamina: 250,
            ryo: 0,
            inventory: [],
            itemStacks: [],
            stats: {
                strength: 80,
                speed: 80,
                intelligence: 100,
                willpower: 90,
                ninjutsuOffense: 200,
                ninjutsuDefense: 180,
                taijutsuOffense: 80,
                taijutsuDefense: 80,
                bukijutsuOffense: 80,
                bukijutsuDefense: 80,
                genjutsuOffense: 80,
                genjutsuDefense: 80,
            },
            equippedJutsuIds: ['starter-universal-flicker'],
        },
    });
}

async function terminalize(runId: string, outcome: 'win' | 'loss' | 'fled') {
    const session = await readSoloPveSession(runId);
    assert.ok(session);
    const winner = outcome === 'win' ? 'player' as const : 'enemy' as const;
    const version = session.version + 1;
    await writeSoloPveSession({
        ...session,
        player: { ...session.player, hp: outcome === 'win' ? 320 : 180 },
        enemy: { ...session.enemy, hp: outcome === 'win' ? 0 : session.enemy.hp },
        status: 'done',
        winner,
        outcome,
        settlementState: 'pending',
        version,
        terminalEvidence: {
            finishedAt: Date.now(),
            finalMoveToken: `terminal-${outcome}-${runId}`,
            finalVersion: version,
            finalEventSeq: session.eventSeq,
            winner,
            outcome,
            itemsUsed: { ...session.itemsUsed },
            settlementState: 'pending',
        },
    });
}

async function start(playerName: string): Promise<Out> {
    const out = await post(combatStart, playerName, { missionId: MISSION_ID });
    assert.equal(out.statusCode, 200, JSON.stringify(out.body));
    assert.match(String(out.body?.runId), /^mission-[A-Za-z0-9]{16,96}$/);
    return out;
}

describe('mission terminal retry handler', () => {
    it('retires loss/forfeit authority, but keeps a won run recoverable for exact queue replay', async () => {
        const player = 'missionretryjourney';
        await seedPlayer(player);

        const first = await start(player);
        const lossRun = String(first.body?.runId);
        await terminalize(lossRun, 'loss');
        const physicalLoss = await post(fightOutcome, player, { runId: lossRun });
        assert.equal(physicalLoss.statusCode, 200);
        assert.equal(physicalLoss.body?.outcome, 'loss');
        const afterLoss = await start(player);
        const forfeitRun = String(afterLoss.body?.runId);
        assert.notEqual(forfeitRun, lossRun);
        assert.equal(afterLoss.body?.resumed, false);
        const lossSave = await kv.get<Record<string, unknown>>(`save:${player}`);
        assert.equal((lossSave?.character as Record<string, unknown>).hp, 180);

        await terminalize(forfeitRun, 'fled');
        const afterForfeit = await start(player);
        const winRun = String(afterForfeit.body?.runId);
        assert.notEqual(winRun, forfeitRun);
        assert.equal(afterForfeit.body?.resumed, false);
        const forfeitSave = await kv.get<Record<string, unknown>>(`save:${player}`);
        assert.equal((forfeitSave?.character as Record<string, unknown>).hp, 180);

        await terminalize(winRun, 'win');
        const lostWinAck = await start(player);
        assert.equal(lostWinAck.body?.runId, winRun);
        assert.equal(lostWinAck.body?.resumed, true, 'a terminal win remains the exact run until queued');

        const queued = await post(queueClaim, player, { missionId: MISSION_ID, runId: winRun });
        assert.equal(queued.statusCode, 200, JSON.stringify(queued.body));
        assert.equal(queued.body?.queued, true);
        const queueReplay = await post(queueClaim, player, { missionId: MISSION_ID, runId: winRun });
        assert.equal(queueReplay.statusCode, 200);
        assert.equal(queueReplay.body?.queued, true);
        assert.equal(queueReplay.body?.replayed, true);
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        const pending = (save?.character as Record<string, unknown>).pendingCombatMissionClaims as string[];
        assert.deepEqual(pending, [MISSION_ID]);
    });
});

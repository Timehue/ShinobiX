import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { PvpFighter } from '../pvp/session.js';
import { createSoloPveSession, type SoloPveSession } from '../solo-pve/_session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'mission-queue-handler-test-secret-32-bytes';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };
type StoredSave = { _saveVersion: number; character: Record<string, unknown> };

const PLAYER = 'missionqueueowner';
const RUN_ID = 'mission-handler-run-0001';
const MISSION_ID = 'combat-e-drill';
let handler: Handler;
let kv: typeof import('../_storage.js').kv;
let token = '';

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

function request(address: string) {
    return {
        method: 'POST',
        body: { playerName: PLAYER, missionId: MISSION_ID, runId: RUN_ID },
        headers: {
            'content-type': 'application/json',
            'x-player-token': token,
            'x-forwarded-for': address,
        },
        socket: { remoteAddress: address },
    } as never;
}

async function post(address: string): Promise<Out> {
    const { res, out } = response();
    await handler(request(address), res);
    return out;
}

function fighter(name: string, hp: number, pos: number): PvpFighter {
    return {
        name, hp, maxHp: 100, chakra: 100, maxChakra: 100,
        stamina: 100, maxStamina: 100, shield: 0, statuses: [], pos,
        character: {
            name, level: 1, specialty: 'Ninjutsu', stats: {},
            jutsu: [], pvpItems: [], equipment: {},
        },
    };
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    const auth = await import('../_auth.js');
    token = auth.issuePlayerToken(PLAYER)!;
    handler = (await import('./queue-combat-claim.js')).default as unknown as Handler;
    const combat = await import('./_authoritative-combat-session.js');
    const missionCatalog = await import('./_mission-catalog.js');
    const store = await import('../solo-pve/_store.js');
    const mission = missionCatalog.combatMissionByKey(MISSION_ID)!;
    const active = createSoloPveSession({
        sessionId: RUN_ID,
        ownerSlug: PLAYER,
        encounter: { kind: 'mission', id: MISSION_ID, sourceId: mission.aiProfileId, bindingId: RUN_ID },
        player: fighter(PLAYER, 37, 62),
        enemy: fighter('Academy Sparring Partner', 0, 63),
        now: Date.now(),
    });
    const terminal: SoloPveSession = {
        ...active,
        status: 'done', winner: 'player', outcome: 'win',
        terminalEvidence: {
            finishedAt: Date.now(), finalMoveToken: 'mission-final-move',
            finalVersion: active.version, finalEventSeq: active.eventSeq,
            winner: 'player', outcome: 'win', itemsUsed: {}, settlementState: 'pending',
        },
    };
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        character: {
            name: PLAYER, level: 1, hp: 100, maxHp: 100,
            chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
            inventory: [], itemStacks: [], dailyMissionsCompleted: 0,
            pendingCombatMissionClaims: [],
        },
    });
    await store.writeSoloPveSession(terminal);
    await kv.set(
        combat.missionCombatBindingKey(RUN_ID),
        combat.createMissionCombatBinding({ runId: RUN_ID, playerName: PLAYER, mission }),
        { ex: combat.MISSION_COMBAT_SESSION_TTL_SECONDS },
    );
});

after(async () => {
    const rateKeys = await kv.keys('ratelimit:queue-combat-claim:*');
    await kv.del(
        `save:${PLAYER}`,
        `mission-combat-binding:${RUN_ID}`,
        `solo-pve:${RUN_ID}`,
        `pve-outcome:${RUN_ID}`,
        `solo-pve-usage:mission:${RUN_ID}`,
        `missions:combat-claim:${PLAYER}:${MISSION_ID}`,
        ...rateKeys,
    );
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('lost queue response replays the exact authoritative surviving HP and save version', async () => {
    const lostResponse = await post('198.51.100.81');
    assert.equal(lostResponse.statusCode, 200);
    assert.equal(lostResponse.body?.queued, true);
    assert.equal(lostResponse.body?.replayed, false);
    assert.equal(lostResponse.body?._saveVersion, 3);
    const committedCharacter = lostResponse.body?.character as Record<string, unknown>;
    assert.equal(committedCharacter.hp, 37, 'the sealed terminal remainder must replace pre-fight HP');

    // Simulate the client never receiving that committed body and issuing the
    // same request again. The real handler must reconstruct the response from
    // durable binding/session/save records without another HP or version write.
    const recovered = await post('198.51.100.82');
    assert.equal(recovered.statusCode, 200);
    assert.equal(recovered.body?.queued, true);
    assert.equal(recovered.body?.replayed, true);
    assert.equal(recovered.body?._saveVersion, 3);
    assert.deepEqual(recovered.body?.character, committedCharacter);

    const stored = await kv.get<StoredSave>(`save:${PLAYER}`);
    assert.equal(stored?._saveVersion, 3);
    assert.equal(stored?.character.hp, 37);
    assert.deepEqual(stored?.character.pendingCombatMissionClaims, [MISSION_ID]);
    const receipts = stored?.character.serverSettlementReceipts as Array<{ value?: { kind?: string; runId?: string } }>;
    assert.equal(receipts.filter((receipt) => receipt.value?.kind === 'pve-outcome' && receipt.value.runId === RUN_ID).length, 1);
});

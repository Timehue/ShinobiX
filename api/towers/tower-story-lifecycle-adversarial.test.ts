import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { TowerSession } from './_tower-session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'tower-story-lifecycle-adversarial-secret';
delete process.env.TOWER_MODE_DISABLED;

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type HttpResult = { status: number; body: Json; headers: Record<string, string> };

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let partyHandler: Handler;
let startHandler: Handler;
let stateHandler: Handler;
let actionHandler: Handler;
let settleHandler: Handler;
let readSession: typeof import('./_tower-store.js').readSession;
let writeSession: typeof import('./_tower-store.js').writeSession;
let activeActor: typeof import('./_tower-session.js').activeActor;
let TURN_AFK_MS: typeof import('./_tower-mp.js').TURN_AFK_MS;
let setRealtimeEmitter: typeof import('../_realtime/notify.js').setRealtimeEmitter;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    partyHandler = (await import('./party.js')).default as unknown as Handler;
    startHandler = (await import('./start.js')).default as unknown as Handler;
    stateHandler = (await import('./state.js')).default as unknown as Handler;
    actionHandler = (await import('./action.js')).default as unknown as Handler;
    settleHandler = (await import('./settle.js')).default as unknown as Handler;
    ({ readSession, writeSession } = await import('./_tower-store.js'));
    ({ activeActor } = await import('./_tower-session.js'));
    ({ TURN_AFK_MS } = await import('./_tower-mp.js'));
    ({ setRealtimeEmitter } = await import('../_realtime/notify.js'));
});

beforeEach(async () => {
    setRealtimeEmitter(null);
    for (const prefix of [
        'tower:*', 'tower-party:*', 'tower-party-code:*', 'tower-party-player:*',
        'tower-party-invites:*', 'tower-invite:*', 'battle-lock:*', 'save:*',
        'auth-session:*',
    ]) {
        for (const key of await kv.keys(prefix)) await kv.del(key);
    }
});

after(() => setRealtimeEmitter(null));

function token(slug: string): string {
    const value = issuePlayerToken(slug);
    assert.ok(value, `player token minted for ${slug}`);
    return value;
}

function makeResponse(): { output: HttpResult; response: never } {
    const output: HttpResult = { status: 200, body: {}, headers: {} };
    const response = {
        setHeader: (name: string, value: unknown) => {
            output.headers[name.toLowerCase()] = String(value);
            return response;
        },
        status: (status: number) => { output.status = status; return response; },
        json: (body: Json) => { output.body = body; return response; },
        end: () => response,
    };
    return { output, response: response as never };
}

async function request(handler: Handler, method: 'GET' | 'POST', player: string, input: Json): Promise<HttpResult> {
    const { output, response } = makeResponse();
    await handler({
        method,
        ...(method === 'GET' ? { query: input } : { body: input, query: {} }),
        headers: { 'x-player-token': token(player) },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, response);
    return output;
}

function save(slug: string, input: { level?: number; ryo?: number; dailyFloors?: number } = {}): Json {
    return {
        _saveVersion: 7,
        character: {
            name: slug[0]!.toUpperCase() + slug.slice(1),
            level: input.level ?? 50,
            xp: 0,
            ryo: input.ryo ?? 20_000,
            dailyBattleDate: new Date().toISOString().slice(0, 10),
            dailyBattleFloors: input.dailyFloors ?? 0,
            battleTowerClearedFloors: [],
            maxHp: 2_500,
            maxChakra: 500,
            maxStamina: 500,
            specialty: 'Taijutsu',
            stats: {
                strength: 300, speed: 300,
                taijutsuOffense: 900, taijutsuDefense: 800,
                bukijutsuDefense: 700, genjutsuDefense: 700, ninjutsuDefense: 700,
            },
            equippedJutsuIds: [], inventory: [], equipment: {},
        },
        savedBloodlines: [], creatorJutsus: [],
    };
}

async function seed(...players: string[]): Promise<void> {
    for (const player of players) await kv.set(`save:${player}`, save(player));
}

function partyFrom(result: HttpResult): Json {
    const party = result.body.party as Json | null | undefined;
    assert.ok(party, `response includes party authority: ${JSON.stringify(result.body)}`);
    return party;
}

describe('Story Tower adversarial Ready Room and session lifecycle', { concurrency: false }, () => {
    it('admits all valid simultaneous open-code joiners up to the exact room cap', async () => {
        const players = ['qa-host', 'qa-a', 'qa-b', 'qa-c', 'qa-overflow'];
        await seed(...players);
        const created = await request(partyHandler, 'POST', 'qa-host', {
            action: 'create', playerName: 'qa-host', mode: 'story', floor: 1,
            requestId: 'qa-create-concurrent-0001',
        });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        const room = partyFrom(created);
        const inviteCode = String(room.inviteCode);

        const joined = await Promise.all(players.slice(1).map(async (player, index) => ({
            player,
            result: await request(partyHandler, 'POST', player, {
                action: 'join', playerName: player, inviteCode,
                requestId: `qa-open-join-${String(index).padStart(8, '0')}`,
            }),
        })));
        const successes = joined.filter(attempt => attempt.result.status === 200);
        const rejected = joined.filter(attempt => attempt.result.status !== 200);
        assert.equal(successes.length, 3, JSON.stringify(joined.map(attempt => ({ player: attempt.player, status: attempt.result.status, body: attempt.result.body }))));
        assert.equal(rejected.length, 1);
        assert.equal(rejected[0]?.result.status, 409);
        assert.equal(rejected[0]?.result.body.errorCode, 'party-full');

        const latest = await request(partyHandler, 'GET', 'qa-host', { playerName: 'qa-host' });
        const finalRoom = partyFrom(latest);
        assert.equal((finalRoom.members as unknown[]).length, 4);
        assert.equal(await kv.get(`tower-party-player:${rejected[0]!.player}`), null, 'overflow join leaves no stale player projection');
    });

    it('binds a party request ID to the effective readiness intent', async () => {
        await seed('qa-ready-host');
        const created = await request(partyHandler, 'POST', 'qa-ready-host', {
            action: 'create', playerName: 'qa-ready-host', mode: 'story', floor: 1,
            requestId: 'qa-ready-create-0001',
        });
        const room = partyFrom(created);
        const first = await request(partyHandler, 'POST', 'qa-ready-host', {
            action: 'ready', ready: false, playerName: 'qa-ready-host', partyId: room.id,
            expectedVersion: room.version, requestId: 'qa-ready-intent-0001',
        });
        assert.equal(first.status, 200, JSON.stringify(first.body));
        const afterFirst = partyFrom(first);
        assert.equal((afterFirst.members as Json[])[0]?.ready, false);

        const conflictingReuse = await request(partyHandler, 'POST', 'qa-ready-host', {
            action: 'ready', ready: true, playerName: 'qa-ready-host', partyId: room.id,
            expectedVersion: afterFirst.version, requestId: 'qa-ready-intent-0001',
        });
        assert.equal(conflictingReuse.status, 409);
        assert.equal(conflictingReuse.body.errorCode, 'request-conflict');
    });

    it('drives invite, weak AI, eligibility, fee, reconnect, action replay, AFK, settlement, and cleanup through HTTP authority', async () => {
        const host = 'qa-life-host';
        const ally = 'qa-life-ally';
        await kv.set(`save:${host}`, save(host, { level: 50, ryo: 5_000, dailyFloors: 3 }));
        await kv.set(`save:${ally}`, save(ally, { level: 29, ryo: 99, dailyFloors: 12 }));
        const pushed: Array<{ room: string; event: string; payload: Json }> = [];
        setRealtimeEmitter((room, event, payload) => pushed.push({ room, event, payload: payload as Json }));

        let result = await request(partyHandler, 'POST', host, {
            action: 'create', playerName: host, mode: 'story', floor: 1,
            requestId: 'qa-life-create-0001',
        });
        let room = partyFrom(result);
        result = await request(partyHandler, 'POST', host, {
            action: 'invite', playerName: host, partyId: room.id, target: ally,
            expectedVersion: room.version, requestId: 'qa-life-invite-0001',
        });
        room = partyFrom(result);
        const invitationPoll = await request(partyHandler, 'GET', ally, { playerName: ally });
        assert.equal((invitationPoll.body.invitations as Json[])[0]?.partyId, room.id);
        result = await request(partyHandler, 'POST', ally, {
            action: 'accept', playerName: ally, partyId: room.id,
            expectedVersion: room.version, requestId: 'qa-life-accept-0001',
        });
        room = partyFrom(result);

        const unauthorizedAi = await request(partyHandler, 'POST', ally, {
            action: 'add-ai', playerName: ally, partyId: room.id,
            expectedVersion: room.version, requestId: 'qa-life-ai-denied-0001',
        });
        assert.equal(unauthorizedAi.status, 403);
        assert.equal(unauthorizedAi.body.errorCode, 'host-required');
        result = await request(partyHandler, 'POST', host, {
            action: 'add-ai', playerName: host, partyId: room.id,
            expectedVersion: room.version, requestId: 'qa-life-ai-add-0001',
        });
        room = partyFrom(result);
        assert.equal(room.aiMemberCount, 1);
        assert.equal(room.liveMemberCount, 2);

        for (const player of [host, ally]) {
            result = await request(partyHandler, 'POST', player, {
                action: 'ready', playerName: player, partyId: room.id,
                expectedVersion: room.version, requestId: `qa-life-ready-${player}`,
            });
            room = partyFrom(result);
        }
        assert.equal(room.canLaunch, true);

        const launchBody = {
            hostName: host, mode: 'story', floor: 1, partyId: room.id,
            expectedVersion: room.version, requestId: 'qa-life-launch-0001',
        };
        const ineligible = await request(startHandler, 'POST', host, launchBody);
        assert.equal(ineligible.status, 403, JSON.stringify(ineligible.body));
        assert.equal(ineligible.body.errorCode, 'member-ineligible');
        assert.deepEqual(ineligible.body.members, [ally]);
        assert.equal(((await kv.get<Json>(`save:${host}`))?.character as Json).ryo, 5_000, 'eligibility failure cannot charge entry');
        assert.equal(await kv.get(`battle-lock:${host}`), null);
        assert.equal(await kv.get(`battle-lock:${ally}`), null);

        const allyRecord = await kv.get<Json>(`save:${ally}`);
        assert.ok(allyRecord);
        await kv.set(`save:${ally}`, { ...allyRecord, character: { ...(allyRecord.character as Json), level: 30 } });
        const launched = await request(startHandler, 'POST', host, launchBody);
        assert.equal(launched.status, 200, JSON.stringify(launched.body));
        const runId = String(launched.body.runId);
        let session = launched.body.session as TowerSession;
        assert.equal(session.actors.filter(actor => actor.side === 'squad' && actor.ai === false).length, 2);
        const recruit = session.actors.find(actor => actor.character.towerGenericAiProfile === 'story-recruit-v1');
        assert.equal(recruit?.ai, true);
        assert.equal(recruit?.ownerSlug, null);
        assert.equal(await kv.get('battle-lock:tower-ai:1'), null);
        assert.notEqual(await kv.get(`battle-lock:${host}`), null);
        assert.notEqual(await kv.get(`battle-lock:${ally}`), null);
        const postLaunchHost = await kv.get<Json>(`save:${host}`);
        assert.equal((postLaunchHost?.character as Json).ryo, 3_500);
        assert.equal((postLaunchHost?.character as Json).dailyBattleFloors, 4);
        const postLaunchAlly = await kv.get<Json>(`save:${ally}`);
        assert.equal((postLaunchAlly?.character as Json).ryo, 99, 'only the host reserves the party entry');
        assert.equal((postLaunchAlly?.character as Json).dailyBattleFloors, 12);

        for (const player of [host, ally]) {
            const reconnected = await request(stateHandler, 'GET', player, { playerName: player, runId });
            assert.equal(reconnected.status, 200, JSON.stringify(reconnected.body));
            assert.equal((reconnected.body.session as TowerSession).runId, runId);
        }

        const acting = activeActor(session)?.ownerSlug;
        assert.ok(acting === host || acting === ally);
        const actionBody = {
            playerName: acting, runId, type: 'wait',
            moveToken: 'qa-life-move-token-0001', expectedVersion: Number((session as TowerSession & { actionVersion?: number }).actionVersion ?? 0),
        };
        const applied = await request(actionHandler, 'POST', acting, actionBody);
        assert.equal(applied.status, 200, JSON.stringify(applied.body));
        assert.equal(applied.body.applied, true);
        assert.equal(applied.body.replayed, false);
        const replayed = await request(actionHandler, 'POST', acting, actionBody);
        assert.equal(replayed.status, 200, JSON.stringify(replayed.body));
        assert.equal(replayed.body.applied, true);
        assert.equal(replayed.body.replayed, true);
        const conflictingToken = await request(actionHandler, 'POST', acting, { ...actionBody, type: 'heal' });
        assert.equal(conflictingToken.status, 409, JSON.stringify(conflictingToken.body));
        assert.equal(conflictingToken.body.reason, 'move-token-conflict');

        session = (await readSession(runId))!;
        assert.equal(session.status, 'active');
        const beforeAfkVersion = Number((session as TowerSession & { actionVersion?: number }).actionVersion ?? 0);
        session.turnStartedAt = Date.now() - TURN_AFK_MS - 100;
        await writeSession(session);
        const afkPoll = await request(stateHandler, 'GET', host, { playerName: host, runId });
        assert.equal(afkPoll.status, 200, JSON.stringify(afkPoll.body));
        const afkSession = afkPoll.body.session as TowerSession & { actionVersion?: number };
        assert.ok(Number(afkSession.actionVersion) > beforeAfkVersion, 'authoritative AFK pass advances the session revision');

        afkSession.status = 'done';
        afkSession.winner = 'squad';
        afkSession.rewardSettlementState = 'pending';
        afkSession.objectiveState.completed = true;
        afkSession.objectiveState.failed = false;
        await writeSession(afkSession);
        const settled = await request(settleHandler, 'POST', ally, { playerName: ally, runId });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal(settled.body.settled, true);
        const results = settled.body.results as Json;
        assert.ok(results[host]);
        assert.ok(results[ally]);
        assert.equal(Object.keys(results).some(key => key.startsWith('tower-ai')), false);
        const hostAfterSettle = await kv.get<Json>(`save:${host}`);
        const allyAfterSettle = await kv.get<Json>(`save:${ally}`);
        assert.ok(((hostAfterSettle?.character as Json).battleTowerClearedFloors as unknown[]).includes(1));
        assert.ok(((allyAfterSettle?.character as Json).battleTowerClearedFloors as unknown[]).includes(1));
        assert.equal(await kv.get(`battle-lock:${host}`), null);
        assert.equal(await kv.get(`battle-lock:${ally}`), null);
        assert.equal(await kv.get(`tower-party-player:${host}`), null);
        assert.equal(await kv.get(`tower-party-player:${ally}`), null);
        assert.equal((await request(partyHandler, 'GET', host, { playerName: host })).body.party, null);

        const settlementReplay = await request(settleHandler, 'POST', host, { playerName: host, runId });
        assert.equal(settlementReplay.status, 200);
        assert.equal(settlementReplay.body.settled, true);
        const forbidden = ['actors', 'session', 'character', 'inviteCode', 'token', 'password'];
        assert.ok(pushed.length > 0);
        for (const event of pushed) {
            assert.equal(event.event, 'tower:kick');
            for (const field of forbidden) assert.equal(Object.hasOwn(event.payload, field), false, `${field} never leaks in realtime hint`);
        }
    });

    it('runs a host plus one novice AI through real turns to terminal settlement without granting the AI account authority', async () => {
        const host = 'qa-solo-ai-host';
        await kv.set(`save:${host}`, save(host, { level: 50, ryo: 5_000 }));
        const pushed: Array<{ room: string; event: string; payload: Json }> = [];
        setRealtimeEmitter((room, event, payload) => pushed.push({ room, event, payload: payload as Json }));

        let result = await request(partyHandler, 'POST', host, {
            action: 'create', playerName: host, mode: 'story', floor: 1,
            requestId: 'qa-solo-ai-create-0001',
        });
        let room = partyFrom(result);
        result = await request(partyHandler, 'POST', host, {
            action: 'add-ai', playerName: host, partyId: room.id,
            expectedVersion: room.version, requestId: 'qa-solo-ai-add-0001',
        });
        room = partyFrom(result);
        result = await request(partyHandler, 'POST', host, {
            action: 'ready', playerName: host, partyId: room.id,
            expectedVersion: room.version, requestId: 'qa-solo-ai-ready-0001',
        });
        room = partyFrom(result);
        assert.equal(room.canLaunch, true);
        const launched = await request(startHandler, 'POST', host, {
            hostName: host, mode: 'story', floor: 1, partyId: room.id,
            expectedVersion: room.version, requestId: 'qa-solo-ai-launch-0001',
        });
        assert.equal(launched.status, 200, JSON.stringify(launched.body));
        const runId = String(launched.body.runId);
        let session = launched.body.session as TowerSession & { actionVersion?: number };
        const recruit = session.actors.find(actor => actor.character.towerGenericAiProfile === 'story-recruit-v1');
        assert.ok(recruit);
        assert.equal(recruit.ownerSlug, null);
        assert.equal(recruit.character.towerRewardEligibility, 'none');
        assert.equal(await kv.get('save:tower-ai:1'), null);
        assert.equal(await kv.get('battle-lock:tower-ai:1'), null);

        const reconnected = await request(stateHandler, 'GET', host, { playerName: host, runId });
        assert.equal(reconnected.status, 200, JSON.stringify(reconnected.body));
        session = reconnected.body.session as TowerSession & { actionVersion?: number };
        let recruitActed = false;
        for (let turn = 0; turn < 48 && session.status === 'active'; turn++) {
            assert.equal(activeActor(session)?.ownerSlug, host, 'automatic turns resolve until the live host is authoritative');
            const acted = await request(actionHandler, 'POST', host, {
                playerName: host,
                runId,
                type: 'wait',
                moveToken: `qa-solo-ai-wait-${String(turn).padStart(4, '0')}`,
                expectedVersion: Number(session.actionVersion ?? 0),
            });
            assert.equal(acted.status, 200, JSON.stringify(acted.body));
            assert.equal(acted.body.applied, true, JSON.stringify(acted.body));
            session = acted.body.session as TowerSession & { actionVersion?: number };
            recruitActed ||= session.log.some(line => line.includes('Tower Recruit I'));
        }
        assert.equal(session.status, 'done', `run reaches terminal authority by round ${session.round}`);
        assert.equal(recruitActed, true, 'the novice recruit takes automatic engine turns between host commands');

        const settled = await request(settleHandler, 'POST', host, { playerName: host, runId });
        assert.equal(settled.status, 200, JSON.stringify(settled.body));
        assert.equal(settled.body.settled, true);
        assert.ok((settled.body.results as Json)[host]);
        assert.equal(Object.keys(settled.body.results as Json).some(key => key.startsWith('tower-ai')), false);
        assert.equal(await kv.get('save:tower-ai:1'), null, 'settlement cannot mint an AI save');
        assert.equal(await kv.get('battle-lock:tower-ai:1'), null, 'settlement cannot mint an AI combat lease');
        assert.equal(await kv.get(`battle-lock:${host}`), null);
        assert.equal(await kv.get(`tower-party-player:${host}`), null);
        const replay = await request(settleHandler, 'POST', host, { playerName: host, runId });
        assert.equal(replay.status, 200);
        assert.equal(replay.body.settled, true);
        assert.ok(pushed.some(event => event.payload.channel === 'session' && event.payload.reason === 'settled'));
        assert.equal(pushed.some(event => event.room.includes('tower-ai')), false, 'AI IDs never receive realtime player-room traffic');
    });
});

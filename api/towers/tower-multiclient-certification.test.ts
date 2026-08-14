import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { TowerPvpMatchView } from '../../shared/tower-pvp.js';
import type { TowerSession } from './_tower-session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.ADMIN_PASSWORD = 'tower-four-client-cert-admin';
delete process.env.SESSION_SECRET;
delete process.env.TOWER_MODE_DISABLED;

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;
type HttpResult = { status: number; body: Json };
type MatchView = TowerPvpMatchView<TowerSession>;

const PLAYERS = ['alpha', 'bravo', 'charlie', 'delta'] as const;
const FORBIDDEN_PUSH_FIELDS = [
    'roster', 'combat', 'actors', 'session', 'character', 'inviteCode', 'password', 'token',
] as const;

let kv: typeof import('../_storage.js').kv;
let queueHandler: Handler;
let stateHandler: Handler;
let actionHandler: Handler;
let settleHandler: Handler;
let startHandler: Handler;
let setRealtimeEmitter: typeof import('../_realtime/notify.js').setRealtimeEmitter;
let createTowerParty: typeof import('./_party.js').createTowerParty;
let addGenericTowerAi: typeof import('./_party.js').addGenericTowerAi;
let setTowerPartyReady: typeof import('./_party.js').setTowerPartyReady;
let towerPvpMatchKey: typeof import('./_pvp-store.js').towerPvpMatchKey;
let towerPvpPlayerKey: typeof import('./_pvp-store.js').towerPvpPlayerKey;
let towerPvpMember: typeof import('./_pvp-session.js').towerPvpMember;
let battleLockKey: typeof import('./_battle-lease.js').battleLockKey;
let TURN_AFK_MS: typeof import('./_tower-mp.js').TURN_AFK_MS;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    queueHandler = (await import('./pvp-queue.js')).default as unknown as Handler;
    stateHandler = (await import('./pvp-state.js')).default as unknown as Handler;
    actionHandler = (await import('./pvp-action.js')).default as unknown as Handler;
    settleHandler = (await import('./pvp-settle.js')).default as unknown as Handler;
    startHandler = (await import('./start.js')).default as unknown as Handler;
    ({ setRealtimeEmitter } = await import('../_realtime/notify.js'));
    ({ createTowerParty, addGenericTowerAi, setTowerPartyReady } = await import('./_party.js'));
    ({ towerPvpMatchKey, towerPvpPlayerKey } = await import('./_pvp-store.js'));
    ({ towerPvpMember } = await import('./_pvp-session.js'));
    ({ battleLockKey } = await import('./_battle-lease.js'));
    ({ TURN_AFK_MS } = await import('./_tower-mp.js'));
});

beforeEach(async () => {
    setRealtimeEmitter(null);
    for (const prefix of [
        'tower-pvp:*', 'tower:*', 'tower-party:*', 'tower-party-code:*',
        'tower-party-player:*', 'tower-token:*', 'battle-lock:*', 'save:*',
    ]) {
        for (const key of await kv.keys(prefix)) await kv.del(key);
    }
});

after(() => setRealtimeEmitter(null));

function makeResponse(): {
    output: { status: number; body: Json };
    response: never;
} {
    const output: { status: number; body: Json } = { status: 200, body: {} };
    const response = {
        setHeader: () => response,
        status: (status: number) => { output.status = status; return response; },
        json: (body: Json) => { output.body = body; return response; },
        end: () => response,
    };
    return { output, response: response as never };
}

async function request(
    handler: Handler,
    method: 'GET' | 'POST',
    input: Json,
): Promise<HttpResult> {
    const { output, response } = makeResponse();
    await handler({
        method,
        ...(method === 'GET' ? { query: input } : { body: input, query: {} }),
        headers: { 'x-admin-password': process.env.ADMIN_PASSWORD! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, response);
    return output;
}

function fighterSave(name: string, offset = 0): Json {
    return {
        _saveVersion: 12,
        character: {
            name,
            level: 50 + offset,
            ryo: 84_000 + offset,
            fateShards: 17 + offset,
            battleTowerClearedFloors: [1, 2, 3],
            maxHp: 2_800 + offset * 10,
            maxChakra: 600,
            maxStamina: 600,
            specialty: 'Taijutsu',
            stats: {
                strength: 340 + offset,
                speed: 325 + offset,
                taijutsuOffense: 940 + offset,
                taijutsuDefense: 860,
                bukijutsuDefense: 800,
                genjutsuDefense: 800,
                ninjutsuDefense: 800,
            },
            equippedJutsuIds: [],
            inventory: [],
            equipment: {},
        },
        savedBloodlines: [],
        creatorJutsus: [],
    };
}

async function seedPlayers(players: readonly string[] = PLAYERS): Promise<Map<string, Json>> {
    const snapshots = new Map<string, Json>();
    for (const [index, player] of players.entries()) {
        const save = fighterSave(player[0]!.toUpperCase() + player.slice(1), index);
        snapshots.set(player, structuredClone(save));
        await kv.set(`save:${player}`, save);
    }
    return snapshots;
}

function matchFrom(result: HttpResult): MatchView {
    const direct = result.body.match as MatchView | undefined;
    const presence = result.body.presence as { match?: MatchView } | undefined;
    const match = direct ?? presence?.match;
    assert.ok(match, `response has a match: ${JSON.stringify(result.body)}`);
    return match;
}

function activeSlug(match: MatchView): string {
    const actorId = match.combat.turnQueue[match.combat.activeIndex];
    const member = match.roster.find(candidate => candidate.actorId === actorId);
    assert.ok(member, `active actor ${actorId ?? '<none>'} belongs to the roster`);
    return member.slug;
}

function requestId(label: string, index = 0): string {
    return `${label}-${String(index).padStart(8, '0')}`;
}

async function state(player: string, matchId: string): Promise<HttpResult> {
    return request(stateHandler, 'GET', { playerName: player, matchId });
}

async function waitTurn(match: MatchView, tokenIndex: number): Promise<HttpResult> {
    return request(actionHandler, 'POST', {
        playerName: activeSlug(match),
        matchId: match.matchId,
        type: 'wait',
        moveToken: requestId('wait-token', tokenIndex),
        expectedVersion: match.version,
    });
}

async function forceCurrentTurnExpired(matchId: string): Promise<void> {
    const key = towerPvpMatchKey(matchId);
    const stored = await kv.get<MatchView>(key);
    assert.ok(stored, 'authoritative MPvP match exists');
    stored.combat.turnStartedAt = Date.now() - TURN_AFK_MS - 50;
    assert.equal(await kv.set(key, stored, { ex: 2 * 60 * 60 }), 'OK');
}

function assertViewerProjection(match: MatchView, player: string): void {
    const member = match.roster.find(candidate => candidate.slug === player);
    assert.ok(member);
    assert.deepEqual(match.viewer, { teamId: member.teamId, actorId: member.actorId });
    const actor = match.combat.actors.find(candidate => candidate.id === member.actorId);
    assert.equal(actor?.side, 'squad', `${player} sees their own fighter on the squad side`);
    const teammate = match.roster.find(candidate => candidate.teamId === member.teamId && candidate.slug !== player);
    const teammateActor = match.combat.actors.find(candidate => candidate.id === teammate?.actorId);
    assert.equal(teammateActor?.side, 'squad', `${player} sees their teammate on the squad side`);
}

describe('Battle Towers four-client release certification', { concurrency: false }, () => {
    it('certifies exact 2v2 queue, revisions, reconnect, AFK, terminal settlement, and cleanup', async () => {
        const originalSaves = await seedPlayers();
        const pushed: Array<{ room: string; event: string; payload: Json }> = [];
        setRealtimeEmitter((room, event, payload) => pushed.push({ room, event, payload: payload as Json }));

        let latest: MatchView | null = null;
        const joinedTogether = await Promise.all(PLAYERS.map((player, index) =>
            request(queueHandler, 'POST', {
                action: 'join',
                playerName: player,
                requestId: requestId(`queue-${player}`, index),
            })));
        for (const joined of joinedTogether) {
            assert.equal(joined.status, 200, JSON.stringify(joined.body));
            const presence = joined.body.presence as { state: string; queuePosition: number | null };
            if (presence.state === 'queued') {
                assert.ok(Number.isInteger(presence.queuePosition));
                assert.ok(Number(presence.queuePosition) >= 1 && Number(presence.queuePosition) <= 3);
            } else {
                assert.equal(presence.state, 'matched');
                latest = matchFrom(joined);
            }
        }
        if (!latest) {
            // A joining request may finish its post-lock presence read before the
            // fourth request publishes. The authenticated GET is the same recovery
            // path a real client uses after a dropped or delayed queue response.
            for (const player of PLAYERS) {
                const reconnected = await request(queueHandler, 'GET', { playerName: player });
                const presence = reconnected.body.presence as { state: string };
                if (presence.state === 'matched') {
                    latest = matchFrom(reconnected);
                    break;
                }
            }
        }
        assert.ok(latest);
        const matchId = latest.matchId;
        assert.equal(latest.status, 'ready');
        assert.equal(latest.contractVersion, 1);
        assert.equal(latest.roster.length, 4);
        assert.equal(new Set(latest.roster.map(member => member.slug)).size, 4);
        assert.equal(new Set(latest.roster.map(member => member.actorId)).size, 4);
        assert.equal(latest.roster.filter(member => member.teamId === 'amber').length, 2);
        assert.equal(latest.roster.filter(member => member.teamId === 'violet').length, 2);
        assert.deepEqual(latest.rules, {
            teamSize: 2,
            consumables: 'disabled',
            rewards: 'none',
            afkStrikesToForfeit: 2,
        });

        // A lost queue response is recoverable through each client's own presence.
        for (const player of PLAYERS) {
            const reconnected = await request(queueHandler, 'GET', { playerName: player });
            assert.equal(reconnected.status, 200, JSON.stringify(reconnected.body));
            const view = matchFrom(reconnected);
            assert.equal(view.matchId, matchId);
            assertViewerProjection(view, player);
            const lease = await kv.get<{ battleId: string; meta: { mode?: string } }>(battleLockKey(player));
            assert.equal(lease?.battleId, matchId);
            assert.equal(lease?.meta.mode, 'mpvp');
        }

        // Optimistic readiness: prove stale rejection, then prove lost-ack replay.
        const alphaReady = await request(queueHandler, 'POST', {
            action: 'ready', playerName: 'alpha', matchId, ready: true,
            requestId: requestId('ready-alpha'), expectedVersion: latest.version,
        });
        assert.equal(alphaReady.status, 200, JSON.stringify(alphaReady.body));
        latest = matchFrom(alphaReady);

        const staleReady = await request(queueHandler, 'POST', {
            action: 'ready', playerName: 'bravo', matchId, ready: true,
            requestId: requestId('ready-bravo-stale'), expectedVersion: latest.version - 1,
        });
        assert.equal(staleReady.status, 409);
        assert.equal(staleReady.body.errorCode, 'stale-version');

        const bravoReady = await request(queueHandler, 'POST', {
            action: 'ready', playerName: 'bravo', matchId, ready: true,
            requestId: requestId('ready-bravo'), expectedVersion: latest.version,
        });
        assert.equal(bravoReady.status, 200, JSON.stringify(bravoReady.body));
        latest = matchFrom(bravoReady);

        const charlieCommand = {
            action: 'ready', playerName: 'charlie', matchId, ready: true,
            requestId: requestId('ready-charlie-lost'), expectedVersion: latest.version,
        };
        const charlieCommitted = await request(queueHandler, 'POST', charlieCommand);
        assert.equal(charlieCommitted.status, 200, JSON.stringify(charlieCommitted.body));
        const committedReadyVersion = matchFrom(charlieCommitted).version;
        const charlieReplay = await request(queueHandler, 'POST', charlieCommand);
        assert.equal(charlieReplay.status, 200, JSON.stringify(charlieReplay.body));
        assert.equal(charlieReplay.body.replayed, true);
        assert.equal(matchFrom(charlieReplay).version, committedReadyVersion);
        latest = matchFrom(charlieReplay);

        const deltaReady = await request(queueHandler, 'POST', {
            action: 'ready', playerName: 'delta', matchId, ready: true,
            requestId: requestId('ready-delta'), expectedVersion: latest.version,
        });
        assert.equal(deltaReady.status, 200, JSON.stringify(deltaReady.body));
        latest = matchFrom(deltaReady);
        assert.equal(latest.status, 'active');
        assert.equal(latest.roster.every(member => member.ready), true);
        assert.ok(Number.isFinite(latest.turnDeadlineAt));
        assert.ok(Number(latest.turnDeadlineAt) > Date.now(), 'active viewer receives the authoritative AFK deadline');

        // One successful action response is deliberately discarded. Retrying the
        // same move token must replay without advancing state a second time.
        const firstActor = activeSlug(latest);
        const lostAction = {
            playerName: firstActor,
            matchId,
            type: 'wait',
            moveToken: requestId('lost-action-token'),
            expectedVersion: latest.version,
        };
        const committedAction = await request(actionHandler, 'POST', lostAction);
        assert.equal(committedAction.status, 200, JSON.stringify(committedAction.body));
        assert.equal(committedAction.body.applied, true);
        assert.equal(committedAction.body.replayed, false);
        const committedActionVersion = matchFrom(committedAction).version;
        const replayedAction = await request(actionHandler, 'POST', lostAction);
        assert.equal(replayedAction.status, 200, JSON.stringify(replayedAction.body));
        assert.equal(replayedAction.body.applied, true);
        assert.equal(replayedAction.body.replayed, true);
        assert.equal(matchFrom(replayedAction).version, committedActionVersion);
        latest = matchFrom(replayedAction);

        const secondActor = activeSlug(latest);
        const staleAction = await request(actionHandler, 'POST', {
            playerName: secondActor,
            matchId,
            type: 'wait',
            moveToken: requestId('stale-action-token'),
            expectedVersion: latest.version - 1,
        });
        assert.equal(staleAction.status, 409);
        assert.equal(staleAction.body.reason, 'stale-version');

        // Reconnect is the recovery source of truth; retry from that projection.
        const recovered = await state(secondActor, matchId);
        assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
        latest = matchFrom(recovered);
        assertViewerProjection(latest, secondActor);
        const recoveredAction = await request(actionHandler, 'POST', {
            playerName: secondActor,
            matchId,
            type: 'wait',
            moveToken: requestId('recovered-action-token'),
            expectedVersion: latest.version,
        });
        assert.equal(recoveredAction.status, 200, JSON.stringify(recoveredAction.body));
        latest = matchFrom(recoveredAction);

        // Exercise a complete four-controller rotation, always obeying authority's active actor.
        const acted = new Set<string>([firstActor, secondActor]);
        for (let index = 0; acted.size < 4 && index < 8; index++) {
            acted.add(activeSlug(latest));
            const turn = await waitTurn(latest, 100 + index);
            assert.equal(turn.status, 200, JSON.stringify(turn.body));
            assert.equal(turn.body.applied, true);
            latest = matchFrom(turn);
        }
        assert.deepEqual([...acted].sort(), [...PLAYERS].sort(), 'all four authenticated controllers took a turn');

        // First expired turn passes. The same player's second uncorrected expiry
        // defeats only that actor; teammates remain independently controllable.
        const afkPlayer = activeSlug(latest);
        const afkMember = towerPvpMember(latest, afkPlayer)!;
        await forceCurrentTurnExpired(matchId);
        const firstExpiry = await state(afkPlayer, matchId);
        assert.equal(firstExpiry.status, 200, JSON.stringify(firstExpiry.body));
        latest = matchFrom(firstExpiry);
        assert.equal(latest.afkStrikes[afkPlayer], 1);
        assert.ok(latest.combat.actors.find(actor => actor.id === afkMember.actorId)!.hp > 0);

        for (let index = 0; activeSlug(latest) !== afkPlayer && index < 8; index++) {
            const turn = await waitTurn(latest, 200 + index);
            assert.equal(turn.status, 200, JSON.stringify(turn.body));
            latest = matchFrom(turn);
        }
        assert.equal(activeSlug(latest), afkPlayer, 'the AFK controller reaches its next-round turn');
        await forceCurrentTurnExpired(matchId);
        const secondExpiry = await state(afkPlayer, matchId);
        assert.equal(secondExpiry.status, 200, JSON.stringify(secondExpiry.body));
        latest = matchFrom(secondExpiry);
        assert.equal(latest.afkStrikes[afkPlayer], 2);
        assert.equal(latest.combat.actors.find(actor => actor.id === afkMember.actorId)?.hp, 0);
        assert.equal(latest.status, 'active', 'one AFK member does not defeat their teammate');

        const teammate = latest.roster.find(member =>
            member.teamId === afkMember.teamId && member.slug !== afkPlayer)!;
        const forfeited = await request(actionHandler, 'POST', {
            playerName: teammate.slug,
            matchId,
            type: 'forfeit',
            moveToken: requestId('teammate-forfeit-token'),
            expectedVersion: latest.version,
        });
        assert.equal(forfeited.status, 200, JSON.stringify(forfeited.body));
        latest = matchFrom(forfeited);
        assert.equal(latest.status, 'done');
        assert.equal(latest.winner, afkMember.teamId === 'amber' ? 'violet' : 'amber');

        // Terminal projection releases every participant lease before settlement.
        for (const player of PLAYERS) assert.equal(await kv.get(battleLockKey(player)), null);

        for (const player of PLAYERS) {
            const settled = await request(settleHandler, 'POST', { playerName: player, matchId });
            assert.equal(settled.status, 200, JSON.stringify(settled.body));
            assert.equal(settled.body.settled, true);
            assert.equal(settled.body.progressionApplied, false);
            assert.deepEqual(settled.body.rewards, { ryo: 0, xp: 0, fateShards: 0, rating: 0 });
            latest = matchFrom(settled);
            assertViewerProjection(latest, player);
        }
        const settlementReplay = await request(settleHandler, 'POST', { playerName: 'alpha', matchId });
        assert.equal(settlementReplay.status, 200, JSON.stringify(settlementReplay.body));
        assert.equal(settlementReplay.body.replayed, true);

        // No MPvP endpoint may mutate economy, Tower progression, or any save field.
        for (const player of PLAYERS) {
            assert.deepEqual(await kv.get(`save:${player}`), originalSaves.get(player));
        }

        // Close each terminal client pointer using current optimistic state, then
        // prove that every account can return to an idle lobby cleanly.
        for (const [index, player] of PLAYERS.entries()) {
            const current = await state(player, matchId);
            assert.equal(current.status, 200, JSON.stringify(current.body));
            const closed = await request(queueHandler, 'POST', {
                action: 'leave', playerName: player, matchId,
                requestId: requestId(`close-${player}`, index),
                expectedVersion: matchFrom(current).version,
            });
            assert.equal(closed.status, 200, JSON.stringify(closed.body));
            assert.equal((closed.body.presence as { state: string }).state, 'idle');
            latest = matchFrom(closed);
        }
        for (const player of PLAYERS) {
            assert.equal(await kv.get(towerPvpPlayerKey(player)), null);
            assert.equal(await kv.get(battleLockKey(player)), null);
        }

        // Socket events are non-sensitive hints only. Each reason is backed by a
        // durable HTTP reconciliation exercised above, so loss/reconnect is safe.
        const pvpHints = pushed.filter(event => event.event === 'tower:kick' && event.payload.channel === 'pvp');
        const reasons = new Set(pvpHints.map(event => event.payload.reason));
        for (const reason of ['queued', 'matched', 'ready', 'action', 'settled', 'closed']) {
            assert.ok(reasons.has(reason), `realtime contract emitted ${reason}`);
        }
        for (const player of PLAYERS) {
            assert.ok(pvpHints.some(event => event.room === `user:${player}`), `${player} received a revision hint`);
        }
        for (const hint of pvpHints) {
            assert.deepEqual(
                Object.keys(hint.payload).sort(),
                hint.payload.reason === 'queued'
                    ? ['channel', 'reason']
                    : ['channel', 'matchId', 'reason', 'version'],
            );
            if (hint.payload.reason !== 'queued') {
                assert.equal(hint.payload.matchId, matchId);
                assert.ok(Number.isSafeInteger(hint.payload.version));
            }
            const wire = JSON.stringify(hint.payload);
            for (const forbidden of FORBIDDEN_PUSH_FIELDS) {
                assert.equal(wire.includes(forbidden), false, `${forbidden} never enters realtime hints`);
            }
        }
        for (const player of PLAYERS) {
            const versions = pvpHints
                .filter(event => event.room === `user:${player}` && event.payload.reason !== 'queued')
                .map(event => Number(event.payload.version));
            for (let index = 1; index < versions.length; index++) {
                assert.ok(versions[index]! >= versions[index - 1]!, `${player}'s revision hints never move backward`);
            }
        }
    });

    it('launches Story with one intentionally weak ownerless recruit and only one human lease', async () => {
        await seedPlayers(['host']);
        const created = await createTowerParty({
            hostSlug: 'host', displayName: 'Host', binding: { mode: 'story', floor: 1 },
        });
        assert.equal(created.ok, true);
        if (!created.ok) return;
        const added = await addGenericTowerAi({
            partyId: created.party.id,
            actor: 'host',
            requestId: requestId('story-add-ai'),
            expectedVersion: created.party.version,
            fingerprint: 'cert-add-ai',
        });
        assert.equal(added.ok, true);
        if (!added.ok) return;
        const readied = await setTowerPartyReady({
            partyId: created.party.id,
            actor: 'host',
            ready: true,
            requestId: requestId('story-ready-host'),
            expectedVersion: added.party.version,
            fingerprint: 'cert-ready-host',
        });
        assert.equal(readied.ok, true);
        if (!readied.ok) return;

        const pushed: Array<{ room: string; event: string; payload: Json }> = [];
        setRealtimeEmitter((room, event, payload) => pushed.push({ room, event, payload: payload as Json }));
        const launched = await request(startHandler, 'POST', {
            hostName: 'host',
            mode: 'story',
            floor: 1,
            partyId: created.party.id,
            requestId: requestId('story-launch-ai'),
            expectedVersion: readied.party.version,
        });
        assert.equal(launched.status, 200, JSON.stringify(launched.body));
        const session = launched.body.session as TowerSession;
        const human = session.actors.find(actor => actor.ownerSlug === 'host');
        const recruit = session.actors.find(actor => actor.character.towerGenericAiProfile === 'story-recruit-v1');
        assert.equal(session.partySize, 2);
        assert.equal(human?.ai, false);
        assert.equal(recruit?.ai, true);
        assert.equal(recruit?.ownerSlug, null);
        assert.equal(recruit?.character.towerRewardEligibility, 'none');
        assert.equal((recruit?.character.jutsu as unknown[])?.length, 1);
        assert.ok(Number((recruit?.character.stats as Json)?.taijutsuOffense) <= 440);
        assert.notEqual(await kv.get(battleLockKey('host')), null);
        assert.equal(await kv.get(battleLockKey('tower-ai1')), null);
        assert.ok(pushed.some(event =>
            event.room === 'user:host'
            && event.event === 'tower:kick'
            && event.payload.channel === 'session'
            && event.payload.reason === 'started'));
        assert.equal(pushed.some(event => event.room.includes('tower-ai')), false);
    });
});

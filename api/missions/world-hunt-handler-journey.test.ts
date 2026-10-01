import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'world-hunt-handler-journey-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const MISSION_ID = 'hunt-wild-boar';
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let readSoloPveSession: typeof import('../solo-pve/_store.js').readSoloPveSession;
let writeSoloPveSession: typeof import('../solo-pve/_store.js').writeSoloPveSession;
let huntMissionById: typeof import('./_mission-catalog.js').huntMissionById;
let deterministicHuntAmbush: typeof import('./_hunt-trail.js').deterministicHuntAmbush;
let serverHuntSign: typeof import('./_hunt-trail.js').serverHuntSign;
let trailHandler: Handler;
let startHandler: Handler;
let reportHandler: Handler;
let claimHandler: Handler;
let actionHandler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ readSoloPveSession, writeSoloPveSession } = await import('../solo-pve/_store.js'));
    ({ huntMissionById } = await import('./_mission-catalog.js'));
    ({ deterministicHuntAmbush, serverHuntSign } = await import('./_hunt-trail.js'));
    trailHandler = (await import('./hunt-trail.js')).default as unknown as Handler;
    startHandler = (await import('./ai-fight-start.js')).default as unknown as Handler;
    reportHandler = (await import('./report-ai-fight.js')).default as unknown as Handler;
    claimHandler = (await import('./claim-mission.js')).default as unknown as Handler;
    actionHandler = (await import('../solo-pve/action.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [
        'save:huntjourney*',
        'missions:progress:huntjourney*',
        'missions:newbie-daily:huntjourney*',
        'ai-fight-token:huntjourney*',
        'world-ai-active:huntjourney*',
        'world-ai-chain:huntjourney*',
        'solo-pve:ai-fight:huntjourney*',
        'legacy:stats:huntjourney*',
        'ratelimit:*huntjourney*',
        'lock:*huntjourney*',
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
        socket: { remoteAddress: `127.4.0.${playerName.length}` },
    } as never, output.res);
    return output.out;
}

async function seedPlayer(playerName: string) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: 1,
        acceptedMissionIds: [],
        missionProgress: {},
        savedBloodlines: [],
        creatorJutsus: [],
        character: {
            name: playerName,
            level: 20,
            hunterRank: 1,
            rankTitle: 'Genin',
            specialty: 'Ninjutsu',
            hp: 600,
            maxHp: 600,
            chakra: 300,
            maxChakra: 300,
            stamina: 300,
            maxStamina: 300,
            ryo: 50,
            inventory: [],
            itemStacks: [],
            unspentStats: 0,
            stats: {
                strength: 100,
                speed: 100,
                intelligence: 140,
                willpower: 120,
                ninjutsuOffense: 300,
                ninjutsuDefense: 250,
                taijutsuOffense: 100,
                taijutsuDefense: 100,
                bukijutsuOffense: 100,
                bukijutsuDefense: 100,
                genjutsuOffense: 100,
                genjutsuDefense: 100,
            },
            equippedJutsuIds: ['starter-universal-flicker'],
        },
    });
}

async function patchSave(playerName: string, patcher: (save: Record<string, unknown>) => Record<string, unknown>) {
    const key = `save:${playerName}`;
    const save = await kv.get<Record<string, unknown>>(key);
    assert.ok(save);
    await kv.set(key, patcher(save));
}

async function moveTo(playerName: string, sector: number) {
    await patchSave(playerName, (save) => ({ ...save, currentSector: sector }));
}

async function terminalize(sessionId: string, outcome: 'win' | 'loss', suffix: string) {
    const session = await readSoloPveSession(sessionId);
    assert.ok(session);
    const winner = outcome === 'win' ? 'player' as const : 'enemy' as const;
    const nextVersion = session.version + 1;
    if (session.huntCombat) {
        const battle = session.huntCombat.battle;
        battle.status = 'done';
        battle.winner = outcome === 'win' ? 'squad' : 'enemy';
        battle.actors.forEach(actor => { actor.hp = actor.id === 'player' ? (outcome === 'win' ? 420 : 180) : outcome === 'win' ? 0 : actor.hp; });
        if (outcome === 'win') delete battle.pendingEnemyWaves;
    }
    await writeSoloPveSession({
        ...session,
        player: { ...session.player, hp: outcome === 'win' ? 420 : 180 },
        enemy: { ...session.enemy, hp: outcome === 'win' ? 0 : session.enemy.hp },
        status: 'done',
        winner,
        outcome,
        settlementState: 'pending',
        version: nextVersion,
        terminalEvidence: {
            finishedAt: Date.now(),
            finalMoveToken: `hunt-${suffix}-terminal`,
            finalVersion: nextVersion,
            finalEventSeq: session.eventSeq,
            winner,
            outcome,
            itemsUsed: { ...session.itemsUsed },
            settlementState: 'pending',
        },
    });
}

/** A small server-owned fixture, then only authenticated combat commands. */
async function playHuntToVictory(player: string, sessionId: string) {
    let session = await readSoloPveSession(sessionId);
    assert.ok(session?.huntCombat);
    const battle = session.huntCombat.battle;
    battle.actors.find(actor => actor.id === 'player')!.character.jutsu = [{ id: 'journey-sweep', name: 'Sweep', type: 'Taijutsu', target: 'OPPONENT',
        method: 'AOE_BURST', effectPower: 5000, ap: 100, range: 30, chakraCost: 0, staminaCost: 0, cooldown: 0, tags: [] }];
    for (const actor of [...battle.actors, ...(battle.pendingEnemyWaves ?? []).flatMap(wave => wave.actors)]) {
        if (actor.side === 'enemy') actor.hp = 1;
    }
    await writeSoloPveSession(session);
    let lastCommand: Record<string, unknown> = {};
    for (let step = 0; session.status === 'active' && step < 20; step++) {
        const current = session.huntCombat!.battle;
        const enemy = current.actors.find(actor => actor.side === 'enemy' && actor.hp > 0);
        lastCommand = { sessionId, expectedVersion: session.version, moveToken: `hunt-journey-move-${step}`, type: 'huntAction',
            action: enemy && current.activeAp >= 100 ? { type: 'jutsu', jutsuId: 'journey-sweep', targetId: enemy.id } : { type: 'wait' } };
        const result = await post(actionHandler, player, lastCommand);
        assert.equal(result.statusCode, 200, JSON.stringify(result.body));
        assert.equal(result.body?.applied, true, JSON.stringify(result.body));
        session = (await readSoloPveSession(sessionId))!;
    }
    assert.equal(session.outcome, 'win');
    assert.equal(session.terminalEvidence?.outcome, 'win');
    assert.equal(session.huntCombat!.battle.status, 'done');
    const replay = await post(actionHandler, player, lastCommand);
    assert.equal(replay.body?.duplicate, true);
    assert.equal((await readSoloPveSession(sessionId))?.version, session.version);
}

function state(out: Out): Record<string, unknown> {
    const value = out.body?.state;
    assert.ok(value && typeof value === 'object');
    return value as Record<string, unknown>;
}

function findEarlyAmbushRoute(playerName: string) {
    const sign0 = serverHuntSign(MISSION_ID, 0, playerName);
    const sign1 = serverHuntSign(MISSION_ID, 1, playerName);
    const advancing0 = sign0.choices.filter((choice) => choice.outcome.advances);
    const advancing1 = sign1.choices.filter((choice) => choice.outcome.advances);
    for (let index = 0; index < 20_000; index += 1) {
        const runId = `huntjourneyrun${String(index).padStart(8, '0')}`;
        for (const first of advancing0) {
            if (!deterministicHuntAmbush(playerName, runId, 0, first.id, first.outcome.ambushChance)) continue;
            const second = advancing1.find((choice) => !deterministicHuntAmbush(
                playerName,
                runId,
                1,
                choice.id,
                choice.outcome.ambushChance,
            ));
            if (second) return { runId, firstChoiceId: first.id, secondChoiceId: second.id };
        }
    }
    throw new Error('Could not find deterministic early-ambush route for test player.');
}

async function startWorld(playerName: string, worldEncounter: Record<string, unknown>) {
    const started = await post(startHandler, playerName, { worldEncounter });
    assert.equal(started.statusCode, 200, JSON.stringify(started.body));
    assert.equal(started.body?.resumed, false);
    assert.match(String(started.body?.token), /^[A-Za-z0-9]{16,96}$/);
    assert.match(String(started.body?.sessionId), /^[A-Za-z0-9:_-]{8,96}$/);
    return started;
}

async function prepareEarlyPack(player: string) {
    await seedPlayer(player);
    const accepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
    assert.equal(accepted.statusCode, 200);
    const route = findEarlyAmbushRoute(player);
    await patchSave(player, (save) => {
        const character = save.character as Record<string, unknown>;
        const trails = character.serverHuntTrails as Record<string, Record<string, unknown>>;
        return {
            ...save,
            character: {
                ...character,
                serverHuntTrails: {
                    ...trails,
                    [MISSION_ID]: { ...trails[MISSION_ID], runId: route.runId },
                },
            },
        };
    });
    const initial = await post(trailHandler, player, { missionId: MISSION_ID, action: 'state' });
    const sector = Number(state(initial).sector);
    await moveTo(player, sector);
    const choice = await post(trailHandler, player, {
        missionId: MISSION_ID,
        action: 'choose',
        sector,
        choiceId: route.firstChoiceId,
    });
    assert.equal(choice.statusCode, 200);
    assert.equal(choice.body?.ambush, true);
    return {
        route,
        request: {
            kind: 'hunt-pack',
            sourceId: MISSION_ID,
            sector: Number(choice.body?.sector),
            stage: 0,
            decisionId: String(choice.body?.decisionId),
        } as Record<string, unknown>,
    };
}

describe('sealed hunt handler journey', () => {
    it('closes active combat when abandoning and cannot apply its late result to a reaccepted hunt', async () => {
        const player = 'huntjourneyactiveabandon';
        const prepared = await prepareEarlyPack(player);
        const started = await startWorld(player, prepared.request);
        const abandoned = await post(trailHandler, player, { missionId: MISSION_ID, action: 'abandon' });
        assert.equal(abandoned.statusCode, 200, JSON.stringify(abandoned.body));
        const closed = await readSoloPveSession(String(started.body?.sessionId));
        assert.equal(closed?.status, 'done');
        assert.equal(closed?.huntCombat?.battle.status, 'done');
        assert.equal(closed?.outcome, 'loss');
        assert.equal(await kv.get(`world-ai-active:${player}`), null);
        const repeated = await post(trailHandler, player, { missionId: MISSION_ID, action: 'abandon' });
        assert.equal(repeated.statusCode, 200);
        assert.equal((await readSoloPveSession(String(started.body?.sessionId)))?.player.hp, closed?.player.hp);
        const accepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        const newRun = state(accepted);
        assert.notEqual(newRun.runId, prepared.route.runId);
        const report = await post(reportHandler, player, { aiFightToken: started.body?.token });
        assert.equal(report.statusCode, 200, JSON.stringify(report.body));
        const current = await post(trailHandler, player, { missionId: MISSION_ID, action: 'state' });
        assert.equal(state(current).runId, newRun.runId);
        assert.equal(state(current).progress, 0);
        assert.equal(state(current).quality, 0);
        assert.equal(state(current).targetDefeated, false);
        assert.equal(state(current).packSettled, false);
    });

    it('abandons a hunt by clearing its accepted run, progress, trail, and receipt', async () => {
        const player = 'huntjourneyabandon';
        await seedPlayer(player);
        const accepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.equal(accepted.statusCode, 200);
        const abandonedRun = state(accepted);
        const receiptKey = `missions:progress:${player}:${MISSION_ID}`;
        await kv.set(receiptKey, {
            playerName: player,
            missionId: MISSION_ID,
            missionType: 'hunt',
            exploreCount: 2,
            raidCount: 0,
            huntKill: false,
            evidenceIds: ['huntabandonproof0001'],
            updatedAt: Date.now(),
        });

        const abandoned = await post(trailHandler, player, { missionId: MISSION_ID, action: 'abandon' });
        assert.equal(abandoned.statusCode, 200);
        assert.equal(abandoned.body?.state, null);
        assert.deepEqual(abandoned.body?.acceptedMissionIds, []);
        assert.equal((abandoned.body?.missionProgress as Record<string, unknown>)[MISSION_ID], 0);
        assert.equal(await kv.get(receiptKey), null);
        const saved = await kv.get<Record<string, unknown>>(`save:${player}`);
        const character = saved?.character as Record<string, unknown>;
        assert.deepEqual(character.serverHuntTrails, {});

        const reaccepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.equal(reaccepted.statusCode, 200);
        assert.notEqual(state(reaccepted).runId, abandonedRun.runId);
        assert.equal((reaccepted.body?.missionProgress as Record<string, unknown>)[MISSION_ID], 0);
    });

    it('accepts repeat hunts while keeping each kill claim idempotent', async () => {
        const player = 'huntjourneycomplete';
        await seedPlayer(player);
        const accepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.equal(accepted.statusCode, 200);
        const route = findEarlyAmbushRoute(player);
        await patchSave(player, (save) => {
            const character = save.character as Record<string, unknown>;
            const trails = character.serverHuntTrails as Record<string, Record<string, unknown>>;
            return {
                ...save,
                character: {
                    ...character,
                    serverHuntTrails: {
                        ...trails,
                        [MISSION_ID]: { ...trails[MISSION_ID], runId: route.runId },
                    },
                },
            };
        });

        const firstState = await post(trailHandler, player, { missionId: MISSION_ID, action: 'state' });
        await moveTo(player, Number(state(firstState).sector));
        const firstChoice = await post(trailHandler, player, {
            missionId: MISSION_ID,
            action: 'choose',
            sector: Number(state(firstState).sector),
            choiceId: route.firstChoiceId,
        });
        assert.equal(firstChoice.statusCode, 200);
        assert.equal(firstChoice.body?.ambush, true);
        assert.equal(firstChoice.body?.progress, 1);
        const decisionId = String(firstChoice.body?.decisionId);
        const packSector = Number(firstChoice.body?.sector);

        const pack = await startWorld(player, {
            kind: 'hunt-pack',
            sourceId: MISSION_ID,
            sector: packSector,
            stage: 0,
            decisionId,
        });
        const packResume = await post(startHandler, player, { resumeWorldFight: true });
        assert.equal(packResume.statusCode, 200);
        assert.equal(packResume.body?.token, pack.body?.token);
        assert.equal(packResume.body?.resumed, true);
        await terminalize(String(pack.body?.sessionId), 'loss', 'pack-loss');
        const packLoss = await post(reportHandler, player, { aiFightToken: pack.body?.token });
        assert.equal(packLoss.statusCode, 200, JSON.stringify(packLoss.body));
        assert.equal(packLoss.body?.outcome, 'loss');
        assert.equal((packLoss.body?.worldContext as Record<string, unknown>).kind, 'hunt-pack');
        const packLossReplay = await post(reportHandler, player, { aiFightToken: pack.body?.token });
        assert.equal(packLossReplay.statusCode, 200);
        assert.equal(packLossReplay.body?.outcome, 'loss');
        const afterPack = await post(trailHandler, player, { missionId: MISSION_ID, action: 'state' });
        assert.equal(state(afterPack).packPending, false);
        assert.equal(state(afterPack).packSettled, true);

        await moveTo(player, Number(state(afterPack).sector));
        const secondChoice = await post(trailHandler, player, {
            missionId: MISSION_ID,
            action: 'choose',
            sector: Number(state(afterPack).sector),
            choiceId: route.secondChoiceId,
        });
        assert.equal(secondChoice.statusCode, 200);
        assert.equal(secondChoice.body?.ambush, false);
        assert.equal(secondChoice.body?.progress, 2);
        const ready = state(secondChoice);
        assert.equal(ready.ready, true);
        await moveTo(player, Number(ready.sector));

        const targetDescriptor = { kind: 'hunt-target', sourceId: MISSION_ID, sector: Number(ready.sector) };
        const firstTarget = await startWorld(player, targetDescriptor);
        await terminalize(String(firstTarget.body?.sessionId), 'loss', 'target-loss');
        const targetLoss = await post(reportHandler, player, { aiFightToken: firstTarget.body?.token });
        assert.equal(targetLoss.statusCode, 200, JSON.stringify(targetLoss.body));
        assert.equal(targetLoss.body?.outcome, 'loss');
        const lossState = await post(trailHandler, player, { missionId: MISSION_ID, action: 'state' });
        assert.equal(state(lossState).targetDefeated, false);

        const rematch = await startWorld(player, targetDescriptor);
        assert.notEqual(rematch.body?.token, firstTarget.body?.token);
        assert.deepEqual((rematch.body?.worldContext as Record<string, unknown>)?.huntFormation,
            (firstTarget.body?.worldContext as Record<string, unknown>)?.huntFormation);
        await playHuntToVictory(player, String(rematch.body?.sessionId));
        const targetWin = await post(reportHandler, player, { aiFightToken: rematch.body?.token });
        assert.equal(targetWin.statusCode, 200, JSON.stringify(targetWin.body));
        assert.equal(targetWin.body?.outcome, 'win');
        const winReplay = await post(reportHandler, player, { aiFightToken: rematch.body?.token });
        assert.equal(winReplay.statusCode, 200);
        assert.equal(winReplay.body?.outcome, 'win');
        const wonState = await post(trailHandler, player, { missionId: MISSION_ID, action: 'state' });
        assert.equal(state(wonState).targetDefeated, true);
        assert.equal(state(wonState).claimable, true);
        assert.equal((wonState.body?.missionProgress as Record<string, unknown>)[MISSION_ID], 3);

        const farmAttempt = await post(startHandler, player, { worldEncounter: targetDescriptor });
        assert.equal(farmAttempt.statusCode, 409);
        assert.match(String(farmAttempt.body?.error), /already-defeated/);

        const claim = await post(claimHandler, player, { missionType: 'hunt', missionId: MISSION_ID });
        assert.equal(claim.statusCode, 200, JSON.stringify(claim.body));
        assert.equal(claim.body?.applied, true);
        const paidRyo = Number((claim.body?.character as Record<string, unknown>).ryo);
        assert.ok(paidRyo > 50);
        const claimReplay = await post(claimHandler, player, { missionType: 'hunt', missionId: MISSION_ID });
        assert.equal(claimReplay.statusCode, 200);
        assert.equal(claimReplay.body?.applied, false);
        assert.equal(Number((claimReplay.body?.character as Record<string, unknown>).ryo), paidRyo);
        // Older releases stored one unsuffixed receipt per contract/day. Keep
        // such a receipt from preventing a fresh hunt run after the rollout.
        await patchSave(player, (save) => {
            const character = save.character as Record<string, unknown>;
            const claimed = Array.isArray(character.claimedServerMissions)
                ? character.claimedServerMissions.map(String)
                : [];
            return {
                ...save,
                character: {
                    ...character,
                    claimedServerMissions: [...claimed, `${new Date().toISOString().slice(0, 10)}:hunt:${MISSION_ID}`],
                },
            };
        });
        const reaccept = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.equal(reaccept.statusCode, 200);
        assert.notEqual(reaccept.body?.claimedToday, true);
        assert.ok(reaccept.body?.state);
        assert.equal((reaccept.body?.state as Record<string, unknown>).missionId, MISSION_ID);
    });

    it('rejects a forged generic hunt-kill receipt without the sealed trail target proof', async () => {
        const player = 'huntjourneyforged';
        await seedPlayer(player);
        const accepted = await post(trailHandler, player, { missionId: MISSION_ID, action: 'accept' });
        assert.equal(accepted.statusCode, 200);
        await kv.set(`missions:progress:${player}:${MISSION_ID}`, {
            playerName: player,
            missionId: MISSION_ID,
            missionType: 'hunt',
            exploreCount: 3,
            raidCount: 0,
            huntKill: true,
            evidenceIds: ['forged_generic_hunt_kill'],
            updatedAt: Date.now(),
        });
        const claim = await post(claimHandler, player, { missionType: 'hunt', missionId: MISSION_ID });
        assert.equal(claim.statusCode, 200);
        assert.equal(claim.body?.applied, false);
        assert.equal(claim.body?.reason, 'missing-hunt-kill-receipt');
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        assert.equal((save?.character as Record<string, unknown>).ryo, 50);
    });

    it('recovers one sealed pack encounter and settles the whole formation only once', async () => {
        const player = 'huntjourneypackwin';
        const prepared = await prepareEarlyPack(player);
        const started = await startWorld(player, prepared.request);
        const token = String(started.body?.token);
        const activeReplay = await post(startHandler, player, { worldEncounter: prepared.request });
        assert.equal(activeReplay.statusCode, 200);
        assert.equal(activeReplay.body?.token, token);
        assert.equal(activeReplay.body?.resumed, true, 'retrying an already sealed stage cannot heal or mint twice');
        const original = (started.body?.session as Record<string, unknown>).huntCombat;
        assert.ok(original);
        assert.deepEqual((activeReplay.body?.session as Record<string, unknown>).huntCombat, original);
        const premature = await post(reportHandler, player, { aiFightToken: token });
        assert.equal(premature.statusCode, 409, 'an active formation cannot settle');
        await playHuntToVictory(player, String(started.body?.sessionId));
        const won = await post(reportHandler, player, { aiFightToken: token });
        assert.equal(won.statusCode, 200, JSON.stringify(won.body));
        assert.equal(won.body?.outcome, 'win');
        assert.equal((won.body?.worldContext as Record<string, unknown>).finalStage, true);
        const replay = await post(reportHandler, player, { aiFightToken: token });
        assert.equal(replay.statusCode, 200);
        assert.equal((replay.body?.worldContext as Record<string, unknown>).stage, 0);
        const recovery = await post(startHandler, player, { resumeWorldFight: true });
        assert.equal(recovery.statusCode, 404);
        assert.ok(!recovery.body?.pendingWorldChain);
        const finalState = await post(trailHandler, player, { missionId: MISSION_ID, action: 'state' });
        assert.equal(state(finalState).packPending, false);
        assert.equal(state(finalState).packSettled, true);
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        const character = save?.character as Record<string, unknown>;
        assert.equal((character.worldAiChainWins as unknown[]).length, 1);
        assert.equal((character.worldAiChainHeals as unknown[] | undefined)?.length ?? 0, 0);
    });
});

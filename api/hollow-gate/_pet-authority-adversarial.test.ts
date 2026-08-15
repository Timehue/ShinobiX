import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createShowdownSession, type ShowdownSession } from '../_pet-showdown/engine.js';
import type { Pet } from '../_pet-sim/pet-types.js';
import {
    HOLLOW_GATE_PET_AUTHORITY_VERSION,
    createHollowGateCombatBinding,
    hollowGateCombatBindingKey,
    type HollowGateCombatBinding,
} from './_combat-session.js';
import { hollowGateRunKey, type HollowGateRunToken } from './_run-token.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'hollow-gate-pet-authority-test-secret-32';
process.env.ENABLE_LEGACY = '1';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

let battleStartHandler: Handler;
let battleResultHandler: Handler;
let showdownHandler: Handler;
let combatSettleHandler: Handler;
let runSettleHandler: Handler;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;

const hollowGatePetResultKey = (playerName: string, proofId: string) => `hg-pet-result:${playerName}:${proofId}`;

function response() {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res,
        status: (statusCode: number) => { out.statusCode = statusCode; return res; },
        json: (body: Record<string, unknown>) => { out.body = body; return res; },
        end: () => res,
    };
    return { out, res: res as never };
}

function request(body: Record<string, unknown>, authToken: string, ip: string) {
    return {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json', 'x-player-token': authToken },
        socket: { remoteAddress: ip },
    } as never;
}

function playerPet(id: string): Pet {
    return {
        id,
        name: `Sentinel ${id}`,
        nickname: `Sentinel ${id}`,
        rarity: 'rare',
        element: 'Fire',
        role: 'assassin',
        level: 70,
        xp: 0,
        maxLevel: 100,
        hp: 12_000,
        attack: 12_000,
        defense: 12_000,
        speed: 1_200,
        unlockedForPve: true,
        jutsus: [{ name: 'Ember Verdict', power: 500, cooldown: 1, currentCooldown: 0, kind: 'damage' }],
    } as unknown as Pet;
}

async function installPetEncounter(params: {
    playerName: string;
    runToken: string;
    runId: string;
    pet: Pet;
    legacyUnclaimed?: boolean;
}) {
    const binding = createHollowGateCombatBinding({
        playerName: params.playerName,
        token: params.runToken,
        floor: 1,
        nodeId: 'floor:1:tile:7',
        kind: 'beast',
        combatMode: 'pet',
        runId: params.runId,
        now: Date.now(),
    });
    if (params.legacyUnclaimed) delete binding.petAuthority;
    const activeEncounter = {
        runId: binding.runId,
        nodeId: binding.nodeId,
        floor: binding.floor,
        kind: binding.kind,
        enemyProfileId: binding.enemyProfileId,
        createdAt: binding.createdAt,
    };
    const run: HollowGateRunToken = {
        playerName: params.playerName,
        mintedAt: Date.now(),
        floorDepth: 1,
        currentFloor: 1,
        seed: `seed-${params.runId}`,
        entryCurrencies: { ryo: 1_000 },
        offeredAugmentIds: ['keen-edge'],
        chosenAugmentId: 'keen-edge',
        dailyRunOrdinal: 1,
        activeEncounter,
        resolvedEncounterIds: [],
        keys: 0,
        torch: 10,
        threat: 0,
    };
    await Promise.all([
        kv.set(hollowGateCombatBindingKey(params.runId), binding, { ex: 86_400 }),
        kv.set(hollowGateRunKey(params.playerName, params.runToken), run, { ex: 86_400 }),
        kv.set(`save:${params.playerName}`, {
            _saveVersion: 1,
            character: {
                name: params.playerName,
                level: 70,
                hp: 1_000,
                maxHp: 1_000,
                chakra: 1_000,
                maxChakra: 1_000,
                stamina: 1_000,
                maxStamina: 1_000,
                ryo: 1_000,
                activePetId: params.pet.id,
                pets: [params.pet],
                itemStacks: [],
                hollowGateRun: {
                    runToken: params.runToken,
                    serverSeed: run.seed,
                    floor: 1,
                    activeCombat: { ...activeEncounter, mode: 'pet' },
                },
            },
        }),
    ]);
    return binding;
}

async function startCinematic(params: {
    playerName: string;
    authToken: string;
    runToken: string;
    runId: string;
    petId: string;
    ip: string;
}) {
    const out = response();
    await battleStartHandler(request({
        playerName: params.playerName,
        mode: '1v1',
        playerPetIds: [params.petId],
        opponentPetIds: ['hollow-hound-encounter-0000000001'],
        hollowGate: { token: params.runToken, runId: params.runId },
    }, params.authToken, params.ip), out.res);
    return out.out;
}

async function reportCinematic(params: {
    playerName: string;
    authToken: string;
    started: Out;
    ip: string;
}) {
    const out = response();
    await battleResultHandler(request({
        playerName: params.playerName,
        outcome: 'loss',
        reportKey: params.started.body?.reportKey,
        battleToken: params.started.body?.token,
        inputLog: [],
    }, params.authToken, params.ip), out.res);
    return out.out;
}

async function atClockOffset<T>(offsetMs: number, fn: () => Promise<T>): Promise<T> {
    const realNow = Date.now;
    Date.now = () => realNow() + offsetMs;
    try {
        return await fn();
    } finally {
        Date.now = realNow;
    }
}

function terminalShowdown(sessionId: string, playerName: string, pet: Pet, outcome: 'win' | 'loss'): ShowdownSession {
    const enemy = { ...pet, id: `${pet.id}-enemy`, name: 'Legacy Hound' } as Pet;
    const session = createShowdownSession({
        sessionId,
        playerName,
        format: '1v1',
        tier: 'warrior',
        seed: 17,
        playerPets: [pet],
        enemyPets: [enemy],
        enemyTeamName: 'Legacy Hound',
        rewardEligible: false,
    });
    session.finished = true;
    session.outcome = outcome;
    return session;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    battleStartHandler = (await import('../pet/battle-start.js')).default as unknown as Handler;
    battleResultHandler = (await import('../pet/battle-result.js')).default as unknown as Handler;
    showdownHandler = (await import('../pet/showdown.js')).default as unknown as Handler;
    combatSettleHandler = (await import('./combat-settle.js')).default as unknown as Handler;
    runSettleHandler = (await import('./settle.js')).default as unknown as Handler;
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.ENABLE_LEGACY;
});

describe('Hollow Gate Pet child authority', () => {
    it('single-flights cinematic starts and rejects Showdown admission, parallel proofs, and receipt shopping', async () => {
        const playerName = 'hgpetcinematicauthority';
        const runToken = 'hgpetcinematicrun01';
        const runId = 'hgpetcinematicencounter01';
        const pet = playerPet('hg-cinematic-pet');
        const authToken = issuePlayerToken(playerName)!;
        const originalBinding = await installPetEncounter({ playerName, runToken, runId, pet });

        const [first, duplicate] = await Promise.all([
            startCinematic({ playerName, authToken, runToken, runId, petId: pet.id, ip: '127.0.21.1' }),
            startCinematic({ playerName, authToken, runToken, runId, petId: pet.id, ip: '127.0.21.2' }),
        ]);
        assert.equal(first.statusCode, 200);
        assert.equal(duplicate.statusCode, 200);
        assert.equal(first.body?.token, originalBinding.petAuthority?.proofId);
        assert.equal(duplicate.body?.token, first.body?.token, 'duplicate start resumes the exact proof');
        assert.equal(duplicate.body?.seed, first.body?.seed, 'duplicate start cannot reroll the outcome seed');
        assert.equal((await kv.keys(`pet:battle-token:${playerName}:*`)).length, 1);

        for (let attempt = 0; attempt < 2; attempt++) {
            const blocked = response();
            await showdownHandler(request({
                action: 'arena',
                playerName,
                format: '1v1',
                petIds: [pet.id],
                hollowGate: { token: runToken, runId, houndId: 'hollow-hound-encounter-0000000001' },
            }, authToken, `127.0.21.${10 + attempt}`), blocked.res);
            assert.equal(blocked.out.statusCode, 409);
        }
        assert.deepEqual(await kv.keys(`pet:showdown:${playerName}:*`), []);

        // Even an already-materialized competing terminal Showdown cannot take
        // over a new parent that selected cinematic authority at creation.
        const competingSessionId = 'parallelshowdown01';
        await Promise.all([
            kv.set(`pet:showdown:${playerName}:${competingSessionId}`, terminalShowdown(competingSessionId, playerName, pet, 'win'), { ex: 2_700 }),
            kv.set(`sd-hg:${playerName}:${competingSessionId}`, { runId, petIds: [pet.id] }, { ex: 2_700 }),
        ]);
        const competingTurn = response();
        await showdownHandler(request({ action: 'turn', playerName, sessionId: competingSessionId, commands: [] }, authToken, '127.0.21.20'), competingTurn.res);
        assert.equal(competingTurn.out.statusCode, 409);
        assert.equal(await kv.get(hollowGatePetResultKey(playerName, competingSessionId)), null);

        const forgedReceipt = 'forgedwinningproof01';
        await kv.set(hollowGatePetResultKey(playerName, forgedReceipt), {
            version: HOLLOW_GATE_PET_AUTHORITY_VERSION,
            engine: 'cinematic',
            proofId: forgedReceipt,
            playerName,
            runId,
            outcome: 'win',
            playerPetIds: [pet.id],
            settledAt: Date.now(),
        }, { ex: 86_400 });
        const shopped = response();
        await combatSettleHandler(request({ playerName, token: runToken, runId, petReceipt: forgedReceipt }, authToken, '127.0.21.21'), shopped.res);
        assert.equal(shopped.out.statusCode, 409, 'same-run alternate outcome receipt is not parent-selected proof');

        const reported = await reportCinematic({ playerName, authToken, started: first, ip: '127.0.21.22' });
        assert.equal(reported.statusCode, 200);
        assert.equal(reported.body?.petReceipt, first.body?.token);
        const exactReceipt = await kv.get<Record<string, unknown>>(hollowGatePetResultKey(playerName, String(first.body?.token)));
        assert.equal(exactReceipt?.version, HOLLOW_GATE_PET_AUTHORITY_VERSION);
        assert.equal(exactReceipt?.engine, 'cinematic');
        assert.equal(exactReceipt?.proofId, first.body?.token);

        const settled = response();
        await combatSettleHandler(request({
            playerName,
            token: runToken,
            runId,
            petReceipt: first.body?.token,
        }, authToken, '127.0.21.23'), settled.res);
        assert.equal(settled.out.statusCode, 200);
        assert.equal(settled.out.body?.won, reported.body?.outcome === 'win');
    });

    it('adopts a legacy parent only from its pre-existing exact active cinematic seal', async () => {
        const playerName = 'hgpetlegacycinematic';
        const runToken = 'hgpetlegacycinematicrun01';
        const runId = 'hgpetlegacycinematicencounter01';
        const pet = playerPet('hg-legacy-cinematic-pet');
        const authToken = issuePlayerToken(playerName)!;
        await installPetEncounter({ playerName, runToken, runId, pet });

        const issued = await startCinematic({ playerName, authToken, runToken, runId, petId: pet.id, ip: '127.0.23.1' });
        assert.equal(issued.statusCode, 200);
        const retainedProof = String(issued.body?.token ?? '');
        assert.equal(await kv.get(`pet:battle-active:${playerName}`), retainedProof);
        const retainedSeal = await kv.get<Record<string, unknown>>(`pet:battle-token:${playerName}:${retainedProof}`);
        assert.equal(retainedSeal?.playerName, playerName);
        assert.deepEqual(retainedSeal?.hollowGate, { runId });

        const beforeCutover = await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(runId));
        assert.ok(beforeCutover);
        const legacyBinding = { ...beforeCutover } as HollowGateCombatBinding;
        delete legacyBinding.petAuthority;
        await kv.set(hollowGateCombatBindingKey(runId), legacyBinding, { ex: 86_400 });

        const recovered = await startCinematic({ playerName, authToken, runToken, runId, petId: pet.id, ip: '127.0.23.2' });
        assert.equal(recovered.statusCode, 200);
        assert.equal(recovered.body?.resumed, true);
        assert.equal(recovered.body?.token, retainedProof, 'the request-local random token never becomes authority');
        const recoveredBinding = await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(runId));
        assert.deepEqual(
            { engine: recoveredBinding?.petAuthority?.engine, proofId: recoveredBinding?.petAuthority?.proofId },
            { engine: 'cinematic', proofId: retainedProof },
        );
        assert.deepEqual(await kv.keys(`pet:battle-token:${playerName}:*`), [`pet:battle-token:${playerName}:${retainedProof}`]);

        const mismatchedPlayer = 'hgpetlegacymismatch';
        const mismatchedRunToken = 'hgpetlegacymismatchrun01';
        const mismatchedRunId = 'hgpetlegacymismatchencounter01';
        const mismatchedPet = playerPet('hg-legacy-mismatch-pet');
        const mismatchedAuth = issuePlayerToken(mismatchedPlayer)!;
        await installPetEncounter({
            playerName: mismatchedPlayer,
            runToken: mismatchedRunToken,
            runId: mismatchedRunId,
            pet: mismatchedPet,
            legacyUnclaimed: true,
        });
        const wrongProof = 'wronglegacyactive01';
        await kv.set(`pet:battle-active:${mismatchedPlayer}`, wrongProof, { ex: 900 });
        await kv.set(`pet:battle-token:${mismatchedPlayer}:${wrongProof}`, {
            playerName: 'somebodyelse',
            hollowGate: { runId: mismatchedRunId },
        }, { ex: 900 });
        const wrongPlayer = await startCinematic({
            playerName: mismatchedPlayer,
            authToken: mismatchedAuth,
            runToken: mismatchedRunToken,
            runId: mismatchedRunId,
            petId: mismatchedPet.id,
            ip: '127.0.23.3',
        });
        assert.equal(wrongPlayer.statusCode, 409);
        await kv.set(`pet:battle-token:${mismatchedPlayer}:${wrongProof}`, {
            playerName: mismatchedPlayer,
            hollowGate: { runId: 'another-run' },
        }, { ex: 900 });
        const wrongRun = await startCinematic({
            playerName: mismatchedPlayer,
            authToken: mismatchedAuth,
            runToken: mismatchedRunToken,
            runId: mismatchedRunId,
            petId: mismatchedPet.id,
            ip: '127.0.23.4',
        });
        assert.equal(wrongRun.statusCode, 409);
        assert.equal(
            (await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(mismatchedRunId)))?.petAuthority,
            undefined,
        );
    });

    it('retains retry authority on receipt failure and linearizes settlement or abandonment', async () => {
        const outagePlayer = 'hgpetreceiptoutage';
        const outageRunToken = 'hgpetreceiptoutagerun01';
        const outageRunId = 'hgpetreceiptoutageencounter01';
        const outagePet = playerPet('hg-receipt-outage-pet');
        const outageAuth = issuePlayerToken(outagePlayer)!;
        await installPetEncounter({ playerName: outagePlayer, runToken: outageRunToken, runId: outageRunId, pet: outagePet });
        const outageStart = await startCinematic({
            playerName: outagePlayer,
            authToken: outageAuth,
            runToken: outageRunToken,
            runId: outageRunId,
            petId: outagePet.id,
            ip: '127.0.24.1',
        });
        assert.equal(outageStart.statusCode, 200);
        const outageProof = String(outageStart.body?.token ?? '');
        const outageReceiptKey = hollowGatePetResultKey(outagePlayer, outageProof);
        const originalSet = kv.set.bind(kv);
        kv.set = (async (key, value, options) => {
            if (key === outageReceiptKey) return null;
            return originalSet(key, value, options);
        }) as typeof kv.set;
        try {
            const failed = await reportCinematic({ playerName: outagePlayer, authToken: outageAuth, started: outageStart, ip: '127.0.24.2' });
            assert.equal(failed.statusCode, 503);
            assert.equal(await kv.get(outageReceiptKey), null);
            assert.ok(await kv.get(`pet:battle-token:${outagePlayer}:${outageProof}`), 'failed receipt retains exact proof');
            assert.equal(await kv.get(`pet:battle-active:${outagePlayer}`), outageProof);
        } finally {
            kv.set = originalSet as typeof kv.set;
        }
        const retryNow = Date.now;
        Date.now = () => retryNow() + 6_000;
        let recovered: Out;
        try {
            recovered = await reportCinematic({ playerName: outagePlayer, authToken: outageAuth, started: outageStart, ip: '127.0.24.3' });
        } finally {
            Date.now = retryNow;
        }
        assert.equal(recovered.statusCode, 200);
        assert.ok(await kv.get(outageReceiptKey));
        assert.equal(await kv.get(`pet:battle-token:${outagePlayer}:${outageProof}`), null);

        // A settlement racing the child report either observes no receipt and
        // fails closed, or linearizes after the exact durable receipt. A retry
        // must then settle only that proof.
        const settlePlayer = 'hgpetsettlerace';
        const settleRunToken = 'hgpetsettleracerun01';
        const settleRunId = 'hgpetsettleraceencounter01';
        const settlePet = playerPet('hg-settle-race-pet');
        const settleAuth = issuePlayerToken(settlePlayer)!;
        await installPetEncounter({ playerName: settlePlayer, runToken: settleRunToken, runId: settleRunId, pet: settlePet });
        const settleStart = await startCinematic({
            playerName: settlePlayer,
            authToken: settleAuth,
            runToken: settleRunToken,
            runId: settleRunId,
            petId: settlePet.id,
            ip: '127.0.24.4',
        });
        const settleProof = String(settleStart.body?.token ?? '');
        const racingSettlement = response();
        const [raceReport] = await Promise.all([
            reportCinematic({ playerName: settlePlayer, authToken: settleAuth, started: settleStart, ip: '127.0.24.5' }),
            combatSettleHandler(request({
                playerName: settlePlayer,
                token: settleRunToken,
                runId: settleRunId,
                petReceipt: settleProof,
            }, settleAuth, '127.0.24.6'), racingSettlement.res),
        ]);
        assert.equal(raceReport.statusCode, 200);
        assert.ok(racingSettlement.out.statusCode === 200 || racingSettlement.out.statusCode === 409);
        if (racingSettlement.out.statusCode === 409) {
            const retry = response();
            await combatSettleHandler(request({
                playerName: settlePlayer,
                token: settleRunToken,
                runId: settleRunId,
                petReceipt: settleProof,
            }, settleAuth, '127.0.24.7'), retry.res);
            assert.equal(retry.out.statusCode, 200);
        }
        const settledBinding = await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(settleRunId));
        assert.notEqual(settledBinding?.status, 'active');

        // Emergency abandonment and child receipt publication share the exact
        // parent-binding lock. Whichever wins, abandonment revokes the binding,
        // child proof, active pointer, and any just-written result as one
        // terminal authority transition.
        const abandonPlayer = 'hgpetabandonrace';
        const abandonRunToken = 'hgpetabandonracerun01';
        const abandonRunId = 'hgpetabandonraceencounter01';
        const abandonPet = playerPet('hg-abandon-race-pet');
        const abandonAuth = issuePlayerToken(abandonPlayer)!;
        await installPetEncounter({ playerName: abandonPlayer, runToken: abandonRunToken, runId: abandonRunId, pet: abandonPet });
        const abandonStart = await startCinematic({
            playerName: abandonPlayer,
            authToken: abandonAuth,
            runToken: abandonRunToken,
            runId: abandonRunId,
            petId: abandonPet.id,
            ip: '127.0.24.8',
        });
        assert.equal(abandonStart.statusCode, 200);
        const abandonProof = String(abandonStart.body?.token ?? '');
        const abandoned = response();
        const [lateReport] = await Promise.all([
            reportCinematic({ playerName: abandonPlayer, authToken: abandonAuth, started: abandonStart, ip: '127.0.24.9' }),
            runSettleHandler(request({
                action: 'abandon',
                playerName: abandonPlayer,
                token: abandonRunToken,
            }, abandonAuth, '127.0.24.10'), abandoned.res),
        ]);
        assert.equal(abandoned.out.statusCode, 200);
        assert.ok(lateReport.statusCode === 200 || lateReport.statusCode === 503);
        assert.equal(await kv.get(hollowGateCombatBindingKey(abandonRunId)), null);
        assert.equal(await kv.get(hollowGatePetResultKey(abandonPlayer, abandonProof)), null);
        assert.equal(await kv.get(`pet:battle-token:${abandonPlayer}:${abandonProof}`), null);
        assert.equal(await kv.get(`pet:battle-active:${abandonPlayer}`), null);
    });

    it('repairs every durable-receipt cleanup shape without deleting the HG result', async () => {
        // Token gone + pointer present: a lost response after token deletion but
        // before CAS pointer cleanup must replay from the durable exact receipt
        // and retire the stale pointer.
        const missingPlayer = 'hgpetmissingtokenreplay';
        const missingRunToken = 'hgpetmissingtokenrun01';
        const missingRunId = 'hgpetmissingtokenencounter01';
        const missingPet = playerPet('hg-missing-token-pet');
        const missingAuth = issuePlayerToken(missingPlayer)!;
        await installPetEncounter({
            playerName: missingPlayer,
            runToken: missingRunToken,
            runId: missingRunId,
            pet: missingPet,
        });
        const missingStart = await startCinematic({
            playerName: missingPlayer,
            authToken: missingAuth,
            runToken: missingRunToken,
            runId: missingRunId,
            petId: missingPet.id,
            ip: '127.0.25.1',
        });
        const missingProof = String(missingStart.body?.token ?? '');
        const missingReceiptKey = hollowGatePetResultKey(missingPlayer, missingProof);
        const missingReported = await reportCinematic({
            playerName: missingPlayer,
            authToken: missingAuth,
            started: missingStart,
            ip: '127.0.25.2',
        });
        assert.equal(missingReported.statusCode, 200);
        assert.ok(await kv.get(missingReceiptKey));
        assert.equal(await kv.get(`pet:battle-token:${missingPlayer}:${missingProof}`), null);
        const missingActiveKey = `pet:battle-active:${missingPlayer}`;
        await kv.set(missingActiveKey, missingProof, { ex: 900 });
        const originalMissingCas = kv.delIfEqual.bind(kv);
        kv.delIfEqual = (async (key, expected) => {
            if (key === missingActiveKey && expected === missingProof) {
                throw new Error('injected token-missing HG pointer cleanup outage');
            }
            return originalMissingCas(key, expected);
        }) as typeof kv.delIfEqual;
        let failedMissingReplay: Out;
        try {
            failedMissingReplay = await atClockOffset(6_000, () => reportCinematic({
                playerName: missingPlayer,
                authToken: missingAuth,
                started: missingStart,
                ip: '127.0.25.3',
            }));
        } finally {
            kv.delIfEqual = originalMissingCas as typeof kv.delIfEqual;
        }
        assert.equal(failedMissingReplay.statusCode, 503);
        assert.equal(await kv.get(missingActiveKey), missingProof);
        const missingReplay = await atClockOffset(12_000, () => reportCinematic({
            playerName: missingPlayer,
            authToken: missingAuth,
            started: missingStart,
            ip: '127.0.25.4',
        }));
        assert.equal(missingReplay.statusCode, 200);
        assert.equal(missingReplay.body?.replayed, true);
        assert.equal(await kv.get(missingActiveKey), null);
        assert.ok(await kv.get(missingReceiptKey), 'child cleanup must retain the durable result');
        const newerProof = 'newerunrelatedproof01';
        await kv.set(missingActiveKey, newerProof, { ex: 900 });
        const casReplay = await atClockOffset(18_000, () => reportCinematic({
            playerName: missingPlayer,
            authToken: missingAuth,
            started: missingStart,
            ip: '127.0.25.10',
        }));
        assert.equal(casReplay.statusCode, 200);
        assert.equal(await kv.get(missingActiveKey), newerProof, 'exact cleanup cannot evict a newer child lease');

        // The embedded proof must also match the KV key/request handle. A
        // malformed cross-key copy of an otherwise exact receipt cannot replay
        // or retire the token named by the request.
        const crossKeyProof = 'crosskeyreceiptproof01';
        const crossKeyReceipt = hollowGatePetResultKey(missingPlayer, crossKeyProof);
        const exactMissingReceipt = await kv.get<Record<string, unknown>>(missingReceiptKey);
        assert.ok(exactMissingReceipt);
        await Promise.all([
            kv.set(crossKeyReceipt, exactMissingReceipt, { ex: 86_400 }),
            kv.set(missingActiveKey, crossKeyProof, { ex: 900 }),
        ]);
        const crossKeyStarted: Out = {
            statusCode: 200,
            body: { token: crossKeyProof, reportKey: 'cross-key-report' },
        };
        const missingTokenCrossKey = await atClockOffset(24_000, () => reportCinematic({
            playerName: missingPlayer,
            authToken: missingAuth,
            started: crossKeyStarted,
            ip: '127.0.25.11',
        }));
        assert.notEqual(missingTokenCrossKey.body?.hollowGate, true);
        assert.notEqual(missingTokenCrossKey.body?.replayed, true);
        assert.equal(await kv.get(missingActiveKey), crossKeyProof, 'cross-key replay cannot clear the requested lease');

        await kv.set(`pet:battle-token:${missingPlayer}:${crossKeyProof}`, {
            playerName: missingPlayer,
            reportKey: 'cross-key-report',
            playerPetIds: [missingPet.id],
            hollowGate: { runId: missingRunId },
            settlementPolicy: 'parent-mode',
        }, { ex: 86_400 });
        const liveTokenCrossKey = await atClockOffset(30_000, () => reportCinematic({
            playerName: missingPlayer,
            authToken: missingAuth,
            started: crossKeyStarted,
            ip: '127.0.25.12',
        }));
        assert.equal(liveTokenCrossKey.statusCode, 409);
        assert.match(String(liveTokenCrossKey.body?.error), /conflicts with its exact battle proof/);
        assert.ok(await kv.get(`pet:battle-token:${missingPlayer}:${crossKeyProof}`));
        assert.equal(await kv.get(missingActiveKey), crossKeyProof);
        await kv.del(
            crossKeyReceipt,
            `pet:battle-token:${missingPlayer}:${crossKeyProof}`,
            missingActiveKey,
        );

        // Parent settlement is already durable when exact child cleanup fails.
        // The retry must replay the parent receipt, clear the stale CAS pointer,
        // and preserve the child receipt for later battle-result recovery.
        const parentPlayer = 'hgpetparentcleanup';
        const parentRunToken = 'hgpetparentcleanuprun01';
        const parentRunId = 'hgpetparentcleanupencounter01';
        const parentPet = playerPet('hg-parent-cleanup-pet');
        const parentAuth = issuePlayerToken(parentPlayer)!;
        await installPetEncounter({
            playerName: parentPlayer,
            runToken: parentRunToken,
            runId: parentRunId,
            pet: parentPet,
        });
        const parentStart = await startCinematic({
            playerName: parentPlayer,
            authToken: parentAuth,
            runToken: parentRunToken,
            runId: parentRunId,
            petId: parentPet.id,
            ip: '127.0.25.5',
        });
        const parentProof = String(parentStart.body?.token ?? '');
        const parentTokenKey = `pet:battle-token:${parentPlayer}:${parentProof}`;
        const parentActiveKey = `pet:battle-active:${parentPlayer}`;
        const parentReceiptKey = hollowGatePetResultKey(parentPlayer, parentProof);
        const parentSeal = await kv.get<Record<string, unknown>>(parentTokenKey);
        assert.ok(parentSeal);
        const parentReported = await reportCinematic({
            playerName: parentPlayer,
            authToken: parentAuth,
            started: parentStart,
            ip: '127.0.25.6',
        });
        assert.equal(parentReported.statusCode, 200);
        await Promise.all([
            kv.set(parentTokenKey, parentSeal, { ex: 86_400 }),
            kv.set(parentActiveKey, parentProof, { ex: 900 }),
        ]);

        const originalDelIfEqual = kv.delIfEqual.bind(kv);
        kv.delIfEqual = (async (key, expected) => {
            if (key === parentActiveKey && expected === parentProof) {
                throw new Error('injected HG child pointer cleanup outage');
            }
            return originalDelIfEqual(key, expected);
        }) as typeof kv.delIfEqual;
        const failedParentSettle = response();
        try {
            await combatSettleHandler(request({
                playerName: parentPlayer,
                token: parentRunToken,
                runId: parentRunId,
                petReceipt: parentProof,
            }, parentAuth, '127.0.25.7'), failedParentSettle.res);
        } finally {
            kv.delIfEqual = originalDelIfEqual as typeof kv.delIfEqual;
        }
        assert.equal(failedParentSettle.out.statusCode, 503);
        assert.ok(await kv.get(`hg-combat-paid:${parentRunId}`), 'parent settlement was durable before cleanup failed');
        assert.ok(await kv.get(parentReceiptKey));
        assert.equal(await kv.get(parentTokenKey), null, 'cleanup deletes the exact token before its pointer');
        assert.equal(await kv.get(parentActiveKey), parentProof);

        const parentRetry = response();
        await combatSettleHandler(request({
            playerName: parentPlayer,
            token: parentRunToken,
            runId: parentRunId,
            petReceipt: parentProof,
        }, parentAuth, '127.0.25.8'), parentRetry.res);
        assert.equal(parentRetry.out.statusCode, 200);
        assert.equal(parentRetry.out.body?.alreadyReported, true);
        assert.equal(await kv.get(parentActiveKey), null);
        assert.ok(await kv.get(parentReceiptKey));

        // A token+pointer can also survive a crash until after the parent is
        // settled. The exact durable child receipt outranks parent active state,
        // replays, and retires both live lease artifacts.
        await Promise.all([
            kv.set(parentTokenKey, parentSeal, { ex: 86_400 }),
            kv.set(parentActiveKey, parentProof, { ex: 900 }),
        ]);
        const liveReplay = await atClockOffset(6_000, () => reportCinematic({
            playerName: parentPlayer,
            authToken: parentAuth,
            started: parentStart,
            ip: '127.0.25.9',
        }));
        assert.equal(liveReplay.statusCode, 200);
        assert.equal(liveReplay.body?.replayed, true);
        assert.equal(await kv.get(parentTokenKey), null);
        assert.equal(await kv.get(parentActiveKey), null);
        assert.ok(await kv.get(parentReceiptKey));
    });

    it('rejects and erases a start published after deterministic parent abandonment', async () => {
        const playerName = 'hgpetstartabandonrace';
        const runToken = 'hgpetstartabandonrun01';
        const runId = 'hgpetstartabandonencounter01';
        const pet = playerPet('hg-start-abandon-pet');
        const authToken = issuePlayerToken(playerName)!;
        const binding = await installPetEncounter({ playerName, runToken, runId, pet });
        const proofId = binding.petAuthority!.proofId;
        const tokenKey = `pet:battle-token:${playerName}:${proofId}`;
        const activeKey = `pet:battle-active:${playerName}`;
        const originalSet = kv.set.bind(kv);
        let releasePublication!: () => void;
        let markPublicationReached!: () => void;
        const publicationReached = new Promise<void>((resolve) => { markPublicationReached = resolve; });
        const publicationReleased = new Promise<void>((resolve) => { releasePublication = resolve; });
        let paused = false;
        kv.set = (async (key, value, options) => {
            if (key === tokenKey && !paused) {
                paused = true;
                markPublicationReached();
                await publicationReleased;
            }
            return originalSet(key, value, options);
        }) as typeof kv.set;

        let lateStart: Promise<Out> | null = null;
        const abandoned = response();
        try {
            lateStart = startCinematic({
                playerName,
                authToken,
                runToken,
                runId,
                petId: pet.id,
                ip: '127.0.26.1',
            });
            await publicationReached;
            await runSettleHandler(request({ action: 'abandon', playerName, token: runToken }, authToken, '127.0.26.2'), abandoned.res);
            assert.equal(abandoned.out.statusCode, 200);
            releasePublication();
            const started = await lateStart;
            assert.equal(started.statusCode, 409, 'a revoked parent cannot return a usable child battle');
        } finally {
            releasePublication();
            kv.set = originalSet as typeof kv.set;
            if (lateStart) await lateStart.catch(() => undefined);
        }
        assert.equal(await kv.get(hollowGateCombatBindingKey(runId)), null);
        assert.equal(await kv.get(tokenKey), null);
        assert.equal(await kv.get(activeKey), null);
        assert.equal(await kv.get(hollowGatePetResultKey(playerName, proofId)), null);
    });

    it('abandons only an exact retained cinematic lease for an unbound legacy parent', async () => {
        const runLegacyAbandon = async (variant: 'exact' | 'wrong-player' | 'wrong-run', index: number) => {
            const playerName = `hgpetlegacyabandon${index}`;
            const runToken = `hgpetlegacyabandonrun0${index}`;
            const runId = `hgpetlegacyabandonencounter0${index}`;
            const pet = playerPet(`hg-legacy-abandon-pet-${index}`);
            const authToken = issuePlayerToken(playerName)!;
            await installPetEncounter({ playerName, runToken, runId, pet, legacyUnclaimed: true });
            const proofId = `legacypointerproof0${index}`;
            const tokenKey = `pet:battle-token:${playerName}:${proofId}`;
            const activeKey = `pet:battle-active:${playerName}`;
            const receiptKey = hollowGatePetResultKey(playerName, proofId);
            await Promise.all([
                kv.set(activeKey, proofId, { ex: 900 }),
                kv.set(tokenKey, {
                    playerName: variant === 'wrong-player' ? 'differentplayer' : playerName,
                    hollowGate: { runId: variant === 'wrong-run' ? 'different-run' : runId },
                }, { ex: 86_400 }),
                kv.set(receiptKey, { retained: true }, { ex: 86_400 }),
            ]);
            const abandoned = response();
            await runSettleHandler(request({ action: 'abandon', playerName, token: runToken }, authToken, `127.0.27.${index}`), abandoned.res);
            assert.equal(abandoned.out.statusCode, 200);
            assert.equal(await kv.get(hollowGateCombatBindingKey(runId)), null);
            if (variant === 'exact') {
                assert.equal(await kv.get(tokenKey), null);
                assert.equal(await kv.get(activeKey), null);
                assert.equal(await kv.get(receiptKey), null);
            } else {
                assert.ok(await kv.get(tokenKey), `${variant} token belongs to another authority`);
                assert.equal(await kv.get(activeKey), proofId);
                assert.ok(await kv.get(receiptKey));
            }
        };

        await runLegacyAbandon('exact', 1);
        await runLegacyAbandon('wrong-player', 2);
        await runLegacyAbandon('wrong-run', 3);
    });

    it('fails closed for ambiguous legacy Showdown siblings without paying either outcome', async () => {
        const playerName = 'hgpetlegacyshowdown';
        const runToken = 'hgpetlegacyrun01';
        const runId = 'hgpetlegacyencounter01';
        const winningSessionId = 'legacyshowdownwin01';
        const losingSessionId = 'legacyshowdownloss01';
        const pet = playerPet('hg-legacy-pet');
        const authToken = issuePlayerToken(playerName)!;
        await installPetEncounter({ playerName, runToken, runId, pet, legacyUnclaimed: true });

        // Model the unsafe pre-cutover state directly: two terminal siblings
        // for one parent, both still recoverable, with different outcomes.
        // The winning sibling is marked paid-eligible to prove the HG sidecar
        // suppresses ordinary arena payout/progression before proof rejection.
        const winningSession = terminalShowdown(winningSessionId, playerName, pet, 'win');
        winningSession.rewardEligible = true;
        winningSession.sealedOpponentLevel = 70;
        const losingSession = terminalShowdown(losingSessionId, playerName, pet, 'loss');
        await Promise.all([
            kv.set(`pet:showdown:${playerName}:${winningSessionId}`, winningSession, { ex: 2_700 }),
            kv.set(`pet:showdown:${playerName}:${losingSessionId}`, losingSession, { ex: 2_700 }),
            kv.set(`sd-hg:${playerName}:${winningSessionId}`, { runId, petIds: [pet.id] }, { ex: 2_700 }),
            kv.set(`sd-hg:${playerName}:${losingSessionId}`, { runId, petIds: [pet.id] }, { ex: 2_700 }),
            kv.set(hollowGatePetResultKey(playerName, winningSessionId), {
                playerName, runId, outcome: 'win', playerPetIds: [pet.id], settledAt: Date.now(),
            }, { ex: 86_400 }),
            kv.set(hollowGatePetResultKey(playerName, losingSessionId), {
                playerName, runId, outcome: 'loss', playerPetIds: [pet.id], settledAt: Date.now(),
            }, { ex: 86_400 }),
        ]);

        for (const [index, sessionId] of [winningSessionId, losingSessionId].entries()) {
            const replay = response();
            await showdownHandler(request(
                { action: 'turn', playerName, sessionId, commands: [] },
                authToken,
                `127.0.22.${index + 1}`,
            ), replay.res);
            assert.equal(replay.out.statusCode, 409, 'neither terminal sibling may claim the parent');
        }

        const binding = await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(runId));
        assert.equal(binding?.petAuthority, undefined, 'caller-selected replay cannot adopt a sibling');
        assert.equal((await kv.get<Record<string, unknown>>(hollowGatePetResultKey(playerName, winningSessionId)))?.version, undefined);
        assert.equal((await kv.get<Record<string, unknown>>(hollowGatePetResultKey(playerName, losingSessionId)))?.version, undefined);

        const unchangedSave = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const unchangedCharacter = unchangedSave?.character as Record<string, unknown> | undefined;
        assert.equal(unchangedCharacter?.ryo, 1_000);
        assert.equal(unchangedCharacter?.totalPetWins, undefined);
        assert.equal(unchangedCharacter?.dailyPetWins, undefined);
        assert.equal(unchangedCharacter?.redeemedPetBattleTokens, undefined);
        assert.equal(await kv.get(`pet:battle-paid:${playerName}:sd:${winningSessionId}`), null);
        assert.equal(await kv.get(`legacy:stats:${playerName}`), null);

        const cinematic = await startCinematic({ playerName, authToken, runToken, runId, petId: pet.id, ip: '127.0.22.2' });
        assert.equal(cinematic.statusCode, 409, 'no retained global cinematic pointer means no safe legacy adoption');
        assert.deepEqual(await kv.keys(`pet:battle-token:${playerName}:*`), []);

        for (const [index, petReceipt] of [winningSessionId, losingSessionId].entries()) {
            const settled = response();
            await combatSettleHandler(request(
                { playerName, token: runToken, runId, petReceipt },
                authToken,
                `127.0.22.${index + 10}`,
            ), settled.res);
            assert.equal(settled.out.statusCode, 409, 'neither old receipt may be selected at settlement');
        }
    });
});

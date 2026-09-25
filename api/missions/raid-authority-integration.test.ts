import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'raid-authority-integration-test-secret';

type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, unknown> };

const FIELD_MISSION = 'fetch-d-supply-trail';
let raidStartDailyResetDelay: typeof import('./raid-start.js').raidStartDailyResetDelay;
let utcDateKey: typeof import('./_progress.js').utcDateKey;
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let raidStart: Handler;
let reportRaid: Handler;
let settleRaidProgression: typeof import('./_raid-progression.js').settleRaidProgression;
let settleMissionOutpostRaid: typeof import('./_raid-progression.js').settleMissionOutpostRaid;
let settleRaidTerritoryDamage: typeof import('./_raid-territory.js').settleRaidTerritoryDamage;
let raidTerritoryProofKey: typeof import('./_raid-territory.js').raidTerritoryProofKey;
let sealedWorldRaidAttacker: typeof import('../pvp/session.js').sealedWorldRaidAttacker;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    ({ settleRaidProgression } = await import('./_raid-progression.js'));
    ({ settleMissionOutpostRaid } = await import('./_raid-progression.js'));
    ({ settleRaidTerritoryDamage, raidTerritoryProofKey } = await import('./_raid-territory.js'));
    ({ sealedWorldRaidAttacker } = await import('../pvp/session.js'));
    const raidStartModule = await import('./raid-start.js');
    raidStart = raidStartModule.default as unknown as Handler;
    raidStartDailyResetDelay = raidStartModule.raidStartDailyResetDelay;
    ({ utcDateKey } = await import('./_progress.js'));
    reportRaid = (await import('./report-raid.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [
        'save:raidauth*',
        'save:raidattack*',
        'save:raiddefender*',
        'raid-start-request:raidauth*',
        'raid-start-count:raidauth*',
        'raid-start-daily:raidauth*',
        'raid-token:raidauth*',
        'raid-report-*:*',
        'raid-territory-proof:*',
        'pvp:raidbattle*',
        'world:territory:18',
        'legacy:stats:raidauth*',
        'missions:progress:raidauth*',
        'ratelimit:*raidauth*',
        'ratelimit:*raidattack*',
        'ratelimit:*raiddefender*',
        'lock:*raidauth*',
        'lock:*raidattack*',
        'lock:*raiddefender*',
    ]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
    for (const player of onlineStore.list()) {
        if (player.name.startsWith('raidauth') || player.name.startsWith('raidattack') || player.name.startsWith('raiddefender')) {
            onlineStore.remove(player.name);
        }
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
        socket: { remoteAddress: `127.3.0.${playerName.length}` },
    } as never, output.res);
    return output.out;
}

async function seed(playerName: string, character: Record<string, unknown> = {}, record: Record<string, unknown> = {}) {
    await kv.set(`save:${playerName}`, {
        _saveVersion: 1,
        currentSector: 18,
        acceptedMissionIds: [],
        missionProgress: {},
        ...record,
        character: {
            name: playerName,
            level: 20,
            rankTitle: 'Genin',
            profession: 'healer',
            professionRank: 1,
            professionXp: 0,
            village: 'Leaf',
            clan: 'LeafClan',
            hp: 100,
            maxHp: 100,
            stamina: 100,
            maxStamina: 100,
            ryo: 0,
            inventory: [],
            ...character,
        },
    });
}

describe('sealed raid authority', () => {
    it('computes the next reset from UTC midnight', () => {
        assert.equal(raidStartDailyResetDelay(Date.UTC(2026, 8, 24, 23, 59, 59, 500)), 500);
    });

    it('rejects Sunscar as a field raid destination', async () => {
        const player = 'raidauthsunscar';
        await seed(player);
        const out = await post(raidStart, player, { requestId: 'sunscarraidrequest01', sector: 54 });
        assert.equal(out.statusCode, 400);
        assert.equal(out.body?.error, 'Invalid raid sector.');
    });

    it('seals an introductory outpost for each village without sweep ordering or guard scaling', async () => {
        const { loadAiFightProfile } = await import('./_ai-fight-encounter.js');
        const { FIELD_MISSIONS } = await import('./_mission-catalog.js');
        for (const mission of FIELD_MISSIONS.filter((entry) => entry.id.startsWith('fetch-'))) {
            assert.ok(mission.raidAiProfileId);
            assert.ok(await loadAiFightProfile(mission.raidAiProfileId), `${mission.id} has a server encounter`);
        }
        await kv.set('guard:veteran-outpost-test', { village: 'Mist', level: 100 });
        await kv.set('world:territory:18', { sector: 18, ownerVillage: 'Mist', ownerClan: 'MistClan', hp: 20_000 });
        for (const village of ['Leaf', 'Mist', 'Sand', 'Cloud']) {
            const player = `raidauthmission${village.toLowerCase()}`;
            const runId = `fieldrunmission${village.toLowerCase()}01`;
            await seed(player, {
                level: 1, village, clan: '',
                serverFieldMissionRuns: {
                    [FIELD_MISSION]: { missionId: FIELD_MISSION, runId, acceptedAt: Date.now() - 1_000 },
                },
            }, { acceptedMissionIds: [FIELD_MISSION] });
            onlineStore.upsert({ name: player, sector: 18, character: { name: player, hp: 100, maxHp: 100 } });
            const started = await post(raidStart, player, {
                requestId: `missionoutpost${village.toLowerCase()}01`, missionId: FIELD_MISSION, sector: 18,
                aiId: 'builtin-ai-central-champion',
            });
            assert.equal(started.statusCode, 200, village);
            assert.equal(started.body?.opponentId, 'mission-outpost-d-supply-trail');
            assert.equal(started.body?.source, 'field-mission-raid');
            const token = await kv.get<Record<string, unknown>>(`raid-token:${player}:${started.body?.token}`);
            assert.equal(token?.missionRunId, runId);
            assert.equal(token?.aiId, 'mission-outpost-d-supply-trail');
        }
        await kv.del('guard:veteran-outpost-test');
    });

    it('rejects an outpost in the wrong sector', async () => {
        const player = 'raidauthmissiontarget';
        await seed(player, {
            level: 1,
            serverFieldMissionRuns: {
                [FIELD_MISSION]: { missionId: FIELD_MISSION, runId: 'fieldrunmissiontarget01', acceptedAt: Date.now() - 1_000 },
            },
        }, { acceptedMissionIds: [FIELD_MISSION] });
        onlineStore.upsert({ name: player, sector: 18, character: { name: player, hp: 100, maxHp: 100 } });

        const wrongSector = await post(raidStart, player, {
            requestId: 'missionwrongsectorrequest01', missionId: FIELD_MISSION, sector: 19,
            aiId: 'builtin-ai-academy-sparring',
        });
        assert.equal(wrongSector.statusCode, 409);
        assert.equal(wrongSector.body?.reason, 'mission-raid-sector-mismatch');

        assert.equal(await kv.get(`raid-start-count:${player}:${utcDateKey()}`), null);
    });

    it('mission outpost victory stamps one fetch receipt and has no Vanguard, Legacy, or territory effects', async () => {
        const player = 'raidauthmissiononly';
        const acceptedAt = Date.now() - 1_000;
        await seed(player, {
            level: 1,
            profession: 'vanguard',
            professionRank: 10,
            professionXp: 123,
            ryo: 77,
            honorSeals: 4,
            serverFieldMissionRuns: {
                [FIELD_MISSION]: { missionId: FIELD_MISSION, runId: 'fieldrunmissiononly001', acceptedAt },
            },
        }, { acceptedMissionIds: [FIELD_MISSION] });
        await kv.set('world:territory:18', {
            sector: 18, ownerVillage: 'Mist', ownerClan: 'MistClan', hp: 20_000,
            guards: [], controlScore: 0, terrainBuffStat: 'bukijutsuOffense', warSupply: 0, updatedAt: Date.now(),
        });
        const { missionProgressReceiptKey } = await import('./_mission-progress-receipt.js');
        const first = await settleMissionOutpostRaid({
            playerName: player, missionId: FIELD_MISSION, proofId: 'mission-outpost-proof-0001', proofAt: Date.now(), sector: 18,
        });
        const replay = await settleMissionOutpostRaid({
            playerName: player, missionId: FIELD_MISSION, proofId: 'mission-outpost-proof-0001', proofAt: Date.now(), sector: 18,
        });
        const receipt = await kv.get<Record<string, unknown>>(missionProgressReceiptKey(player, FIELD_MISSION));
        const save = await kv.get<Record<string, unknown>>(`save:${player}`);
        const territory = await kv.get<Record<string, unknown>>('world:territory:18');
        assert.deepEqual(first.fetchMissionsCredited, [FIELD_MISSION]);
        assert.deepEqual(replay.fetchMissionsCredited, [FIELD_MISSION]);
        assert.equal(receipt?.raidCount, 1, 'proof-specific evidence prevents duplicate credit');
        assert.equal(first.xpAwarded, 0);
        assert.equal(first.bonusRyo, 0);
        assert.equal(first.bonusSeals, 0);
        assert.equal(first.territoryDamage, 0);
        assert.equal((save?.character as Record<string, unknown>)?.professionXp, 123);
        assert.equal((save?.character as Record<string, unknown>)?.ryo, 77);
        assert.equal((save?.character as Record<string, unknown>)?.honorSeals, 4);
        assert.equal(await kv.get(`legacy:stats:${player}`), null);
        assert.equal(territory?.hp, 20_000);
    });

    it('does not credit a replacement contract run from an older mission raid', async () => {
        const player = 'raidauthreplacedrun';
        await seed(player, {
            level: 1,
            serverFieldMissionRuns: {
                [FIELD_MISSION]: { missionId: FIELD_MISSION, runId: 'fieldrunreplacement01', acceptedAt: Date.now() - 1_000 },
            },
        }, { acceptedMissionIds: [FIELD_MISSION] });
        const settled = await settleMissionOutpostRaid({
            playerName: player, missionId: FIELD_MISSION, missionRunId: 'fieldrunprevious001',
            proofId: 'mission-outpost-old-proof-0001', proofAt: Date.now(), sector: 18,
        });
        const { missionProgressReceiptKey } = await import('./_mission-progress-receipt.js');
        assert.deepEqual(settled.fetchMissionsCredited, []);
        assert.equal(await kv.get(missionProgressReceiptKey(player, FIELD_MISSION)), null);
    });

    it('replays one launch before throttling and reconstructs its exact missing token', async () => {
        const player = 'raidauthlaunch';
        const acceptedAt = Date.now() - 1_000;
        await seed(player, {
            serverFieldMissionRuns: {
                [FIELD_MISSION]: { missionId: FIELD_MISSION, runId: 'fieldrunlaunch001', acceptedAt },
            },
        }, { acceptedMissionIds: [FIELD_MISSION] });
        onlineStore.upsert({ name: player, sector: 18, character: { name: player, hp: 100, maxHp: 100 } });

        const requestId = 'raidlaunchrequest01';
        const [first, concurrentReplay] = await Promise.all([
            post(raidStart, player, { requestId, sector: 18 }),
            post(raidStart, player, { requestId, sector: 18 }),
        ]);
        assert.equal(first.statusCode, 200);
        assert.equal(concurrentReplay.statusCode, 200);
        assert.equal(first.body?.token, concurrentReplay.body?.token);
        const token = String(first.body?.token);
        assert.match(token, /^[A-Za-z0-9]{16,96}$/);

        await kv.del(`raid-token:${player}:${token}`);
        const healed = await post(raidStart, player, { requestId, sector: 18 });
        assert.equal(healed.statusCode, 200);
        assert.equal(healed.body?.token, token);
        assert.equal(healed.body?.replayed, true);
        const restored = await kv.get<Record<string, unknown>>(`raid-token:${player}:${token}`);
        assert.equal(restored?.requestId, requestId);
        assert.equal(restored?.sector, 18);
    });

    it('returns the UTC reset deadline when the daily launch cap is reached', async () => {
        const player = 'raidauthdailycap';
        const acceptedAt = Date.now() - 1_000;
        await seed(player, {
            serverFieldMissionRuns: {
                [FIELD_MISSION]: { missionId: FIELD_MISSION, runId: 'fieldrundailycap001', acceptedAt },
            },
        }, { acceptedMissionIds: [FIELD_MISSION] });
        onlineStore.upsert({ name: player, sector: 18, character: { name: player, hp: 100, maxHp: 100 } });
        await kv.set(`raid-start-count:${player}:${utcDateKey()}`, 30);

        const requestId = 'raid-daily-cap-request01';
        const capped = await post(raidStart, player, { requestId, sector: 18 });
        assert.equal(capped.statusCode, 200);
        assert.equal(capped.body?.reason, 'daily-mint-cap');
        assert.equal(capped.body?.token, null);
        assert.ok(Number(capped.body?.retryAfterMs) > 0);
        assert.ok(Math.abs(Number(capped.body?.retryAfterMs) - raidStartDailyResetDelay()) < 1_000);

        const replayed = await post(raidStart, player, { requestId, sector: 18 });
        assert.equal(replayed.statusCode, 200);
        assert.equal(replayed.body?.reason, 'daily-mint-cap');
        assert.equal(replayed.body?.retryAfterMs, capped.body?.retryAfterMs);
    });

    it('binds PvP raid credit to the sealed creator side, not fighter ordering', async () => {
        const attacker = 'raidattackertwo';
        const defender = 'raiddefenderone';
        await seed(attacker);
        await seed(defender, { village: 'Mist', clan: 'MistClan' });
        await kv.set('world:territory:18', {
            sector: 18,
            ownerVillage: 'Mist',
            ownerClan: 'MistClan',
            hp: 20_000,
            guards: [],
            controlScore: 0,
            terrainBuffStat: 'bukijutsuOffense',
            warSupply: 0,
            updatedAt: Date.now(),
        });
        const base = {
            p1: { name: defender, character: {} },
            p2: { name: attacker, character: {} },
            status: 'done',
            joined: { p1: true, p2: true },
            rewardAuthority: 'world',
            worldAttacker: { side: 'p2', name: attacker },
            baseRewards: true,
            rewardSector: 18,
            createdAt: Date.now(),
            // persistedSession stamps endedAt when a row goes terminal; these
            // rows are written straight to kv, so they supply their own.
            endedAt: Date.now(),
        };
        // The seal now carries the attacker's village and clan alongside side and
        // name. These fighters have empty characters, so both read empty here;
        // what this case proves is unchanged — the attacker resolves from the
        // sealed side, not from fighter ordering.
        assert.deepEqual(sealedWorldRaidAttacker(base as never),
            { side: 'p2', name: attacker, village: '', clan: '' });
        // Identity does propagate when the fighter snapshot carries it, which is
        // what the home-defense multiplier and territory checks read downstream.
        assert.deepEqual(
            sealedWorldRaidAttacker({
                ...base,
                p2: { name: attacker, character: { village: 'Leaf', clan: 'LeafClan' } },
            } as never),
            { side: 'p2', name: attacker, village: 'Leaf', clan: 'LeafClan' },
        );
        // And a worldAttacker claim contradicting the sealed fighter is refused
        // outright rather than quietly resolved to the fighter's own values.
        assert.equal(
            sealedWorldRaidAttacker({
                ...base,
                p2: { name: attacker, character: { village: 'Leaf', clan: 'LeafClan' } },
                worldAttacker: { side: 'p2', name: attacker, village: 'Mist' },
            } as never),
            null,
        );

        await kv.set('pvp:raidbattleattackerwin', { ...base, battleId: 'raidbattleattackerwin', winner: 'p2' });
        const won = await post(reportRaid, attacker, { battleId: 'raidbattleattackerwin' });
        assert.equal(won.statusCode, 200);
        assert.equal(won.body?.ok, true);

        await kv.set('pvp:raidbattledefenderwin', { ...base, battleId: 'raidbattledefenderwin', winner: 'p1' });
        const defended = await post(reportRaid, defender, { battleId: 'raidbattledefenderwin' });
        assert.equal(defended.statusCode, 409);
        assert.match(String(defended.body?.error), /sealed raid attacker/);
    });

    it('acknowledges a Death\'s Gate win without field-raid credit, even after the live row expires', async () => {
        const player = 'raidauthdeathsgate';
        const opponent = 'raiddefenderdeathsgate';
        const battleId = 'raidbattledeathsgate';
        const now = Date.now();
        await seed(player);
        await seed(opponent);
        const session = {
            battleId,
            p1: { name: player, character: {} },
            p2: { name: opponent, character: {} },
            status: 'done',
            winner: 'p1',
            joined: { p1: true, p2: true },
            rewardAuthority: 'world',
            baseRewards: true,
            worldAttacker: { side: 'p1', name: player },
            rewardSector: 99,
            createdAt: now - 60_000,
            endedAt: now - 1_000,
        };
        await kv.set(`pvp:${battleId}`, session);
        const first = await post(reportRaid, player, { battleId });
        assert.equal(first.statusCode, 200, JSON.stringify(first.body));
        assert.deepEqual(first.body?.fetchMissionsCredited, []);
        assert.equal(first.body?.reason, 'non-field-raid-sector');
        const save = await kv.get<Record<string, any>>(`save:${player}`);
        assert.equal(save?.character.raidProgressionSettlements, undefined);

        const { sealPvpRewardRecoverySnapshot } = await import('../pvp/_reward-recovery.js');
        await sealPvpRewardRecoverySnapshot(kv, battleId, session as never);
        await kv.del(`pvp:${battleId}`);
        const replay = await post(reportRaid, player, { battleId });
        assert.equal(replay.statusCode, 200, JSON.stringify(replay.body));
        assert.deepEqual(replay.body?.fetchMissionsCredited, []);
    });

    it('never damages self-controlled territory and returns the post-Legacy save projection', async () => {
        const player = 'raidauthselfterritory';
        await seed(player);
        await kv.set('world:territory:18', {
            sector: 18,
            ownerVillage: 'Leaf',
            ownerClan: 'LeafClan',
            hp: 20_000,
            guards: [],
            controlScore: 0,
            terrainBuffStat: 'bukijutsuOffense',
            warSupply: 0,
            updatedAt: Date.now(),
        });
        const direct = await settleRaidTerritoryDamage({
            playerName: player,
            proofId: 'selfterritoryproof01',
            sector: 18,
        });
        assert.equal(direct.amount, 0);
        const territory = await kv.get<Record<string, unknown>>('world:territory:18');
        assert.equal(territory?.hp, 20_000);

        const progressed = await settleRaidProgression({
            playerName: player,
            proofId: 'raidprogressionsnapshot01',
            proofAt: Date.now(),
            sector: 18,
        });
        const latest = await kv.get<Record<string, unknown>>(`save:${player}`);
        assert.equal(progressed._saveVersion, latest?._saveVersion);
        assert.deepEqual(progressed.character, latest?.character);
        assert.equal(progressed.settlement.territoryDamage, 0);
        const replay = await settleRaidProgression({
            playerName: player,
            proofId: 'raidprogressionsnapshot01',
            proofAt: Date.now(),
            sector: 18,
        });
        assert.equal(replay.replayed, true);
        const receipts = (await kv.get<Record<string, unknown>>('world:territory:18'))?.serverRaidDamageReceipts as unknown[];
        assert.equal(receipts.length, 2, 'one direct proof plus one raid proof; replay adds none');
    });

    it('replays the original amount after more than 160 cross-player sector receipts evict its audit row', async () => {
        const original = 'raidauthevictoriginal';
        await seed(original, { village: 'Leaf', clan: 'LeafClan' });
        await kv.set('world:territory:18', {
            sector: 18,
            ownerVillage: 'Mist',
            ownerClan: 'MistClan',
            hp: 20_000,
            guards: [],
            controlScore: 0,
            terrainBuffStat: 'bukijutsuOffense',
            warSupply: 0,
            updatedAt: Date.now(),
        });
        const proofId = 'raid-territory-evicted-original-proof';
        const first = await settleRaidTerritoryDamage({ playerName: original, proofId, sector: 18 });
        assert.equal(first.amount, 250);
        assert.equal(first.replayed, false);

        for (let index = 0; index < 161; index += 1) {
            const player = `raidauthcrowd${index}`;
            await seed(player, { village: 'Mist', clan: 'MistClan' });
            const settled = await settleRaidTerritoryDamage({
                playerName: player,
                proofId: `raid-territory-crowd-proof-${index}`,
                sector: 18,
            });
            assert.equal(settled.amount, 0);
        }
        const beforeReplay = await kv.get<Record<string, unknown>>('world:territory:18');
        const audit = beforeReplay?.serverRaidDamageReceipts as Array<Record<string, unknown>>;
        assert.equal(audit.some((entry) => entry.proofId === proofId), false, 'bounded sector audit evicted the original proof');
        assert.equal(beforeReplay?.hp, 19_750);

        const replay = await settleRaidTerritoryDamage({ playerName: original, proofId, sector: 18 });
        assert.equal(replay.proofId, proofId);
        assert.equal(replay.playerName, original);
        assert.equal(replay.amount, 250);
        assert.equal(replay.sector, 18);
        assert.equal(replay.hpAfter, 19_750);
        assert.equal(replay.destroyed, false);
        assert.equal(replay.replayed, true);
        assert.equal((await kv.get<Record<string, unknown>>('world:territory:18'))?.hp, 19_750, 'durable proof prevents a second hit');
    });

    it('helps a crash-pinned HP mutation forward before 161 later raids can evict and replay it', async () => {
        const original = 'raidauthcrashoriginal';
        await seed(original, { village: 'Leaf', clan: 'LeafClan' });
        await kv.set('world:territory:18', {
            sector: 18,
            ownerVillage: 'Mist',
            ownerClan: 'MistClan',
            hp: 20_000,
            guards: [],
            controlScore: 0,
            terrainBuffStat: 'bukijutsuOffense',
            warSupply: 0,
            updatedAt: Date.now(),
        });
        const proofId = 'raid-territory-crash-pinned-proof';
        const proofKey = raidTerritoryProofKey(proofId);
        const originalSet = kv.set.bind(kv);
        let failedTerminalWrite = false;
        kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
            if (!failedTerminalWrite && key === proofKey) {
                failedTerminalWrite = true;
                throw new Error('simulated-process-death-before-terminal-proof');
            }
            return originalSet(key, value, options);
        }) as typeof kv.set;
        try {
            await assert.rejects(
                settleRaidTerritoryDamage({ playerName: original, proofId, sector: 18 }),
                /simulated-process-death-before-terminal-proof/,
            );
        } finally {
            kv.set = originalSet as typeof kv.set;
        }

        assert.equal(failedTerminalWrite, true);
        const crashed = await kv.get<Record<string, unknown>>('world:territory:18');
        assert.equal(crashed?.hp, 19_750, 'HP and the pending proof commit in the same territory row');
        assert.equal(
            (crashed?.serverRaidDamagePending as Record<string, unknown>)?.proofId,
            proofId,
            'the unfinalized result remains pinned outside the bounded audit ring',
        );
        assert.equal(await kv.get(proofKey), null);

        for (let index = 0; index < 161; index += 1) {
            const player = `raidauthcrashcrowd${index}`;
            await seed(player, { village: 'Mist', clan: 'MistClan' });
            const settled = await settleRaidTerritoryDamage({
                playerName: player,
                proofId: `raid-territory-crash-crowd-${index}`,
                sector: 18,
            });
            assert.equal(settled.amount, 0);
        }

        const afterCrowd = await kv.get<Record<string, unknown>>('world:territory:18');
        const audit = afterCrowd?.serverRaidDamageReceipts as Array<Record<string, unknown>>;
        assert.equal(audit.some((entry) => entry.proofId === proofId), false, 'later receipts evict only after help-forward');
        assert.equal(Object.prototype.hasOwnProperty.call(afterCrowd ?? {}, 'serverRaidDamagePending'), false);
        assert.equal((await kv.get<Record<string, unknown>>(proofKey))?.proofId, proofId);
        assert.equal(afterCrowd?.hp, 19_750);

        const replay = await settleRaidTerritoryDamage({ playerName: original, proofId, sector: 18 });
        assert.equal(replay.proofId, proofId);
        assert.equal(replay.playerName, original);
        assert.equal(replay.amount, 250);
        assert.equal(replay.hpAfter, 19_750);
        assert.equal(replay.replayed, true);
        assert.equal((await kv.get<Record<string, unknown>>('world:territory:18'))?.hp, 19_750);
    });

    it('recovers a committed terminal-proof write whose acknowledgement is lost', async () => {
        const player = 'raidauthlostproofack';
        await seed(player, { village: 'Leaf', clan: 'LeafClan' });
        await kv.set('world:territory:18', {
            sector: 18,
            ownerVillage: 'Mist',
            ownerClan: 'MistClan',
            hp: 20_000,
            guards: [],
            controlScore: 0,
            terrainBuffStat: 'bukijutsuOffense',
            warSupply: 0,
            updatedAt: Date.now(),
        });
        const proofId = 'raid-territory-lost-terminal-ack-proof';
        const proofKey = raidTerritoryProofKey(proofId);
        const originalSet = kv.set.bind(kv);
        let lostAck = false;
        kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
            const result = await originalSet(key, value, options);
            if (!lostAck && key === proofKey) {
                lostAck = true;
                throw new Error('simulated-committed-terminal-ack-loss');
            }
            return result;
        }) as typeof kv.set;
        let first: Awaited<ReturnType<typeof settleRaidTerritoryDamage>>;
        try {
            first = await settleRaidTerritoryDamage({ playerName: player, proofId, sector: 18 });
        } finally {
            kv.set = originalSet as typeof kv.set;
        }

        assert.equal(lostAck, true);
        assert.equal(first!.proofId, proofId);
        assert.equal(first!.playerName, player);
        assert.equal(first!.amount, 250);
        assert.equal(first!.hpAfter, 19_750);
        assert.equal(first!.replayed, false);
        const territory = await kv.get<Record<string, unknown>>('world:territory:18');
        assert.equal(territory?.hp, 19_750);
        assert.equal(Object.prototype.hasOwnProperty.call(territory ?? {}, 'serverRaidDamagePending'), false);
        assert.equal((await kv.get<Record<string, unknown>>(proofKey))?.proofId, proofId);
        const replay = await settleRaidTerritoryDamage({ playerName: player, proofId, sector: 18 });
        assert.equal(replay.replayed, true);
        assert.equal((await kv.get<Record<string, unknown>>('world:territory:18'))?.hp, 19_750);
    });

    it('pins and help-forwards a rolling-upgrade audit receipt before backfilling its terminal key', async () => {
        const original = 'raidauthrollingproof';
        const helper = 'raidauthrollinghelper';
        await seed(original, { village: 'Leaf', clan: 'LeafClan' });
        await seed(helper, { village: 'Mist', clan: 'MistClan' });
        const proofId = 'raid-territory-rolling-upgrade-proof';
        const legacyReceipt = {
            proofId,
            playerName: original,
            amount: 250,
            hpAfter: 19_750,
            destroyed: false,
            at: Date.now() - 1_000,
        };
        await kv.set('world:territory:18', {
            sector: 18,
            ownerVillage: 'Mist',
            ownerClan: 'MistClan',
            hp: 19_750,
            guards: [],
            controlScore: 0,
            terrainBuffStat: 'bukijutsuOffense',
            warSupply: 0,
            updatedAt: Date.now(),
            serverRaidDamageReceipts: [legacyReceipt],
        });

        const proofKey = raidTerritoryProofKey(proofId);
        const originalSet = kv.set.bind(kv);
        let failedTerminalWrite = false;
        kv.set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
            if (!failedTerminalWrite && key === proofKey) {
                failedTerminalWrite = true;
                throw new Error('simulated-rolling-backfill-crash');
            }
            return originalSet(key, value, options);
        }) as typeof kv.set;
        try {
            await assert.rejects(
                settleRaidTerritoryDamage({ playerName: original, proofId, sector: 18 }),
                /simulated-rolling-backfill-crash/,
            );
        } finally {
            kv.set = originalSet as typeof kv.set;
        }
        assert.equal(
            ((await kv.get<Record<string, unknown>>('world:territory:18'))?.serverRaidDamagePending as Record<string, unknown>)?.proofId,
            proofId,
        );

        const helped = await settleRaidTerritoryDamage({
            playerName: helper,
            proofId: 'raid-territory-rolling-helper-proof',
            sector: 18,
        });
        assert.equal(helped.amount, 0);
        const replay = await settleRaidTerritoryDamage({ playerName: original, proofId, sector: 18 });
        assert.equal(replay.proofId, proofId);
        assert.equal(replay.playerName, original);
        assert.equal(replay.amount, 250);
        assert.equal(replay.hpAfter, 19_750);
        assert.equal(replay.replayed, true);
        assert.equal((await kv.get<Record<string, unknown>>('world:territory:18'))?.hp, 19_750);
    });

    it('preserves a zero-damage self-owned result after audit eviction and an ownership change', async () => {
        const original = 'raidauthzeroowner';
        await seed(original, { village: 'Leaf', clan: 'LeafClan' });
        await kv.set('world:territory:18', {
            sector: 18,
            ownerVillage: 'Leaf',
            ownerClan: 'LeafClan',
            hp: 20_000,
            guards: [],
            controlScore: 0,
            terrainBuffStat: 'bukijutsuOffense',
            warSupply: 0,
            updatedAt: Date.now(),
        });
        const proofId = 'raid-territory-zero-owner-proof';
        const first = await settleRaidTerritoryDamage({ playerName: original, proofId, sector: 18 });
        assert.equal(first.amount, 0);

        const changed = await kv.get<Record<string, unknown>>('world:territory:18');
        await kv.set('world:territory:18', { ...changed, ownerVillage: 'Mist', ownerClan: 'MistClan', hp: 20_000 });
        for (let index = 0; index < 161; index += 1) {
            const player = `raidauthzerocrowd${index}`;
            await seed(player, { village: 'Mist', clan: 'MistClan' });
            await settleRaidTerritoryDamage({
                playerName: player,
                proofId: `raid-territory-zero-crowd-${index}`,
                sector: 18,
            });
        }
        const beforeReplay = await kv.get<Record<string, unknown>>('world:territory:18');
        const audit = beforeReplay?.serverRaidDamageReceipts as Array<Record<string, unknown>>;
        assert.equal(audit.some((entry) => entry.proofId === proofId), false);
        const replay = await settleRaidTerritoryDamage({ playerName: original, proofId, sector: 18 });
        assert.equal(replay.amount, 0);
        assert.equal(replay.replayed, true);
        assert.equal((await kv.get<Record<string, unknown>>('world:territory:18'))?.hp, 20_000, 'old self-owned proof cannot damage the new owner');
    });

    it('uses sealed target identity after the fighter switches clan and records target replacement as exact zero', async () => {
        const player = 'raidauthsealedswitch';
        await seed(player, { village: 'Leaf', clan: 'LeafClan' });
        const observedAt = Date.now() - 2_000;
        const evidence = {
            version: 1 as const,
            sector: 18,
            ownerVillage: 'Mist',
            ownerClan: 'MistClan',
            raidDamage: 250,
            observedAt,
        };
        await kv.set('world:territory:18', {
            sector: 18,
            ownerVillage: 'Mist',
            ownerClan: 'MistClan',
            hp: 20_000,
            guards: [],
            updatedAt: observedAt,
        });
        await seed(player, { village: 'Mist', clan: 'MistClan' });
        const applied = await settleRaidTerritoryDamage({
            playerName: player,
            proofId: 'sealed-switch-applied-proof',
            sector: 18,
            eventAt: observedAt + 1_000,
            evidence,
        });
        assert.equal(applied.amount, 250, 'current save identity cannot suppress sealed attacker damage');

        const changed = await kv.get<Record<string, unknown>>('world:territory:18');
        await kv.set('world:territory:18', {
            ...changed,
            ownerVillage: 'Cloud',
            ownerClan: 'CloudClan',
            hp: 20_000,
        });
        const superseded = await settleRaidTerritoryDamage({
            playerName: player,
            proofId: 'sealed-switch-superseded-proof',
            sector: 18,
            eventAt: observedAt + 1_500,
            evidence,
        });
        assert.equal(superseded.amount, 0);
        assert.equal(superseded.destroyed, false);
        assert.equal((await kv.get<Record<string, unknown>>('world:territory:18'))?.hp, 20_000);
    });

    it('opens a fixed breach at zero HP instead of instantly erasing clan ownership', async () => {
        const player = 'raidauthbreach';
        await seed(player, { village: 'Leaf', clan: 'LeafClan' });
        const observedAt = Date.now() - 1_000;
        const evidence = {
            version: 1 as const,
            sector: 18,
            ownerVillage: 'Mist',
            ownerClan: 'MistClan',
            raidDamage: 250,
            observedAt,
        };
        await kv.set('world:territory:18', {
            sector: 18,
            ownerVillage: 'Mist',
            ownerClan: 'MistClan',
            hp: 200,
            guards: [],
            controlScore: 75_000,
            warSupply: 0,
            lastSupplyAt: observedAt,
            updatedAt: observedAt,
        });
        const first = await settleRaidTerritoryDamage({
            playerName: player,
            proofId: 'raid-territory-breach-first',
            sector: 18,
            eventAt: observedAt + 500,
            evidence,
        });
        assert.equal(first.amount, 250);
        assert.equal(first.hpAfter, 0);
        assert.equal(first.destroyed, false);
        const breached = await kv.get<Record<string, unknown>>('world:territory:18');
        assert.equal(breached?.ownerClan, 'MistClan');
        assert.equal(breached?.hp, 0);
        assert.ok(Number(breached?.breachedAt) > 0);
        const deadline = breached?.breachEndsAt;

        const second = await settleRaidTerritoryDamage({
            playerName: player,
            proofId: 'raid-territory-breach-second',
            sector: 18,
            eventAt: observedAt + 700,
            evidence,
        });
        assert.equal(second.amount, 0, 'a zero-HP breach cannot absorb wasted raid damage');
        assert.equal((await kv.get<Record<string, unknown>>('world:territory:18'))?.breachEndsAt, deadline);
    });

    it('rejects a stale territory holder without erasing a concurrent row update, then retries exactly', async () => {
        const player = 'raidauthstaleholder';
        await seed(player, { village: 'Leaf', clan: 'LeafClan' });
        await kv.set('world:territory:18', {
            sector: 18,
            ownerVillage: 'Mist',
            ownerClan: 'MistClan',
            hp: 20_000,
            guards: [],
            warSupply: 1,
            updatedAt: Date.now(),
        });
        const originalCompareSet = kv.compareSet.bind(kv);
        let raced = false;
        kv.compareSet = (async (key: string, expected: unknown, value: unknown, options?: { ex?: number }) => {
            if (!raced && key === 'world:territory:18') {
                raced = true;
                const current = await kv.get<Record<string, unknown>>(key);
                assert.ok(current);
                assert.equal(await originalCompareSet(key, current, { ...current, warSupply: 77 }), true);
            }
            return originalCompareSet(key, expected, value, options);
        }) as typeof kv.compareSet;
        try {
            await assert.rejects(
                settleRaidTerritoryDamage({ playerName: player, proofId: 'stale-holder-proof', sector: 18 }),
                /row-conflict/,
            );
        } finally {
            kv.compareSet = originalCompareSet as typeof kv.compareSet;
        }
        const conflicted = await kv.get<Record<string, unknown>>('world:territory:18');
        assert.equal(conflicted?.hp, 20_000);
        assert.equal(conflicted?.warSupply, 77);
        const retried = await settleRaidTerritoryDamage({
            playerName: player,
            proofId: 'stale-holder-proof',
            sector: 18,
        });
        assert.equal(retried.amount, 250);
        const settled = await kv.get<Record<string, unknown>>('world:territory:18');
        assert.equal(settled?.hp, 19_750);
        assert.equal(settled?.warSupply, 77);
    });
});

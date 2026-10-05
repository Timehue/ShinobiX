import assert from 'node:assert/strict';
import { before, beforeEach, describe, it } from 'node:test';

/*
 * The raid saga reports its daily-mission event at the raid's proof time
 * (`now: new Date(proofAt)`): an AI raid's token mint, a PvP raid's battle end.
 * A raid proved before midnight and settled after it (a fight that ran past
 * 00:00 UTC, or a client outbox retrying the next day) reported into the
 * previous UTC day. loadOrIssueDailyMissions issued that day's set and
 * OVERWROTE today's board: today's progress and event receipts were wiped, and
 * the next report reissued today's missions fresh, so ones already completed
 * and paid could be completed and paid again.
 *
 * A report dated before the stored board now counts nothing and leaves the
 * board alone (loss-only).
 */

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Json = Record<string, unknown>;

const PLAYER = 'staledayraider';
const SECTOR = 58;
const DAY_MS = 86_400_000;

let kv: typeof import('../_storage.js').kv;
let settleRaidProgressionWithDailyCap: typeof import('./_raid-progression.js').settleRaidProgressionWithDailyCap;
let getMissionTemplateById: typeof import('./_pool.js').getMissionTemplateById;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ settleRaidProgressionWithDailyCap } = await import('./_raid-progression.js'));
    ({ getMissionTemplateById } = await import('./_pool.js'));
});

function boardMission(templateId: string, date: string, progress: Partial<Json> = {}): Json {
    const template = getMissionTemplateById(templateId);
    assert.ok(template, `mission template ${templateId}`);
    return {
        id: `${template.templateId}:${date}`,
        templateId: template.templateId,
        kind: template.kind,
        name: template.name,
        description: template.description,
        target: template.target,
        progress: 0,
        xpReward: template.xpReward,
        eligibility: template.eligibility,
        completedAt: null,
        claimed: false,
        ...progress,
    };
}

beforeEach(async () => {
    const stale = [
        ...(await kv.keys('raid-territory-proof:*')),
        ...(await kv.keys(`raid-report-*:${PLAYER}*`)),
        ...(await kv.keys('lock:*')),
        `world:territory:${SECTOR}`,
        `save:${PLAYER}`,
        `legacy:stats:${PLAYER}`,
        `missions:daily:${PLAYER}`,
    ];
    await kv.del(...stale);
    await kv.set(`save:${PLAYER}`, {
        _saveVersion: 1,
        currentSector: SECTOR,
        acceptedMissionIds: [],
        missionProgress: {},
        character: {
            name: PLAYER,
            level: 30,
            rankTitle: 'Genin',
            profession: 'vanguard',
            professionRank: 2,
            professionXp: 100,
            village: 'Leaf',
            clan: 'LeafClan',
            hp: 100,
            maxHp: 100,
            stamina: 100,
            maxStamina: 100,
            ryo: 0,
            inventory: [],
        },
    });
});

describe('a raid proved on an earlier UTC day', () => {
    it('leaves today\'s daily missions intact when it settles', async () => {
        const today = new Date().toISOString().slice(0, 10);
        const earlierToday = Date.now() - 60_000;
        // Today's board already holds a paid completion and an earlier raid.
        await kv.set(`missions:daily:${PLAYER}`, {
            date: today,
            profession: 'vanguard',
            missions: [
                boardMission('vanguard-patrol', today, { progress: 1, completedAt: earlierToday }),
                boardMission('vanguard-raid-strike', today, { progress: 1, completedAt: earlierToday }),
                boardMission('vanguard-raid-pressure', today, { progress: 1 }),
            ],
            eventReceipts: [{ id: 'raid_earliertoday', kind: 'vanguard-raids', xpAwarded: 60, missionsCompleted: [], appliedAt: earlierToday }],
        }, { ex: 3600 });
        const before = await kv.get<Json>(`missions:daily:${PLAYER}`);

        const settled = await settleRaidProgressionWithDailyCap({
            playerName: PLAYER,
            proofId: 'pvp-raid:stale-day-proof',
            proofAt: Date.now() - DAY_MS,
            sector: SECTOR,
            dailyLimit: 60,
        });

        assert.equal(settled.capped, false);
        assert.equal(settled.settlement?.proofId, 'pvp-raid:stale-day-proof', 'the raid itself still settles');
        assert.deepEqual(await kv.get<Json>(`missions:daily:${PLAYER}`), before, 'today\'s board was replaced by the proof day\'s set');
        assert.deepEqual(settled.settlement?.missionsCompleted, [], 'the stale raid counts toward no board');
        assert.equal(settled.settlement?.xpAwarded, 0);
        const character = (await kv.get<Json>(`save:${PLAYER}`))?.character as Json;
        assert.equal(character.professionXp, 100, 'and pays no mission profession XP');
    });

    it('still counts toward the proof day\'s board while that board is the one stored', async () => {
        const proofAt = Date.now() - DAY_MS;
        const proofDay = new Date(proofAt).toISOString().slice(0, 10);
        await kv.set(`missions:daily:${PLAYER}`, {
            date: proofDay,
            profession: 'vanguard',
            missions: [
                boardMission('vanguard-patrol', proofDay),
                boardMission('vanguard-raid-strike', proofDay),
                boardMission('vanguard-raid-pressure', proofDay),
            ],
        }, { ex: 3600 });

        const settled = await settleRaidProgressionWithDailyCap({
            playerName: PLAYER,
            proofId: 'pvp-raid:proof-day-board',
            proofAt,
            sector: SECTOR,
            dailyLimit: 60,
        });

        assert.deepEqual(settled.settlement?.missionsCompleted.map((mission) => mission.name), ['Raid Strike']);
        const board = await kv.get<Json>(`missions:daily:${PLAYER}`);
        assert.equal(board?.date, proofDay);
    });
});

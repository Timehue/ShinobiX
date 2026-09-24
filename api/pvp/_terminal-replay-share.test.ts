import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'terminal-replay-share-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

/*
 * One process serves every player, and a finishing move plus BOTH fighters'
 * reward claims replay the terminal barrier for the same frozen row within about
 * a second of each other. Run side by side, those copies fought over the same
 * fail-closed save locks. Callers for the same committed row now share one
 * in-flight run; the entry is dropped once it settles, so a later caller (or a
 * failed run's retry) still performs its own replay.
 */

let kv: typeof import('../_storage.js').kv;
let replay: typeof import('./_committed-terminal-effects.js').replayCommittedPvpTerminalEffects;
let inFlight: typeof import('./_committed-terminal-effects.js')._inFlightPvpTerminalReplayCount;

const SECTOR = 59;
const WINNER = 'sharereplaywinner';
const VILLAGE = 'Frostfang Village';

function fighter(name: string, hp: number) {
    return { name, hp, maxHp: 100, chakra: 10, maxChakra: 50, stamina: 10, maxStamina: 50, statuses: [], pos: 0, character: { name, village: VILLAGE, clan: 'Meow', level: 20 } };
}

// A player holds one pending, unclaimed battle at a time, so each battle gets
// its own pair of fighters.
async function seed(battleId: string, now: number, suffix = '') {
    const WINNER = `sharereplaywinner${suffix}`;
    const LOSER = `sharereplayloser${suffix}`;
    for (const name of [WINNER, LOSER]) {
        await kv.set(`save:${name}`, {
            _saveVersion: 1,
            currentSector: SECTOR,
            acceptedMissionIds: [],
            missionProgress: {},
            character: {
                name, village: VILLAGE, clan: 'Meow', level: 20, ryo: 100,
                hp: 100, maxHp: 100, chakra: 50, maxChakra: 50, stamina: 50, maxStamina: 50,
                profession: 'healer', professionRank: 1, professionXp: 0,
                stats: {}, inventory: [], itemStacks: [], serverSettlementReceipts: [],
            },
        });
    }
    const session = {
        battleId,
        p1: fighter(WINNER, 40),
        p2: fighter(LOSER, 0),
        status: 'done',
        winner: 'p1',
        stateRevision: 7,
        continuousVitals: true,
        rewardAuthority: 'world',
        progressionAuthorityVersion: 1,
        worldAttacker: { side: 'p1', name: WINNER, village: VILLAGE, clan: 'Meow' },
        worldTerritoryEvidence: { version: 1, sector: SECTOR, ownerClan: '', ownerVillage: '', raidDamage: 0, observedAt: now - 60_000 },
        rewardSector: SECTOR,
        baseRewards: true,
        joined: { p1: true, p2: true },
        realFighters: { p1: true, p2: true },
        itemsUsed: { p1: {}, p2: {} },
        log: [],
        createdAt: now - 60_000,
        endedAt: now - 1_000,
        lastMoveAt: now - 1_000,
    };
    await kv.set(`pvp:${battleId}`, session, { ex: 24 * 60 * 60 });
    return session;
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ replayCommittedPvpTerminalEffects: replay, _inFlightPvpTerminalReplayCount: inFlight } = await import('./_committed-terminal-effects.js'));
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
    delete process.env.DISABLE_COMBAT_RECEIPTS;
});

test('concurrent replays of one terminal row share a single run, then release it', async () => {
    const saveLocks: string[] = [];
    const originalSet = kv.set.bind(kv);
    (kv as unknown as { set: typeof kv.set }).set = (async (key: string, value: unknown, options?: { ex?: number; nx?: boolean }) => {
        if (options?.nx && key.startsWith('lock:save:')) saveLocks.push(key);
        return originalSet(key, value, options);
    }) as typeof kv.set;
    try {
        // Baseline: one uncontended run of an identically shaped battle.
        await replay(await seed('pvp-share-replay-solo', Date.now(), 'solo') as never);
        const soloLockAttempts = saveLocks.length;
        assert.ok(soloLockAttempts > 0, 'the barrier settles under save locks');
        saveLocks.length = 0;

        const session = await seed('pvp-share-replay-1', Date.now());
        // The mover passes its committed row; a claim passes the sealed JSON copy.
        const claimCopy = JSON.parse(JSON.stringify(session));
        const mover = replay(session as never);
        const claim = replay(claimCopy as never);
        assert.equal(inFlight(), 1);
        const [moverResult, claimResult] = await Promise.all([mover, claim]);
        assert.equal(inFlight(), 0, 'a settled run is released at once');
        // Two independent copies would each take every lock (and contend,
        // retrying). One shared run takes exactly what a solo run does.
        assert.equal(saveLocks.length, soloLockAttempts, 'the claim joined the in-flight run instead of racing it');
        assert.ok(moverResult.worldSettlement?.raid, 'the barrier reports the raid it settled');
        assert.deepEqual(claimResult.worldSettlement?.raid?.settlement, moverResult.worldSettlement?.raid?.settlement);
        assert.notEqual(claimResult, moverResult, 'each caller receives its own result object');

        // A caller arriving after the run settled replays for itself. Vitals are
        // already proven by their marker, so the replay takes no vitals lock;
        // it still helps every other step forward idempotently.
        await replay(claimCopy as never);
        assert.equal(inFlight(), 0);
        const winnerSave = await kv.get<{ character: { raidProgressionSettlements?: Array<{ proofId?: string }> } }>(`save:${WINNER}`);
        assert.equal(
            winnerSave?.character.raidProgressionSettlements?.filter((entry) => entry.proofId === 'pvp-raid:pvp-share-replay-1').length,
            1,
            'the raid proof settles exactly once across the shared run and the later replay',
        );
    } finally {
        (kv as unknown as { set: typeof kv.set }).set = originalSet;
    }
});

test('a different committed revision of the same battle never joins another run', async () => {
    const session = await seed('pvp-share-replay-2', Date.now(), 'rev');
    const later = { ...JSON.parse(JSON.stringify(session)), stateRevision: 8 };
    const first = replay(session as never);
    const second = replay(later as never);
    assert.equal(inFlight(), 2);
    await Promise.allSettled([first, second]);
    assert.equal(inFlight(), 0);
});

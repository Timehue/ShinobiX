import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'combat-usage-terminal-secret';
// Receipts ON: the usage count is recorded from the receipt's first write.
delete process.env.DISABLE_COMBAT_RECEIPTS;

/*
 * Balance telemetry (api/_combat-usage.ts) must count a real PvP battle once,
 * through the real terminal replay, however many times that replay runs: the
 * finishing move and both players' reward claims all replay it.
 */

let kv: typeof import('../_storage.js').kv;
let replay: typeof import('./_committed-terminal-effects.js').replayCommittedPvpTerminalEffects;
let usage: typeof import('../_combat-usage.js');

const SECTOR = 58;
const VILLAGE = 'Frostfang Village';
const WINNER = 'usagetermwinner';
const LOSER = 'usagetermloser';

function fighter(name: string, hp: number, jutsu: string[]) {
    return {
        name, hp, maxHp: 100, chakra: 10, maxChakra: 50, stamina: 10, maxStamina: 50, statuses: [], pos: 0,
        character: { name, village: VILLAGE, clan: 'Meow', level: 20, jutsu: jutsu.map((id) => ({ id })), equippedBloodlineId: `bl-${name}` },
    };
}

async function seed(battleId: string, now: number) {
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
        p1: fighter(WINNER, 40, ['usage-fireball', 'usage-palm']),
        p2: fighter(LOSER, 0, ['usage-wall']),
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
        jutsuUsed: { p1: ['usage-fireball'], p2: ['usage-wall'] },
        log: [],
        createdAt: now - 60_000,
        endedAt: now - 1_000,
        lastMoveAt: now - 1_000,
    };
    await kv.set(`pvp:${battleId}`, session, { ex: 24 * 60 * 60 });
    return session;
}

async function settled<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    for (let i = 0; i < 100; i++) {
        const value = await read();
        if (done(value)) return value;
        await new Promise((r) => setTimeout(r, 10));
    }
    return read();
}

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ replayCommittedPvpTerminalEffects: replay } = await import('./_committed-terminal-effects.js'));
    usage = await import('../_combat-usage.js');
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.SESSION_SECRET;
});

test('a finished PvP battle is counted once, however many times its terminal replay runs', async () => {
    await kv.del(usage.usageKey('pvp'));
    const session = await seed('pvp-usage-terminal-1', Date.now());
    const copy = JSON.parse(JSON.stringify(session));
    await Promise.all([replay(session as never), replay(copy as never)]);
    await replay(JSON.parse(JSON.stringify(session)) as never);

    const agg = await settled(() => usage.readCombatUsage('pvp'), (a) => (a?.fights ?? 0) > 0);
    // Give any stray duplicate write time to land before asserting it didn't.
    await new Promise((r) => setTimeout(r, 100));
    const final = await usage.readCombatUsage('pvp');
    assert.equal(agg?.fights, 1);
    assert.equal(final?.fights, 1, 'a later replay must not count the battle again');
    assert.deepEqual(final?.jutsu['usage-fireball'], { equipped: 1, used: 1, win: 1, loss: 0, draw: 0, fled: 0 });
    assert.deepEqual(final?.jutsu['usage-palm'], { equipped: 1, used: 0, win: 1, loss: 0, draw: 0, fled: 0 });
    assert.deepEqual(final?.jutsu['usage-wall'], { equipped: 1, used: 1, win: 0, loss: 1, draw: 0, fled: 0 });
    assert.equal(final?.bloodline[`bl-${WINNER}`]?.win, 1);
});

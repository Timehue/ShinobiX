import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, test } from 'node:test';
process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/**
 * Cinderhold's 30 NPC accounts look like players but must never count as, or
 * pay, players (owner plan 2026-11-08; audit 2026-11-09). One test per seam.
 */
let roster: typeof import('../shared/npc-village-roster.js');
let session: typeof import('./pvp/session.js');
let season: typeof import('./cron/_ranked-season.js');
let saveHandler: typeof import('./save/[name].js');
let economy: typeof import('./_economy.js');
let kv: typeof import('./_storage.js').kv;
const npcName = () => roster.NPC_VILLAGE_ROSTER[0]!.name;

before(async () => {
    roster = await import('../shared/npc-village-roster.js');
    session = (await import('./pvp/session.js')) as unknown as typeof session;
    season = await import('./cron/_ranked-season.js');
    saveHandler = (await import('./save/[name].js')) as unknown as typeof saveHandler;
    economy = await import('./_economy.js');
    ({ kv } = await import('./_storage.js'));
});

test('a PvP fight with an NPC pays and progresses nobody, however it ends', () => {
    const base = { rewardAuthority: 'world', joined: { p1: true, p2: true } } as const;
    assert.equal(session.pvpSessionMayReward({ ...base, p1: { name: 'Alice' }, p2: { name: 'Bob' } } as never), true);
    assert.equal(session.pvpSessionMayReward({ ...base, p1: { name: 'Alice' }, p2: { name: npcName() } } as never), false);
    assert.equal(session.pvpSessionMayReward({ ...base, p1: { name: npcName() }, p2: { name: 'Alice' } } as never), false);
    assert.equal(session.pvpSessionMayGrantProgress({ ...base, baseRewards: true, p1: { name: 'Alice' }, p2: { name: npcName() } } as never), false);
});

test('the ranked season never ranks, resets or rewards an NPC save', () => {
    assert.equal(season.isRankedSeasonPlayerSaveKey('save:alice'), true);
    for (const npc of roster.NPC_VILLAGE_ROSTER) assert.equal(season.isRankedSeasonPlayerSaveKey(`save:${npc.id}`), false, npc.id);
});

test('nobody can enlist an NPC into a player clan; existing rows are left alone', () => {
    const npc = roster.NPC_VILLAGE_ROSTER[1]!;
    const incoming = { members: [{ name: 'Alice' }, { name: npc.name }], joinRequests: [{ name: npc.name }, { name: 'Bob' }] };
    const out = saveHandler.withoutNewNpcMembers({ members: [{ name: 'Alice' }] }, incoming);
    assert.deepEqual(out.members, [{ name: 'Alice' }]);
    assert.deepEqual(out.joinRequests, [{ name: 'Bob' }]);
    const plain = { members: [{ name: 'Alice' }, { name: 'Bob' }] };
    assert.equal(saveHandler.withoutNewNpcMembers(null, plain), plain, 'a write without NPCs passes untouched');
    const source = readFileSync('api/save/[name].ts', 'utf8');
    assert.match(source, /if \(identityName && isNpcAccount\(identityName\)\) \{\s*return reply\(403/);
});

test('economy telemetry never records an NPC, and still records players', async () => {
    const writes: string[] = [];
    const store = { get: async () => null, set: async (key: string) => { writes.push(key); return 'OK' as const; } };
    await economy.recordEconomyTxn({ txnId: 'npc-1', player: npcName(), currency: 'ryo', delta: 500, source: 'contract' }, { kv: store as never });
    assert.deepEqual(writes, []);
    await economy.recordEconomyTxn({ txnId: 'pl-1', player: 'Alice', currency: 'ryo', delta: 500, source: 'contract' }, { kv: store as never });
    assert.ok(writes.length > 0, 'a player transaction is still recorded');
});

test('census telemetry, the leaderboard roster and the server reset all honour the NPC rule', () => {
    assert.match(readFileSync('api/_beta-metrics.ts', 'utf8'), /typeof who === 'string' && isNpcAccount\(who\)\) return Promise\.resolve\(\)/);
    assert.match(readFileSync('api/admin/beta-metrics.ts', 'utf8'), /filter\(\(key\) => !isNpcAccount\(key\.slice\('save:'\.length\)\)\)/);
    assert.match(readFileSync('api/player/roster.ts', 'utf8'), /isPublicPlayerIndexKey\(entry\.name\) && !isNpcAccount\(entry\.name\)/);
    assert.match(readFileSync('api/admin/server-reset.ts', 'utf8'), /await seedNpcVillage\(Date\.now\(\)/);
    void kv;
});

test('an NPC duel is no village raid and skews no player-facing stats (audit 2026-11-09)', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER[0]!;
    const human = { name: 'Alice', character: { equippedJutsuIds: ['fireball'] } };
    const seated = { name: npc.name, character: { equippedJutsuIds: ['water-whip'] } };
    const done = {
        battleId: 'npc-raid-check', status: 'done', winner: 'p1', rewardAuthority: 'world', joined: { p1: true, p2: true },
        realFighters: { p1: true, p2: true }, npcDuel: { version: 1, npc: npc.id, seat: 'p2', paid: true },
        worldAttacker: { side: 'p1', name: 'alice', village: 'Frostfang Village', clan: '' }, rewardSector: 67,
        createdAt: 1, endedAt: Date.now(), lastMoveAt: Date.now(), p1: human, p2: seated, log: [],
    };
    // No raid progression, territory damage or village-war row from beating an NPC.
    const { settleTerminalWorldRaid } = await import('./pvp/_terminal-world-raid.js');
    let raided = false;
    const settled = await settleTerminalWorldRaid(done as never, {
        settleRaid: (async () => { raided = true; return null; }) as never,
        settleVillageWar: (async () => { raided = true; return { status: 200, body: {} }; }) as never,
    });
    assert.deepEqual(settled, {});
    assert.equal(raided, false);
    // The AI's loadout never feeds the jutsu and win-rate telemetry; the player's does.
    const { pvpCombatUsage } = await import('./_combat-usage.js');
    const usage = pvpCombatUsage(done as never)!;
    assert.equal(usage.fighters.length, 1);
    assert.equal(usage.fighters[0]!.outcome, 'win', 'only the player (the winner, p1) is counted');
    // An NPC that wins is never credited Vanguard seals.
    const { grantVanguardRewardsForSession } = await import('./pvp/_vanguard-rewards.js');
    assert.deepEqual(await grantVanguardRewardsForSession({ ...done, winner: 'p2' } as never), { granted: false });
});

test('an NPC fight record counts each battle once, however often the driver retries', async () => {
    const duel = await import('./_npc-duel.js');
    const npc = roster.NPC_VILLAGE_ROSTER[1]!;
    await duel.recordNpcDuelResult(npc.id, 'Alice', 'win', 'record-once');
    await duel.recordNpcDuelResult(npc.id, 'Alice', 'win', 'record-once');
    await duel.recordNpcDuelResult(npc.id, 'Alice', 'loss', 'record-twice');
    const row = await kv.get<{ wins: number; losses: number; rivals: Record<string, { wins: number }> }>(duel.npcDuelRecordKey(npc.id));
    assert.equal(row?.wins, 1);
    assert.equal(row?.losses, 1);
    assert.equal(row?.rivals.alice?.wins, 1);
});

test('nothing but the world attack can be aimed at an NPC (challenges, invites, trades, sleeper kills)', () => {
    const guard = readFileSync('api/_npc-guard.ts', 'utf8');
    assert.match(guard, /export function isNpcTarget/);
    for (const file of ['player/challenge.ts', 'card-clash/challenge.ts', 'towers/party.ts', 'clan-boss/party.ts',
        'pvp/ranked-2v2.ts', 'pet/battle-start.ts', 'pet/ranked-start.ts', 'player/trade.ts', 'player/sleeper-kill.ts',
        'messages.ts', 'player/friends.ts', 'pvp/bounty.ts', 'tournaments/event.ts']) {
        const source = readFileSync(`api/${file}`, 'utf8');
        assert.match(source, /isNpcTarget\(/, `${file} refuses a Cinderhold NPC as its target`);
    }
    const camps = readFileSync('api/_realtime/sleeper-camps.ts', 'utf8');
    assert.match(camps, /isNpcAccount\(safeName\(player\.name\)\)/, 'an NPC never becomes an attackable sleeper');
});

test('a controlled NPC joins no bracket or player-run party, and an NPC duel never reports as a raid', async () => {
    const { NPC_BLOCKED_ROUTES } = await import('./_npc-guard.js');
    const routes = readFileSync('server-api-routes.ts', 'utf8');
    for (const route of ['/tournaments/event', '/towers/start', '/towers/join', '/towers/party', '/pet/tactics', '/dojo-circuit/event']) {
        assert.ok(NPC_BLOCKED_ROUTES.includes(route), `${route} refuses an NPC token`);
        assert.ok(routes.includes(`route('${route}'`), `${route} is registered, so the guard wraps it`);
    }
    // Every world attack reports itself as a raid; the three raid paths all skip an NPC duel.
    for (const file of ['missions/report-raid.ts', 'pvp/claim-rewards.ts', 'pvp/_terminal-world-raid.ts']) {
        assert.match(readFileSync(`api/${file}`, 'utf8'), /npcDuel\?\.version (===|!==) 1/, `${file} treats an NPC duel as no raid`);
    }
    assert.match(readFileSync('api/missions/report-raid.ts', 'utf8'), /reason: 'npc-duel-not-raid'/);
});
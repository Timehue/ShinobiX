import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { PvpSession } from './pvp/session.js';

// Rival hunts (owner ruling 2026-11-10, LIMITED): a Cinderhold shinobi a player
// beat may come looking for them, at most once per player a day, within ten
// levels, never in the player's own village block and never while they are
// protected. It walks there and strikes only where both stand, through the
// real world attack.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-hunt-integration-secret-32-chars!';
process.env.DISABLE_COMBAT_RECEIPTS = '1';

let kv: typeof import('./_storage.js').kv;
let online: typeof import('./_realtime/online-store.js').onlineStore;
let hunt: typeof import('./_npc-hunt.js');
let roam: typeof import('./_npc-roam.js');
let duel: typeof import('./_npc-duel.js');
let merc: typeof import('./_merc-roam.js');
let rosterMod: typeof import('../shared/npc-village-roster.js');
let presence: typeof import('./_npc-presence.js');

const DAY = 86_400_000;
const SV = 'Stormveil Village';

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore: online } = await import('./_realtime/online-store.js'));
    hunt = await import('./_npc-hunt.js');
    roam = await import('./_npc-roam.js');
    duel = await import('./_npc-duel.js');
    merc = await import('./_merc-roam.js');
    rosterMod = await import('../shared/npc-village-roster.js');
    presence = await import('./_npc-presence.js');
    (await import('./_npc-duel-driver.js')).setNpcActionBeatForTest(0);
    await kv.set('npc-village:state', { baseLevel: 60, target: 60, sample: 30, computedAt: Date.now() });
    const seed = await import('./_npc-village-seed.js');
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
    const { seedHomeSectorOwnership } = await import('./world-state.js');
    await seedHomeSectorOwnership(Date.now());
});

beforeEach(async () => {
    await fresh();
    online.list().forEach((row) => online.remove(row.name));
});
after(() => { hunt.stopNpcHunts(); });

/** NPCs on duty for the next quarter hour, so nothing logs them off mid-test. */
function freeNpcs(now: number) {
    return rosterMod.NPC_VILLAGE_ROSTER.filter((n) => [0, 5, 10, 15].every((m) => !presence.npcOffDuty(n.id, now + m * 60_000)));
}
async function npcLevel(id: string): Promise<number> {
    return Number((await kv.get<Record<string, any>>(`save:${id}`))!.character.level);
}
async function standNpc(npc: { id: string; name: string }, sector: number) {
    const save = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    online.remove(npc.name);
    online.upsert({ name: npc.name, sector, character: save.character, tile: 60, tileSector: sector } as never);
}
async function player(name: string, level: number, sector: number, extra: Record<string, unknown> = {}) {
    const character = { name, level, village: SV, ryo: 0, unspentStats: 0, hp: 10000, maxHp: 10000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, stats: {}, equipment: {}, inventory: [], itemStacks: [], equippedJutsuIds: [], jutsu: [], jutsuMastery: [], ...extra };
    await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: sector, character });
    online.remove(name);
    online.upsert({ name, sector, character, tile: 62, tileSector: sector } as never);
}
async function beatenBy(npcId: string, rivals: Record<string, number>) {
    await kv.set(duel.npcDuelRecordKey(npcId), {
        wins: 0, losses: Object.keys(rivals).length, draws: 0,
        rivals: Object.fromEntries(Object.entries(rivals).map(([slug, at]) => [slug, { wins: 0, losses: 1, last: at, beatAt: at }])),
    });
}
const stubStrike = () => {
    const calls: Array<{ npc: string; target: string; sector: number }> = [];
    return { calls, strike: async (npc: { id: string }, target: string, sector: number) => { calls.push({ npc: npc.id, target, sector }); return { ok: true as const, battleId: `hunt-${calls.length}`, registered: false }; } };
};
const free = async () => true;
/** Forget every hunt, in memory and in its row (a restart would reload the row). */
async function fresh() { hunt.resetNpcHuntsForTest(); await kv.del(hunt.NPC_HUNTS_KEY); }

test('a hunt picks only a legal rival: beat it this week, within ten levels, unprotected, off cooldown, outside their home block', async () => {
    const now = Date.now();
    const npc = freeNpcs(now)[0]!;
    const level = await npcLevel(npc.id);
    await standNpc(npc, 58);
    // Every illegal rival beat it MORE recently than the legal one, so only the filters keep them out.
    await player('huntok', level - 5, 59);
    await player('huntlow', level - 15, 59);
    await player('hunthigh', level + 11, 59);
    await player('hunthome', level, 3); // Stormveil's own block
    await player('huntcastle', level, 47); // the castle city: legal since the NPCs roam the whole world (owner 2026-11-11), but beaten longer ago
    await player('huntsafe', level, 0); // in the village
    await player('huntold', level, 59);
    await player('huntshield', level, 59, { pvpShieldUntil: now + 3_600_000 });
    await player('hunthosp', level, 59, { hospitalized: true, hospitalizedUntil: now + 3_600_000 });
    await player('huntcool', level, 59);
    await player('hunthunted', level, 59);
    await merc.setMercTargetCooldown('huntcool', now);
    await kv.set(hunt.npcHuntedKey('hunthunted', now), 'earlier-battle');
    await beatenBy(npc.id, {
        huntok: now - 3 * 60 * 60_000, huntlow: now - 60_000, hunthigh: now - 60_000, hunthome: now - 60_000, huntcastle: now - 4 * 60 * 60_000,
        huntsafe: now - 60_000, huntold: now - 9 * DAY, huntshield: now - 60_000, hunthosp: now - 60_000, huntcool: now - 60_000, hunthunted: now - 60_000,
    });
    const { calls, strike } = stubStrike();
    const report = await hunt.runNpcHunts({ now, forcePick: true, npcFree: free, strike });
    assert.deepEqual(report.picked, [{ npc: npc.id, target: 'huntok', sector: 59 }]);
    // The castle city is open hunting ground now; only the rival's OWN village block is not.
    assert.equal(hunt.npcHuntSectorAllowed(47, [1, 2, 3, 4, 5, 6, 7, 8], []), true, 'the castle city is fair ground');
    assert.equal(hunt.npcHuntSectorAllowed(3, [1, 2, 3, 4, 5, 6, 7, 8], []), false, 'their own block never is');
    assert.equal(hunt.npcHuntSectorAllowed(3, [9, 10, 11, 12, 13, 14, 15, 16], []), true, 'another village\'s block is, for a rival from elsewhere');
    assert.equal(calls.length, 0, 'it has not struck: it stands in 58, the rival in 59');
    assert.deepEqual(roam.npcHuntRegistry().get(npc.id)?.homes, [1, 2, 3, 4, 5, 6, 7, 8], 'it remembers the rival\'s home block');
    assert.equal(hunt.npcHuntSectorAllowed(3, [1, 2, 3, 4, 5, 6, 7, 8], []), false);
    assert.equal(hunt.npcHuntSectorAllowed(59, [], [59]), false, 'never at a war front');
});

test('the hunter strikes only once it stands in the rival\'s sector, then never again that day', async () => {
    const now = Date.now();
    const [npc, other] = freeNpcs(now);
    const level = await npcLevel(npc!.id);
    await standNpc(npc!, 58);
    await player('huntprey', level, 59);
    await beatenBy(npc!.id, { huntprey: now - 60_000 });
    const { calls, strike } = stubStrike();
    await hunt.runNpcHunts({ now, forcePick: true, npcFree: free, strike });
    assert.equal(roam.npcHuntRegistry().get(npc!.id)?.target, 'huntprey');
    await hunt.runNpcHunts({ now: now + 20_000, npcFree: free, strike });
    assert.equal(calls.length, 0, 'not from the next sector');
    await standNpc(npc!, 59);
    const report = await hunt.runNpcHunts({ now: now + 40_000, npcFree: free, strike });
    assert.deepEqual(calls, [{ npc: npc!.id, target: 'huntprey', sector: 59 }]);
    assert.equal(report.struck[0]?.ok, true);
    assert.equal(roam.npcHuntRegistry().size, 0, 'the hunt is over');
    assert.ok(await kv.get(hunt.npcHuntedKey('huntprey', now + 40_000)), 'the day key is set when the strike opens');
    assert.ok((await merc.mercTargetsOnCooldown(['huntprey'], now + 60_000)).has('huntprey'), 'and the shared target cooldown');
    // Once per player per day, whoever else it beat (even with the 15-minute cooldown gone).
    await kv.del('merc:target-cd:huntprey');
    assert.equal((await merc.mercTargetsOnCooldown(['huntprey'], now + 60_000)).has('huntprey'), false);
    await standNpc(other!, 59);
    await beatenBy(other!.id, { huntprey: now - 30_000 });
    const again = await hunt.runNpcHunts({ now: now + 60_000, forcePick: true, npcFree: free, strike });
    assert.deepEqual(again.picked, []);
    await kv.del(hunt.npcHuntedKey('huntprey', now + 40_000));
    const nextDay = await hunt.runNpcHunts({ now: now + 61_000, forcePick: true, npcFree: free, strike });
    assert.deepEqual(nextDay.picked.map((p) => p.target), ['huntprey'], 'without the day key it would hunt again');
});

test('a rival who moves on is followed once, then the hunt lapses; an unanswered hunt lapses after ten minutes', async () => {
    const now = Date.now();
    const [a, b] = freeNpcs(now);
    const level = await npcLevel(a!.id);
    await standNpc(a!, 58);
    await player('huntrunner', level, 59);
    await beatenBy(a!.id, { huntrunner: now - 60_000 });
    const { calls, strike } = stubStrike();
    await hunt.runNpcHunts({ now, forcePick: true, npcFree: free, strike });
    await player('huntrunner', level, 60);
    const followed = await hunt.runNpcHunts({ now: now + 20_000, npcFree: free, strike });
    assert.deepEqual(followed.followed, [{ npc: a!.id, target: 'huntrunner', sector: 60 }]);
    await player('huntrunner', level, 37);
    const lapsed = await hunt.runNpcHunts({ now: now + 40_000, npcFree: free, strike });
    assert.equal(lapsed.lapsed[0]?.reason, 'moved-away');
    assert.equal(roam.npcHuntRegistry().size, 0);

    await fresh();
    await standNpc(b!, 58);
    await player('huntidle', level, 59);
    await beatenBy(b!.id, { huntidle: now - 60_000 });
    await hunt.runNpcHunts({ now, forcePick: true, npcFree: free, strike });
    assert.equal(roam.npcHuntRegistry().get(b!.id)?.target, 'huntidle');
    const late = await hunt.runNpcHunts({ now: now + hunt.NPC_HUNT_LAPSE_MS + 1, npcFree: free, strike });
    assert.equal(late.lapsed.find((l) => l.npc === b!.id)?.reason, 'lapsed');
    assert.equal(calls.length, 0);
});

test('one hunt per NPC and at most four at once; none while disabled or for a controlled NPC', async () => {
    const now = Date.now();
    const npcs = freeNpcs(now).slice(0, 6);
    for (const [i, npc] of npcs.entries()) {
        await standNpc(npc, 58);
        await player(`huntmany${i}`, await npcLevel(npc.id), 59);
        await player(`huntmore${i}`, await npcLevel(npc.id), 59);
        await beatenBy(npc.id, { [`huntmany${i}`]: now - 60_000, [`huntmore${i}`]: now - 90_000 });
    }
    const { strike } = stubStrike();
    const report = await hunt.runNpcHunts({ now, forcePick: true, npcFree: free, strike });
    assert.equal(report.picked.length, hunt.NPC_HUNT_MAX_ACTIVE);
    assert.equal(new Set(report.picked.map((p) => p.npc)).size, report.picked.length, 'one hunt per NPC');

    await fresh();
    process.env.DISABLE_NPC_VILLAGE = '1';
    try { assert.deepEqual((await hunt.runNpcHunts({ now, forcePick: true, npcFree: free, strike })).picked, []); }
    finally { delete process.env.DISABLE_NPC_VILLAGE; }

    // The real "free" check: an NPC under admin control never hunts (free, it does).
    await fresh();
    assert.ok((await hunt.runNpcHunts({ now, forcePick: true, strike })).picked.length > 0, 'the real check passes a free NPC');
    await fresh();
    const { npcPossessKey } = await import('./_npc-possession.js');
    for (const npc of npcs) await kv.set(npcPossessKey(npc.id), { by: 'admin', at: now, expiresAt: now + 600_000 });
    try { assert.deepEqual((await hunt.runNpcHunts({ now, forcePick: true, strike })).picked, []); }
    finally { for (const npc of npcs) await kv.del(npcPossessKey(npc.id)); }
});

test('a refused strike keeps EVERY hunter off that player for the hour, across a restart', async () => {
    const now = Date.now();
    const [a, b] = freeNpcs(now).filter((n) => !presence.npcOffDuty(n.id, now + hunt.NPC_HUNT_REFUSED_MS + 60_000));
    const level = await npcLevel(a!.id);
    await standNpc(a!, 59);
    await player('huntwarded', level, 59);
    await beatenBy(a!.id, { huntwarded: now - 60_000 });
    await beatenBy(b!.id, { huntwarded: now - 30_000 });
    const refuse = async () => ({ ok: false as const, step: 'attack' as const, reason: 'They are recovering.' });
    // b is not on the map yet, so only a picks; a stands with the player and is refused.
    online.remove(b!.name);
    await hunt.runNpcHunts({ now, forcePick: true, npcFree: free, strike: refuse as never });
    assert.equal(roam.npcHuntRegistry().get(a!.id)?.target, 'huntwarded');
    const refused = await hunt.runNpcHunts({ now: now + 20_000, npcFree: free, strike: refuse as never });
    assert.equal(refused.struck[0]?.ok, false);
    assert.equal(Number((await kv.get<{ until: number }>(hunt.npcHuntRefusedKey('huntwarded')))?.until), now + 20_000 + hunt.NPC_HUNT_REFUSED_MS, 'a stored mark');
    // A restart, and a second rival who beat them: nobody walks to the protected player again.
    hunt.resetNpcHuntsForTest();
    await standNpc(b!, 58);
    const { strike } = stubStrike();
    const again = await hunt.runNpcHunts({ now: now + 40_000, forcePick: true, npcFree: free, strike });
    assert.deepEqual(again.picked, [], JSON.stringify(again));
    // Once the hour is out, they are fair game again.
    const later = await hunt.runNpcHunts({ now: now + 20_000 + hunt.NPC_HUNT_REFUSED_MS + 1, forcePick: true, npcFree: free, strike });
    assert.deepEqual(later.picked.map((p) => p.target), ['huntwarded']);
    await kv.del(hunt.npcHuntRefusedKey('huntwarded'));
});

test('a hunt whose day key cannot be written ends WITHOUT a strike, in storage too, so neither a retry nor a restart strikes', async (t) => {
    const now = Date.now();
    const [npc] = freeNpcs(now);
    const level = await npcLevel(npc!.id);
    await standNpc(npc!, 59);
    await player('huntflaky', level, 59);
    await beatenBy(npc!.id, { huntflaky: now - 60_000 });
    const { calls, strike } = stubStrike();
    await hunt.runNpcHunts({ now, forcePick: true, npcFree: free, strike });
    assert.equal(roam.npcHuntRegistry().get(npc!.id)?.target, 'huntflaky');
    const real = kv.set;
    const failing = t.mock.method(kv, 'set', async (key: string, value: unknown, opts?: { ex?: number; nx?: boolean }) => {
        if (key.startsWith('npc-village:hunted:')) throw new Error('disk full');
        return real(key, value, opts);
    });
    // The day key is claimed BEFORE the strike: unable to record "struck today",
    // the hunt must not strike at all (a later crash could otherwise strike twice).
    const report = await hunt.runNpcHunts({ now: now + 20_000, npcFree: free, strike });
    failing.mock.restore();
    assert.equal(report.struck.length, 0, 'the step does not throw, and does not strike');
    assert.equal(calls.length, 0, 'no strike without the day key');
    const stored = await kv.get<{ hunts?: Record<string, unknown> }>(hunt.NPC_HUNTS_KEY);
    assert.equal(stored?.hunts?.[npc!.id], undefined, 'the hunt\'s end was stored');
    // A restart reloads the stored row: no hunt is left to strike.
    hunt.resetNpcHuntsForTest();
    await hunt.runNpcHunts({ now: now + 40_000, npcFree: free, strike });
    assert.equal(calls.length, 0, 'no strike after a restart either');
});

test('the day key is claimed before the strike: a crash mid-strike leaves the player struck for the day, never twice', async () => {
    const now = Date.now();
    const npcs = freeNpcs(now);
    const npc = npcs[npcs.length - 1]!;
    const level = await npcLevel(npc.id);
    await standNpc(npc, 59);
    await player('huntmidcrash', level, 59);
    await beatenBy(npc.id, { huntmidcrash: now - 60_000 });
    await hunt.runNpcHunts({ now, forcePick: true, npcFree: free, strike: stubStrike().strike });
    assert.equal(roam.npcHuntRegistry().get(npc.id)?.target, 'huntmidcrash');
    let seenAtStrike: unknown = 'unread';
    let storedAtStrike: unknown = 'unread';
    const crashing = async () => {
        seenAtStrike = await kv.get(hunt.npcHuntedKey('huntmidcrash', now));
        storedAtStrike = (await kv.get<{ hunts?: Record<string, unknown> }>(hunt.NPC_HUNTS_KEY))?.hunts?.[npc.id];
        throw new Error('process died');
    };
    await hunt.runNpcHunts({ now: now + 20_000, npcFree: free, strike: crashing as never });
    assert.equal(seenAtStrike, 'striking', 'the day key was already claimed when the strike began');
    assert.equal(storedAtStrike, undefined, 'and the hunt\'s end was already stored');
    // A strike that threw (no fight opened) releases the day, and is no ATTACK
    // refusal, so the player is not marked unhuntable for the hour.
    assert.equal(await kv.get(hunt.npcHuntedKey('huntmidcrash', now)), null);
    assert.equal(await kv.get(hunt.npcHuntRefusedKey('huntmidcrash')), null);
});

test('the strike is the real world attack: a protected rival is refused, a free one gets an ordinary NPC world duel', async () => {
    const now = Date.now();
    const [npc, second] = freeNpcs(now);
    const level = await npcLevel(npc!.id);
    // Shielded after the hunt began: the attack route refuses, and nothing is spent.
    await standNpc(npc!, 59);
    await player('huntguarded', level, 59);
    await beatenBy(npc!.id, { huntguarded: now - 60_000 });
    await hunt.runNpcHunts({ now, forcePick: true, npcFree: free });
    assert.equal(roam.npcHuntRegistry().get(npc!.id)?.target, 'huntguarded');
    const save = (await kv.get<Record<string, any>>('save:huntguarded'))!;
    await kv.set('save:huntguarded', { ...save, character: { ...save.character, pvpShieldUntil: Date.now() + 3_600_000 } });
    const refused = await hunt.runNpcHunts({ now: now + 20_000, npcFree: free });
    assert.equal(refused.struck[0]?.ok, false, JSON.stringify(refused));
    assert.match(String(refused.struck[0]?.reason), /recovering/i);
    assert.equal(await kv.get(hunt.npcHuntedKey('huntguarded', now)), null, 'a refused strike spends nothing');

    // A free rival: a real duel, the NPC attacking from seat p1, paid to the player under the NPC rule.
    await standNpc(second!, 59);
    await player('huntduel', await npcLevel(second!.id), 59);
    await beatenBy(second!.id, { huntduel: now - 60_000 });
    await hunt.runNpcHunts({ now: now + 40_000, forcePick: true, npcFree: free });
    const struck = await hunt.runNpcHunts({ now: now + 60_000, npcFree: free });
    const hit = struck.struck.find((s) => s.target === 'huntduel');
    assert.equal(hit?.ok, true, JSON.stringify(struck));
    const session = (await kv.get<PvpSession>(`pvp:${hit!.battleId}`))!;
    assert.equal(session.rewardAuthority, 'world');
    assert.equal(String(session.p1.name), second!.name);
    assert.equal(String(session.p2.name).toLowerCase(), 'huntduel');
    assert.equal(session.npcDuel?.seat, 'p1');
    assert.equal(session.npcDuel?.paid, true, 'the first fight against this NPC today pays the player');
    assert.equal(await kv.get(hunt.npcHuntedKey('huntduel', now)), hit!.battleId);
});

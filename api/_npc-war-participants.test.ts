import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

// Owner ruling 2026-11-11: like a player village, where anyone level 15+ can
// fight in a war, Cinderhold's Genin and Chunin whose LIVE level is 15 or more
// take the war jobs its ANBU take, at villager weight. Under 15 they stay out.
// The ANBU set itself (Commanders, Elites, Jonin) is unchanged. Every NPC here
// is picked by rank and live level, never by id or name.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-war-participants-test-secret-32ch';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.DISABLE_NPC_VILLAGE;

const CH = 'Cinderhold Village';
const MOON = 'Moonshadow Village';

let kv: typeof import('./_storage.js').kv;
let war: typeof import('./_npc-war-roster.js');
let all: typeof import('../shared/npc-village-roster.js').NPC_VILLAGE_ROSTER;
type Npc = (typeof all)[number];

/** A Chunin who is level 20 and a Genin who is level 12; every other Genin and Chunin sits at 12. */
let high: Npc;
let low: Npc;

async function setLevel(npc: Npc, level: number, village = CH): Promise<void> {
    const save = (await kv.get<Record<string, any>>(`save:${npc.id}`)) ?? { character: { name: npc.name } };
    save.character = { ...save.character, level, village };
    await kv.set(`save:${npc.id}`, save);
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    war = await import('./_npc-war-roster.js');
    ({ NPC_VILLAGE_ROSTER: all } = await import('../shared/npc-village-roster.js'));
    await kv.set('npc-village:state', { baseLevel: 60, target: 60, sample: 30, computedAt: Date.now() });
    const seed = await import('./_npc-village-seed.js');
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
    high = all.find((n) => n.rank === 'chunin')!;
    low = all.find((n) => n.rank === 'genin')!;
    for (const npc of war.NPC_WAR_RESERVES) await setLevel(npc, npc.id === high.id ? 20 : 12);
    war.resetNpcWarParticipantsCacheForTest();
});

describe('who takes war jobs', { concurrency: false }, () => {
    it('the ANBU always, first; a Genin or Chunin only at live level 15+ and still in Cinderhold', async () => {
        const now = Date.now();
        const list = await war.npcWarParticipants(now);
        const ids = list.map((n) => n.id);
        assert.deepEqual(ids.slice(0, war.NPC_WAR_DEFENDERS.length), war.NPC_WAR_DEFENDERS.map((n) => n.id), 'the ANBU lead the list');
        assert.ok(ids.includes(high.id), 'a level-20 Chunin fights');
        assert.ok(!ids.includes(low.id), 'a level-12 Genin stays out');
        assert.equal(list.length, war.NPC_WAR_DEFENDERS.length + 1);
        assert.deepEqual(war.NPC_WAR_RESERVES.map((n) => n.rank).sort(), all.filter((n) => !war.isNpcWarDefenderRank(n.rank)).map((n) => n.rank).sort());

        // The boundary is 15 itself, and a reserve that left Cinderhold is out.
        const pure = (level: number, village = CH) => war.npcWarParticipantsFrom((id) => (id === low.id ? { level, village } : null)).some((n) => n.id === low.id);
        assert.equal(pure(14), false);
        assert.equal(pure(15), true);
        assert.equal(pure(40, MOON), false);
        assert.equal(war.npcWarParticipantsFrom(() => null).length, war.NPC_WAR_DEFENDERS.length, 'no saves: the ANBU alone');
    });

    it('one read serves a minute; a level-up shows after it', async () => {
        war.resetNpcWarParticipantsCacheForTest();
        const t0 = Date.now();
        assert.ok(!(await war.npcWarParticipants(t0)).some((n) => n.id === low.id));
        await setLevel(low, 16);
        assert.ok(!(await war.npcWarParticipants(t0 + 30_000)).some((n) => n.id === low.id), 'cached');
        assert.ok((await war.npcWarParticipants(t0 + war.NPC_WAR_PARTICIPANTS_CACHE_MS + 1)).some((n) => n.id === low.id), 'read again');
        await setLevel(low, 12);
        war.resetNpcWarParticipantsCacheForTest();
        assert.ok(!(await war.npcWarParticipants(t0)).some((n) => n.id === low.id));
    });

    it('the ANBU list itself is unchanged: readVillageAnbu and the AI-copy defender see only Commanders, Elites and Jonin', async () => {
        const { readVillageAnbu } = await import('./village/_anbu.js');
        const anbu = await readVillageAnbu(CH);
        assert.deepEqual(anbu.members, war.NPC_WAR_DEFENDERS.map((n) => n.id));
        assert.ok(!anbu.members.includes(high.id));
        assert.ok(war.NPC_WAR_DEFENDERS.every((n) => ['commander', 'elite', 'jonin'].includes(n.rank)));
    });
});

describe('a war-eligible Genin or Chunin scores as a villager', () => {
    it('Commander Elder, Jonin ANBU, a level-15+ Chunin and a Genin villagers', async () => {
        const { sectorWarRoleOf, ROLE_ELDER, ROLE_ANBU, ROLE_VILLAGER } = await import('./_war-role.js');
        const commander = all.find((n) => n.rank === 'commander')!;
        const jonin = all.find((n) => n.rank === 'jonin')!;
        assert.deepEqual(await sectorWarRoleOf(commander.id, CH), ROLE_ELDER);
        assert.deepEqual(await sectorWarRoleOf(jonin.id, CH), ROLE_ANBU);
        assert.deepEqual(await sectorWarRoleOf(high.id, CH), ROLE_VILLAGER, 'a level-20 Chunin fights, but at villager weight');
        assert.deepEqual(await sectorWarRoleOf(low.id, CH), ROLE_VILLAGER);
        assert.deepEqual(ROLE_VILLAGER, { win: 5, loss: 0 });
    });
});

describe('war fronts', () => {
    it('the ANBU take the front first; a level-15+ Chunin fills in for them; a level-12 Genin never stands there', async () => {
        const { npcPosts, NPC_FRONT_SQUAD } = await import('./_npc-presence.js');
        const now = Date.now();
        const eligible = new Set((await war.npcWarParticipants(now)).map((n) => n.id));
        const at = (posts: Map<string, { sector: number }>) => [...posts].filter(([, p]) => p.sector === 18).map(([id]) => id);

        const healthy = at(npcPosts(now, all, [18], new Set(), { warParticipants: eligible }));
        assert.equal(healthy.length, NPC_FRONT_SQUAD);
        assert.ok(healthy.every((id) => war.NPC_WAR_DEFENDERS.some((n) => n.id === id)), 'the ANBU lead while they can');

        // Every ANBU beaten: the eligible Chunin holds the front, the Genin does not.
        const anbuDown = new Set(war.NPC_WAR_DEFENDERS.map((n) => n.id));
        const front = at(npcPosts(now, all, [18], anbuDown, { warParticipants: eligible }));
        assert.deepEqual(front, [high.id]);
        assert.ok(!front.includes(low.id));
        // Without the participants set (the old call), the front stands empty.
        assert.deepEqual(at(npcPosts(now, all, [18], anbuDown)), []);
    });

    it('the war party strikes with a level-15+ Chunin when no ANBU is free, never a level-12 Genin; ANBU first when free', async () => {
        const party = await import('./_npc-war-party.js');
        const sw = await import('./_sector-war.js');
        const contest = sw.newSectorWarSession({ sector: 18, attackerVillage: CH, defenderVillage: MOON, winCondition: 'combat', now: Date.now() - 3_600_000 });
        const run = async (free: (id: string) => boolean, target: string) => {
            const duels: Array<{ npc: string }> = [];
            await party.runNpcWarParty({
                now: contest.startedAt + 60_000,
                listContests: async () => [contest],
                onlineIn: () => [target],
                targetsOf: async (names, village) => names.map((name) => ({ name, village, hp: 50, maxHp: 100 })),
                npcFree: async (id) => free(id),
                sealNpc: async (n) => ({ npc: n, name: n.name, level: 20, character: { name: n.name } }),
                standsIn: () => true,
                runFight: () => { throw new Error('a strike on a player is a real duel, never an instant fight'); },
                openDuel: async (n) => { duels.push({ npc: n.id }); return { ok: true, battleId: `d-${n.id}`, registered: true }; },
                participants: war.npcWarParticipants,
            });
            return duels.map((d) => d.npc);
        };
        const anbu = new Set(war.NPC_WAR_DEFENDERS.map((n) => n.id));
        assert.ok(anbu.has((await run(() => true, 'moonwpa'))[0]!), 'an ANBU strikes while one is free');
        assert.deepEqual(await run((id) => !anbu.has(id), 'moonwpb'), [high.id], 'the Chunin strikes in their place');
        assert.deepEqual(await run((id) => id === low.id, 'moonwpc'), [], 'a Genin under 15 never strikes');
    });
});

describe('a beaten war-eligible Genin or Chunin is wounded for three hours like the others', () => {
    it('the war wound and the presence plan are rank-agnostic', async () => {
        const wounds = await import('./_npc-wounds.js');
        const { npcPosts } = await import('./_npc-presence.js');
        const now = Date.now();
        await wounds.woundNpc(high.id, now, 'moonwfighter');
        assert.equal(await wounds.isNpcWounded(high.id, now), true);
        assert.equal(await wounds.isNpcWounded(high.id, now + wounds.NPC_WAR_WOUND_MS + 1), false, 'healed after three hours');
        assert.ok((await wounds.woundedNpcIds(now)).has(high.id));
        const posts = npcPosts(now, all, [18], await wounds.woundedNpcIds(now), { warParticipants: new Set([high.id]) });
        assert.equal(posts.has(high.id), false, 'off the map while recovering');
    });
});

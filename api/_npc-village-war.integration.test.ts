import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-village-war-test-secret-32-bytes-long';
process.env.ADMIN_PASSWORD = 'npc-village-war-admin';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.DISABLE_NPC_VILLAGE;

/*
 * Push 4 (owner rulings 2026-11-10): Cinderhold fights sector wars both ways.
 * A player Kage declares on its land through the normal declare; Cinderhold
 * proposes its own wars at War-Ready and an admin approves them. Its
 * Commanders, Elites and Jonin hold its garrisons and fight its war party, and
 * nothing in a war ever pays an NPC.
 */

const CH = 'Cinderhold Village';
const MOON = 'Moonshadow Village';
type Handler = (req: never, res: never) => Promise<unknown>;
type Out = { statusCode: number; body?: Record<string, any> };

let kv: typeof import('./_storage.js').kv;
let issuePlayerToken: (name: string) => string | null;
let sectorWar: Handler;
let warMap: Handler;
let adminNpc: Handler;
let maps: typeof import('./_war-map-sectors.js');
let sw: typeof import('./_sector-war.js');
let war: typeof import('./_npc-village-war.js');
let party: typeof import('./_npc-war-party.js');
let roster: typeof import('./_npc-war-roster.js');
let aggression: typeof import('./_npc-village-aggression.js');

function unwrap(mod: { default: unknown }): Handler {
    const inner = mod.default as { default?: unknown };
    return (inner?.default ?? inner) as Handler;
}

async function call(handler: Handler, player: string | null, body: Record<string, unknown> | null, method = 'POST'): Promise<Out> {
    const out: Out = { statusCode: 200 };
    const res = {
        setHeader: () => res, getHeader: () => undefined,
        status(code: number) { out.statusCode = code; return res; },
        json(payload: Record<string, any>) { out.body = payload; return res; },
        end: () => res,
    };
    const headers: Record<string, string> = player
        ? { 'x-player-name': player, 'x-player-token': issuePlayerToken(player) ?? '' }
        : { 'x-admin-password': process.env.ADMIN_PASSWORD! };
    await handler({ method, body: body ?? undefined, query: {}, headers, socket: { remoteAddress: '127.0.0.1' } } as never, res as never);
    return out;
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ issuePlayerToken } = await import('./_auth.js'));
    sectorWar = unwrap(await import('./village/sector-war.js'));
    warMap = unwrap(await import('./village/war-map.js'));
    adminNpc = unwrap(await import('./admin/npc-possess.js'));
    maps = await import('./_war-map-sectors.js');
    sw = await import('./_sector-war.js');
    war = await import('./_npc-village-war.js');
    party = await import('./_npc-war-party.js');
    roster = await import('./_npc-war-roster.js');
    aggression = await import('./_npc-village-aggression.js');
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    war.resetNpcWarFrontsCacheForTest();
    // Cinderhold's thirty accounts exist (the seeder's auth stamp): only an
    // account the seeder owns is ever driven as an NPC (api/_npc-ownership.ts).
    const { NPC_VILLAGE_ROSTER } = await import('../shared/npc-village-roster.js');
    for (const npc of NPC_VILLAGE_ROSTER) await kv.set(`auth:${npc.id}`, { createdAt: 1, npcVillage: true });
    (await import('./_npc-ownership.js')).forgetNpcOwnership();
    roster.resetNpcWarParticipantsCacheForTest();
});

after(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    delete process.env.SHINOBIX_QA_MEMORY_KV;
    delete process.env.ADMIN_PASSWORD;
});

/** Every player village's home block held by its home village, Cinderhold seeded. */
async function seedWorld(now = Date.now()) {
    const { seedHomeSectorOwnership } = await import('./world-state.js');
    await seedHomeSectorOwnership(now);
}

describe('Cinderhold is a sector-war village, not a player war village', () => {
    it('holds 67-74 with 67 as its protected gate, outside WAR_VILLAGES', () => {
        assert.ok(maps.SECTOR_WAR_VILLAGES.includes(CH as never));
        assert.ok(!(maps.WAR_VILLAGES as readonly string[]).includes(CH));
        assert.equal(maps.isWarVillage(CH), false);
        assert.equal(maps.isSectorWarVillage(CH), true);
        for (const s of [67, 68, 69, 70, 71, 72, 73, 74]) {
            assert.equal(maps.isWarSector(s), true, `sector ${s}`);
            assert.equal(maps.homeVillageForSector(s), CH);
        }
        assert.equal(maps.isProtectedWarSector(67), true);
        assert.equal(maps.isProtectedWarSector(70), false);
        assert.equal(maps.sectorAlias(67), 'CH-1');
        assert.equal(maps.VILLAGE_BIOME[CH as 'Cinderhold Village'], 'volcano');
    });

    it('a player can declare on Cinderhold land and Cinderhold on theirs, never on a gate', () => {
        const base = { winCondition: 'combat' as const, attackerInActiveVillageWar: false, defenderInActiveVillageWar: false,
            contestAlreadyActive: false, attackerWr: 10_000, attackerSectorsHeld: 8, allowedWinConditions: ['combat'] as const };
        assert.deepEqual(sw.canDeclareSectorWar({ ...base, attackerVillage: MOON, defenderVillage: CH, sector: 70, sectorOwnerVillage: CH }), { ok: true, cost: 250 });
        assert.equal(sw.canDeclareSectorWar({ ...base, attackerVillage: MOON, defenderVillage: CH, sector: 67, sectorOwnerVillage: CH }).ok, false);
        assert.equal(sw.canDeclareSectorWar({ ...base, attackerVillage: CH, defenderVillage: MOON, sector: 18, sectorOwnerVillage: MOON }).ok, true);
        assert.equal(sw.canDeclareSectorWar({ ...base, attackerVillage: CH, defenderVillage: MOON, sector: 17, sectorOwnerVillage: MOON }).ok, false, 'a gate');
    });

    it('its default war record fights every sector in Combat on volcanic ground', async () => {
        const { normalizeVillageWarRecord, sectorConfigFor } = await import('./_war-state.js');
        const record = normalizeVillageWarRecord(CH, undefined);
        for (const s of [67, 68, 69, 70, 71, 72, 73, 74]) assert.deepEqual(sectorConfigFor(record, s), { winCondition: 'combat', terrain: 'volcano' });
    });
});

describe('Cinderhold war roles come from its roster', () => {
    it('its ANBU are its Commanders, Elites and Jonin; no Kage stands in (the roster has none)', async () => {
        const { readVillageAnbu } = await import('./village/_anbu.js');
        const { seatedKageOf } = await import('./_sector-war-garrison-defender.js');
        const anbu = await readVillageAnbu(CH);
        assert.deepEqual(anbu.members, roster.NPC_WAR_DEFENDERS.map((n) => n.id));
        assert.ok(roster.NPC_WAR_DEFENDERS.every((n) => ['commander', 'elite', 'jonin'].includes(n.rank)));
        assert.equal(roster.NPC_WAR_DEFENDERS.length, 15);
        assert.equal(await seatedKageOf(CH), '');
    });

    it('fights at roster weight: Commanders as Elders, Elites and Jonin as ANBU, the rest as villagers', async () => {
        const { sectorWarRoleOf, ROLE_ELDER, ROLE_ANBU, ROLE_VILLAGER } = await import('./_war-role.js');
        const { NPC_VILLAGE_ROSTER } = await import('../shared/npc-village-roster.js');
        const commander = roster.NPC_WAR_DEFENDERS.find((n) => n.rank === 'commander')!;
        const jonin = roster.NPC_WAR_DEFENDERS.find((n) => n.rank === 'jonin')!;
        const genin = NPC_VILLAGE_ROSTER.find((n) => n.rank === 'genin')!;
        for (const npc of [commander, jonin, genin]) await kv.set(`save:${npc.id}`, { character: { name: npc.name, village: CH } });
        assert.deepEqual(await sectorWarRoleOf(commander.id, CH), ROLE_ELDER);
        assert.deepEqual(await sectorWarRoleOf(jonin.id, CH), ROLE_ANBU);
        assert.deepEqual(await sectorWarRoleOf(genin.id, CH), ROLE_VILLAGER);
    });
});

describe('players declare on Cinderhold through the normal path', { concurrency: false }, () => {
    it('Cinderhold territory is seeded once, and a captured sector keeps its owner', async () => {
        await kv.set('world:territory:71', { sector: 71, ownerVillage: MOON, hp: 20_000, updatedAt: Date.now() });
        const first = await war.seedNpcVillageTerritory();
        assert.deepEqual(first.sectors, [67, 68, 69, 70, 72, 73, 74]);
        assert.equal((await kv.get<Record<string, unknown>>('world:territory:71'))?.ownerVillage, MOON);
        assert.equal((await war.seedNpcVillageTerritory()).seeded, 0);
    });

    it('a Kage declares on Sector 70 and fights it in Combat on volcanic ground; the gate refuses', async () => {
        await seedWorld();
        await kv.set('save:moonkage', { character: { name: 'moonkage', village: MOON } });
        await kv.set('village:kage:moonshadow-village', { seatedKage: 'moonkage' });
        await kv.set('shared:village-war:moonshadowvillage', { warResources: 1_000, structures: {}, sectors: {} });
        const declared = await call(sectorWar, 'moonkage', { action: 'declare', playerName: 'moonkage', village: MOON, sector: 70 });
        assert.equal(declared.statusCode, 200, JSON.stringify(declared.body));
        assert.equal(declared.body?.contest?.defenderVillage, CH);
        assert.equal(declared.body?.contest?.winCondition, 'combat');
        assert.equal((await kv.get<Record<string, unknown>>(`shared:sector-war:${sw.sectorWarId(70, MOON, CH)}`))?.terrain, 'volcano');
        const gate = await call(sectorWar, 'moonkage', { action: 'declare', playerName: 'moonkage', village: MOON, sector: 67 });
        assert.notEqual(gate.statusCode, 200);
        assert.deepEqual(await war.npcWarFronts(), [70], 'the presence tick sends a squad to Sector 70');
    });

    it('the war map lists what Cinderhold holds, as a public view', async () => {
        await seedWorld();
        await kv.set('save:moonkage', { character: { name: 'moonkage', village: MOON } });
        const out = await call(warMap, 'moonkage', null, 'GET');
        assert.equal(out.statusCode, 200, JSON.stringify(out.body));
        const ch = (out.body?.villages as Array<Record<string, any>>).find((v) => v.village === CH);
        assert.ok(ch, 'Cinderhold is on the war map');
        assert.deepEqual(ch.sectors.map((s: { sector: number }) => s.sector), [67, 68, 69, 70, 71, 72, 73, 74]);
    });
});

describe('Cinderhold proposes; an admin approves or rejects', { concurrency: false }, () => {
    const ready = (value: number, extra: Partial<Record<string, number>> = {}) => ({ byVillage: { 'Frostfang Village': 0, 'Stormveil Village': 0, 'Ashen Leaf Village': 0, [MOON]: value, ...extra } as never });
    const owners = (): Record<number, string> => {
        const o: Record<number, string> = {};
        for (const v of maps.SECTOR_WAR_VILLAGES) for (const s of maps.homeSectorsForVillage(v)) o[s] = v;
        return o;
    };
    const combat = () => Object.fromEntries(Object.keys(owners()).map((s) => [Number(s), 'combat']));

    it('picks the hottest War-Ready village with enough active players, never a gate, a contested or a non-Combat sector', () => {
        const base = { owners: owners(), contestedSectors: new Set<number>(), villagesAtWar: new Set<string>(), winConditions: combat() };
        assert.deepEqual(war.chooseNpcWarTarget({ ...base, aggression: ready(60), activePlayers: { [MOON]: 9 } }), { reason: 'none-war-ready' });
        assert.deepEqual(war.chooseNpcWarTarget({ ...base, aggression: ready(90), activePlayers: { [MOON]: 4 } }), { reason: 'too-few-active' });
        assert.deepEqual(war.chooseNpcWarTarget({ ...base, aggression: ready(90), activePlayers: { [MOON]: 5 } }), { village: MOON, sector: 18, aggression: 90 });
        assert.deepEqual(war.chooseNpcWarTarget({ ...base, aggression: ready(90, { 'Stormveil Village': 95 }), activePlayers: { [MOON]: 5, 'Stormveil Village': 5 } }),
            { village: 'Stormveil Village', sector: 2, aggression: 95 }, 'the hottest village first');
        assert.deepEqual(war.chooseNpcWarTarget({ ...base, contestedSectors: new Set([18]), winConditions: { ...combat(), 19: 'pet' }, aggression: ready(90), activePlayers: { [MOON]: 5 } }),
            { village: MOON, sector: 20, aggression: 90 }, 'skips a contested sector and a Pet sector');
        assert.deepEqual(war.chooseNpcWarTarget({ ...base, owners: { ...owners(), 72: MOON }, aggression: ready(90), activePlayers: { [MOON]: 5 } }),
            { village: MOON, sector: 72, aggression: 90 }, 'takes its own land back first');
        assert.deepEqual(war.chooseNpcWarTarget({ ...base, villagesAtWar: new Set([MOON]), aggression: ready(90), activePlayers: { [MOON]: 5 } }), { reason: 'no-open-sector' });
    });

    it('an approved proposal declares through the real path, funds itself, consumes the proposal and cools the meter', async () => {
        await seedWorld();
        const now = Date.now();
        await kv.set(aggression.NPC_AGGRESSION_KEY, { ...aggression.emptyAggression(now), byVillage: { ...aggression.emptyAggression(now).byVillage, [MOON]: 88 } });
        const proposal = { id: 'npc-war-test', village: MOON, sector: 18, aggression: 88, createdAt: now, expiresAt: now + war.NPC_WAR_PROPOSAL_TTL_MS };
        await kv.set(war.NPC_WAR_PROPOSAL_KEY, proposal);

        const listing = await call(adminNpc, null, null, 'GET');
        assert.equal(listing.body?.war?.proposal?.id, 'npc-war-test');

        const approved = await call(adminNpc, null, { action: 'war-approve', proposalId: 'npc-war-test' });
        assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
        const contest = await kv.get<Record<string, any>>(`shared:sector-war:${sw.sectorWarId(18, CH, MOON)}`);
        assert.equal(contest?.attackerVillage, CH);
        assert.equal(contest?.defenderVillage, MOON);
        assert.equal(await war.readNpcWarProposal(), null, 'the proposal is spent');
        assert.ok((await war.readNpcWarHistory()).lastDeclaredAt);
        assert.equal((await aggression.readNpcAggression()).byVillage[MOON], war.NPC_WAR_AGGRESSION_AFTER_DECLARE);
        const pool = await kv.get<Record<string, any>>('shared:village-war:cinderholdvillage');
        assert.equal(pool?.warResources, 0, 'funded with exactly the cost, then spent');

        // One NPC war at a time, and the 14-day cooldown.
        assert.deepEqual(await war.proposeNpcWar(), { skipped: 'cooldown' });
    });

    it('Cinderhold retakes its own home sector whatever win condition the player holder set, and fights it in Combat (owner ruling 2026-11-11)', async () => {
        const { npcReclaimsHomeSector } = await import('../shared/npc-village.js');
        const base = { owners: { ...owners(), 72: MOON }, contestedSectors: new Set<number>(), villagesAtWar: new Set<string>(), aggression: ready(90), activePlayers: { [MOON]: 5 } };
        // A player-held Cinderhold home sector set to Card is still proposed...
        assert.deepEqual(war.chooseNpcWarTarget({ ...base, winConditions: { ...combat(), 72: 'card' } }), { village: MOON, sector: 72, aggression: 90 });
        assert.deepEqual(war.chooseNpcWarTarget({ ...base, winConditions: { ...combat(), 72: 'pet' } }), { village: MOON, sector: 72, aggression: 90 });
        // ...while the player's own land keeps its rule: a Card sector of theirs is still skipped.
        assert.deepEqual(war.chooseNpcWarTarget({ ...base, owners: owners(), winConditions: { ...combat(), 18: 'card' } }), { village: MOON, sector: 19, aggression: 90 });
        assert.equal(npcReclaimsHomeSector(CH, 72), true);
        assert.equal(npcReclaimsHomeSector(CH, 67), false, 'never its gate');
        assert.equal(npcReclaimsHomeSector(CH, 18), false, 'not a player village sector');
        assert.equal(npcReclaimsHomeSector('Stormveil Village', 72), false, 'a player village keeps the holder\'s rule, even on Cinderhold land');

        // Through the real declare: the holder set 72 to Card, the war is sealed Combat.
        await seedWorld();
        const now = Date.now();
        await kv.set('world:territory:72', { sector: 72, ownerVillage: MOON, hp: 20_000, updatedAt: now });
        await kv.set('shared:village-war:moonshadowvillage', { warResources: 0, structures: {}, sectors: { 72: { winCondition: 'card', terrain: 'volcano' } } });
        await kv.set(war.NPC_WAR_PROPOSAL_KEY, { id: 'npc-war-retake', village: MOON, sector: 72, aggression: 90, createdAt: now, expiresAt: now + 60_000 });
        const approved = await call(adminNpc, null, { action: 'war-approve', proposalId: 'npc-war-retake' });
        assert.equal(approved.statusCode, 200, JSON.stringify(approved.body));
        const contest = await kv.get<Record<string, any>>(`shared:sector-war:${sw.sectorWarId(72, CH, MOON)}`);
        assert.equal(contest?.attackerVillage, CH);
        assert.equal(contest?.winCondition, 'combat', 'fought in Combat whatever the holder set');
        // So it is a front: the presence tick posts its squad there and the war party presses it.
        assert.deepEqual(await war.npcWarFronts(), [72]);
    });

    it('an approval refuses, unfunded, when the sector changed hands since the proposal', async () => {
        await seedWorld();
        const now = Date.now();
        await kv.set('world:territory:18', { sector: 18, ownerVillage: 'Stormveil Village', hp: 20_000, updatedAt: now });
        await kv.set(war.NPC_WAR_PROPOSAL_KEY, { id: 'npc-war-moved', village: MOON, sector: 18, aggression: 80, createdAt: now, expiresAt: now + 60_000 });
        const out = await call(adminNpc, null, { action: 'war-approve', proposalId: 'npc-war-moved' });
        assert.equal(out.statusCode, 409, JSON.stringify(out.body));
        assert.equal(await kv.get('shared:village-war:cinderholdvillage'), null, 'nothing was funded');
        assert.ok(await war.readNpcWarProposal(), 'the proposal stays for the admin to reject');
    });

    it('a rejection removes the proposal and waits a day; a stale id is refused', async () => {
        const now = Date.now();
        await kv.set(war.NPC_WAR_PROPOSAL_KEY, { id: 'npc-war-r', village: MOON, sector: 18, aggression: 80, createdAt: now, expiresAt: now + 60_000 });
        assert.equal((await call(adminNpc, null, { action: 'war-reject', proposalId: 'other' })).statusCode, 409);
        assert.equal((await call(adminNpc, null, { action: 'war-reject', proposalId: 'npc-war-r' })).statusCode, 200);
        assert.equal(await war.readNpcWarProposal(), null);
        assert.deepEqual(await war.proposeNpcWar(), { skipped: 'rejected-recently' });
    });

    it('a player token cannot approve, and an NPC token cannot touch the war routes', async () => {
        const { NPC_BLOCKED_ROUTES } = await import('./_npc-guard.js');
        for (const route of ['/war/claim-reward', '/village/claim-map-control', '/village/claim-war-crate', '/village/open-war-crate', '/village/sector-war', '/village/war-merc', '/village/anbu-infiltration']) {
            assert.ok(NPC_BLOCKED_ROUTES.includes(route), route);
        }
        await kv.set('save:someone', { character: { name: 'someone', village: MOON } });
        const out = await call(adminNpc, 'someone', { action: 'war-approve', proposalId: 'x' });
        assert.equal(out.statusCode, 403);
    });
});

describe('the war party presses Cinderhold\'s wars', () => {
    const { ROLE_ANBU, ROLE_VILLAGER } = { ROLE_ANBU: { win: 15, loss: 0 }, ROLE_VILLAGER: { win: 5, loss: 0 } };
    const npc = () => roster.NPC_WAR_DEFENDERS[0]!;

    function harness(contest: import('./_sector-war.js').SectorWarSession, opts: { targets?: string[]; winner: 'merc' | 'player' | 'stall'; free?: boolean; garrison?: boolean; away?: boolean; refuse?: boolean }) {
        let live = contest;
        const fights: Array<Record<string, unknown>> = [];
        const duels: Array<{ npc: string; target: string; sector: number }> = [];
        const decisions: Array<Record<string, any>> = [];
        const deps: import('./_npc-war-party.js').NpcWarPartyDeps = {
            now: contest.startedAt + 60_000,
            listContests: async () => [live],
            onlineIn: () => opts.targets ?? [],
            targetsOf: async (names, village) => names.map((name) => ({ name, village, hp: 50, maxHp: 100 })),
            npcFree: async () => opts.free !== false,
            sealNpc: async (n) => ({ npc: n, name: n.name, level: 60, character: { name: n.name } }),
            sealPlayer: async () => ({ name: 'p' }),
            garrisonOf: async () => (opts.garrison === false ? null : { slug: 'moonanbu', character: { name: 'garrison' } }),
            runFight: (args) => { fights.push(args as never); return { winner: opts.winner, mercWon: opts.winner === 'merc', playerWon: opts.winner === 'player', rounds: 5, log: [] }; },
            roleOf: async (name) => (name === npc().id || roster.NPC_WAR_DEFENDERS.some((d) => d.id === name) ? ROLE_ANBU : ROLE_VILLAGER),
            standsIn: () => opts.away !== true,
            openDuel: async (n, target, sector) => {
                duels.push({ npc: n.id, target, sector });
                return opts.refuse ? { ok: false, step: 'attack', reason: 'Target is recovering from a recent defeat.' } : { ok: true, battleId: `duel-${duels.length}`, registered: true };
            },
            commit: (async ({ decide }: { decide: (s: typeof live) => Promise<any> }) => {
                const d = await decide(live);
                decisions.push(d);
                if (d.kind !== 'score') return { status: 'skipped', reason: d.reason };
                live = d.outcome.session;
                return { status: 'applied', receipt: { points: d.outcome.awarded }, session: live };
            }) as never,
        };
        return { deps, fights, duels, decisions, live: () => live };
    }

    it('an attacking Cinderhold ATTACKS a defender in the sector for real: a duel, no instant result', async () => {
        const contest = sw.newSectorWarSession({ sector: 18, attackerVillage: CH, defenderVillage: MOON, winCondition: 'combat', now: Date.now() - 3_600_000 });
        const h = harness(contest, { targets: ['moondef'], winner: 'merc' });
        const [strike] = await party.runNpcWarParty(h.deps);
        assert.equal(strike?.kind, 'player');
        assert.equal(strike?.winner, 'duel');
        assert.equal(strike?.battleId, 'duel-1');
        assert.deepEqual(h.duels, [{ npc: strike!.npc, target: 'moondef', sector: 18 }]);
        assert.equal(h.fights.length, 0, 'nothing is settled out of sight');
        assert.equal(h.decisions.length, 0, 'the duel scores the war when it is fought, not now');
        assert.equal(h.live().attackerPoints + h.live().defenderPoints, 0);
        const { mercTargetsOnCooldown } = await import('./_merc-roam.js');
        assert.ok((await mercTargetsOnCooldown(['moondef'], h.deps.now!)).has('moondef'), 'the target is not struck again for a while');
    });

    it('a defending Cinderhold attacks the attackers; only a shinobi in the sector strikes; a refused attack is no strike', async () => {
        const contest = sw.newSectorWarSession({ sector: 70, attackerVillage: MOON, defenderVillage: CH, winCondition: 'combat', now: Date.now() - 3_600_000 });
        const h = harness(contest, { targets: ['moonatk'], winner: 'merc' });
        const [strike] = await party.runNpcWarParty(h.deps);
        assert.equal(strike?.battleId, 'duel-1');
        assert.equal(h.duels[0]!.sector, 70);

        const away = harness(contest, { targets: ['moonatk2'], winner: 'merc', away: true });
        assert.deepEqual(await party.runNpcWarParty(away.deps), [], 'nobody standing there, nobody attacks');
        assert.equal(away.duels.length, 0);

        const refused = harness(contest, { targets: ['moonatk3'], winner: 'merc', refuse: true });
        assert.deepEqual(await party.runNpcWarParty(refused.deps), [], 'refused like a player\'s attack would be');
        const { mercTargetsOnCooldown } = await import('./_merc-roam.js');
        assert.ok(!(await mercTargetsOnCooldown(['moonatk3'], refused.deps.now!)).has('moonatk3'), 'a refused attack costs the target nothing');

        const busy = harness(contest, { targets: ['moonatk4'], winner: 'merc', free: false });
        assert.deepEqual(await party.runNpcWarParty(busy.deps), []);
    });

    it('with no defender in the sector, it storms the garrison only after the idle window, at garrison weight', async () => {
        const fresh = sw.newSectorWarSession({ sector: 18, attackerVillage: CH, defenderVillage: MOON, winCondition: 'combat', now: Date.now() - 60_000 });
        assert.deepEqual(await party.runNpcWarParty(harness(fresh, { winner: 'merc' }).deps), [], 'the defence still has time to turn up');

        const idle = sw.newSectorWarSession({ sector: 18, attackerVillage: CH, defenderVillage: MOON, winCondition: 'combat', now: Date.now() - sw.GARRISON_UNLOCK_IDLE_MS - 60_000 });
        const h = harness(idle, { winner: 'merc' });
        const [strike] = await party.runNpcWarParty({ ...h.deps, now: Date.now() });
        assert.equal(strike?.kind, 'garrison');
        assert.ok((h.fights[0]!.mercSealed as { name: string }).name, 'the NPC fights the garrison with its own sealed kit');
        assert.ok(h.live().attackerPoints > 0 && h.live().attackerPoints < 15, 'garrison weight, not full');
        assert.equal(h.decisions[0]!.purseEligible, false, 'a garrison assault never feeds the purse');

        const held = harness(idle, { winner: 'player' });
        await party.runNpcWarParty({ ...held.deps, now: Date.now() });
        assert.equal(held.live().attackerPoints, 0, 'a garrison that holds gives the attacker nothing');
        const stall = harness(idle, { winner: 'stall' });
        const [s] = await party.runNpcWarParty({ ...stall.deps, now: Date.now() });
        assert.equal(s?.awarded, 0);

        const defending = sw.newSectorWarSession({ sector: 70, attackerVillage: MOON, defenderVillage: CH, winCondition: 'combat', now: Date.now() - sw.GARRISON_UNLOCK_IDLE_MS - 60_000 });
        assert.deepEqual(await party.runNpcWarParty({ ...harness(defending, { winner: 'merc' }).deps, now: Date.now() }), [], 'a defending Cinderhold has no garrison to storm');
    });

    it('scores one garrison fight per war per tick, whichever scheduler runs it', async () => {
        // Idle well past the window even at the start of this tick.
        const contest = sw.newSectorWarSession({ sector: 18, attackerVillage: CH, defenderVillage: MOON, winCondition: 'combat', now: Date.now() - sw.GARRISON_UNLOCK_IDLE_MS - party.NPC_WAR_PARTY_TICK_MS - 60_000 });
        const h = harness(contest, { winner: 'merc' });
        const ids: string[] = [];
        const commit = h.deps.commit!;
        h.deps.commit = (async (args: { battleId: string }) => { ids.push(args.battleId); return (commit as never as (a: unknown) => unknown)(args); }) as never;
        const at = Math.floor(Date.now() / party.NPC_WAR_PARTY_TICK_MS) * party.NPC_WAR_PARTY_TICK_MS + 1_000;
        await party.runNpcWarParty({ ...h.deps, now: at });
        await party.runNpcWarParty({ ...h.deps, now: at + 5_000 });
        assert.equal(ids.length, 2);
        assert.equal(ids[0], ids[1], 'the same tick names the same receipt, so commitSectorWarBattle dedupes it');
    });

    it('ignores wars it is not in, non-Combat wars, and stops on the kill switch', async () => {
        const other = sw.newSectorWarSession({ sector: 18, attackerVillage: 'Stormveil Village', defenderVillage: MOON, winCondition: 'combat', now: Date.now() - 3_600_000 });
        assert.deepEqual(await party.runNpcWarParty(harness(other, { targets: ['x'], winner: 'merc' }).deps), []);
        const pet = sw.newSectorWarSession({ sector: 18, attackerVillage: CH, defenderVillage: MOON, winCondition: 'pet', now: Date.now() - 3_600_000 });
        assert.deepEqual(await party.runNpcWarParty(harness(pet, { targets: ['x'], winner: 'merc' }).deps), []);
        process.env.DISABLE_NPC_VILLAGE = '1';
        try {
            const c = sw.newSectorWarSession({ sector: 18, attackerVillage: CH, defenderVillage: MOON, winCondition: 'combat', now: Date.now() - 3_600_000 });
            assert.deepEqual(await party.runNpcWarParty(harness(c, { targets: ['x'], winner: 'merc' }).deps), []);
        } finally { delete process.env.DISABLE_NPC_VILLAGE; }
    });
});

describe('the kill switch freezes a Cinderhold war', { concurrency: false }, () => {
    it('no garrison assault and no settlement while DISABLE_NPC_VILLAGE is on; it settles once Cinderhold is back', async () => {
        await seedWorld();
        const { settleDueSectorWars } = await import('./_sector-war-settle.js');
        const started = Date.now() - 80 * 3_600_000;
        const contest = { ...sw.newSectorWarSession({ sector: 70, attackerVillage: MOON, defenderVillage: CH, winCondition: 'combat', now: started }), attackerPoints: 30 };
        await kv.set(sw.sectorWarKey(contest.id), contest);
        process.env.DISABLE_NPC_VILLAGE = '1';
        try {
            assert.deepEqual(await settleDueSectorWars(), [], 'held, not handed to the attacker');
            assert.equal((await kv.get<Record<string, unknown>>('world:territory:70'))?.ownerVillage, CH);
            const { npcVillageWarFrozen } = await import('./_npc-war-roster.js');
            assert.equal(npcVillageWarFrozen(contest), true);
            assert.equal(npcVillageWarFrozen({ attackerVillage: MOON, defenderVillage: 'Stormveil Village' }), false);
        } finally { delete process.env.DISABLE_NPC_VILLAGE; }
        const settled = await settleDueSectorWars();
        assert.equal(settled.length, 1);
        assert.equal(settled[0]!.attackerWon, true);
        assert.equal((await kv.get<Record<string, unknown>>('world:territory:70'))?.ownerVillage, MOON, 'the land changes hands both ways');
    });
});

describe('which NPC duels score a sector war', () => {
    it('every NPC duel scores the war; only a paid one pays (an admin-controlled one never does)', async () => {
        const { pvpSessionMayScoreWar, pvpSessionMayReward } = await import('./pvp/session.js');
        const npcName = roster.NPC_WAR_DEFENDERS[0]!.name;
        const base = { rewardAuthority: 'world', joined: { p1: true, p2: true }, progressionAuthorityVersion: 1, p1: { name: 'player' }, p2: { name: npcName } } as never as Parameters<typeof pvpSessionMayScoreWar>[0];
        const stamp = (extra: Record<string, unknown>) => ({ ...base, npcDuel: { version: 1, npc: 'x', seat: 'p2', ...extra } }) as never as Parameters<typeof pvpSessionMayScoreWar>[0];
        assert.equal(pvpSessionMayScoreWar(stamp({ paid: true })), true);
        assert.equal(pvpSessionMayReward(stamp({ paid: true }) as never), true);
        assert.equal(pvpSessionMayScoreWar(stamp({ paid: false, controlled: true })), true, 'owner ruling: an admin-controlled NPC gives war points');
        assert.equal(pvpSessionMayReward(stamp({ paid: false, controlled: true }) as never), false, '...and pays nobody');
        assert.equal(pvpSessionMayScoreWar(stamp({ paid: false })), true, 'past the daily paid duels, the fight still counts for the war');
        assert.equal(pvpSessionMayReward(stamp({ paid: false }) as never), false, '...but pays nothing');
        assert.equal(pvpSessionMayScoreWar({ ...stamp({ paid: false, controlled: true }), joined: { p1: true, p2: false } } as never), false);
    });
});

describe('the sector-war purse and Cinderhold', () => {
    it('a player\'s paid win over an NPC counts; an unpaid one and an NPC\'s own win never do', async () => {
        const { sectorWarPurseEligible } = await import('./_sector-war-purse-eligibility.js');
        const npc = roster.NPC_WAR_DEFENDERS[0]!;
        const old = Date.now() - 30 * 86_400_000;
        await kv.set(`save:${npc.id}`, { character: { name: npc.name, village: CH, level: 50, createdAt: old } });
        await kv.set('save:moonfighter', { character: { name: 'moonfighter', village: MOON, level: 50, createdAt: old } });
        const at = Date.now();
        assert.equal(await sectorWarPurseEligible({ winnerName: 'moonfighter', loserName: npc.id, endedAt: at, npcDuelPaid: true }), true);
        assert.equal(await sectorWarPurseEligible({ winnerName: 'moonfighter', loserName: npc.id, endedAt: at }), false);
        assert.equal(await sectorWarPurseEligible({ winnerName: npc.id, loserName: 'moonfighter', endedAt: at, npcDuelPaid: true }), false);
    });
});

describe('a guard beaten in war is wounded and leaves the field for three hours', { concurrency: false }, () => {
    it('a wounded guard has no post, a reserve takes the front, and it cannot be dueled', async () => {
        const { npcPosts, NPC_FRONT_SQUAD } = await import('./_npc-presence.js');
        const { NPC_VILLAGE_ROSTER } = await import('../shared/npc-village-roster.js');
        const wounds = await import('./_npc-wounds.js');
        const now = Date.now();
        const healthy = npcPosts(now, NPC_VILLAGE_ROSTER, [18]);
        const firstSquad = [...healthy.entries()].filter(([, p]) => p.sector === 18).map(([id]) => id);
        const beaten = new Set(firstSquad.slice(0, 2));
        const after = npcPosts(now, NPC_VILLAGE_ROSTER, [18], beaten);
        const squad = [...after.entries()].filter(([, p]) => p.sector === 18).map(([id]) => id);
        assert.equal(squad.length, NPC_FRONT_SQUAD, 'reserves fill the front');
        assert.ok(squad.every((id) => !beaten.has(id)));
        assert.ok([...beaten].every((id) => !after.has(id)), 'the wounded are off the map');
        const all = new Set(roster.NPC_WAR_DEFENDERS.map((n) => n.id));
        assert.equal([...npcPosts(now, NPC_VILLAGE_ROSTER, [18], all).values()].filter((p) => p.sector === 18).length, 0, 'beat all fifteen and the front stands empty');

        const npc = roster.NPC_WAR_DEFENDERS[0]!;
        await wounds.woundNpc(npc.id, now, 'moonfighter');
        assert.equal(await wounds.isNpcWounded(npc.id, now), true);
        assert.equal(await wounds.isNpcWounded(npc.id, now + wounds.NPC_WAR_WOUND_MS + 1), false, 'healed after three hours');
        assert.ok((await wounds.woundedNpcIds(now)).has(npc.id));
        const duel = await import('./_npc-duel.js');
        await assert.rejects(duel.sealNpcDuel({ battleId: 'wounded-duel', rewardAuthority: 'world', p1: { name: 'moonfighter' }, p2: { name: npc.name } }, { sessionsEnabled: true }), /npc-duel-busy/);
    });

    it('the presence tick takes a wounded guard off the map', async () => {
        const { refreshNpcPresence } = await import('./_npc-presence.js');
        const { onlineStore } = await import('./_realtime/online-store.js');
        const wounds = await import('./_npc-wounds.js');
        const npc = roster.NPC_WAR_DEFENDERS[1]!;
        await kv.set(`save:${npc.id}`, { character: { name: npc.name, village: CH, level: 40 } });
        onlineStore.upsert({ name: npc.name, sector: 70, character: { name: npc.name, village: CH }, tile: 5, tileSector: 70 } as never);
        assert.ok(onlineStore.get(npc.name));
        await wounds.woundNpc(npc.id);
        await refreshNpcPresence();
        assert.equal(onlineStore.get(npc.name) ?? null, null);
    });

    it('a strike on a player never wounds or scores out of sight: the duel does that when it is fought', async () => {
        const contest = sw.newSectorWarSession({ sector: 18, attackerVillage: CH, defenderVillage: MOON, winCondition: 'combat', now: Date.now() - 3_600_000 });
        const wounded: string[] = [];
        let committed = 0;
        const deps = {
            now: Date.now(), listContests: async () => [contest], onlineIn: () => ['moondef-w'],
            targetsOf: async (names: readonly string[], village: string) => names.map((name) => ({ name, village, hp: 50, maxHp: 100 })),
            npcFree: async () => true, sealNpc: async (n: never) => ({ npc: n, name: 'x', level: 60, character: {} }),
            standsIn: () => true, openDuel: async () => ({ ok: true, battleId: 'b', registered: true }),
            roleOf: async () => ({ win: 5, loss: 0 }), wound: async (id: string) => { wounded.push(id); },
            commit: (async () => { committed++; return { status: 'applied', receipt: { points: 1 }, session: contest }; }) as never,
        };
        await party.runNpcWarParty(deps as never);
        assert.deepEqual(wounded, []);
        assert.equal(committed, 0);
    });

    it('guards at a war front fight at the top AI tier', async () => {
        const seat = await import('./_npc-ai-seat.js');
        const { NPC_VILLAGE_ROSTER } = await import('../shared/npc-village-roster.js');
        const genin = NPC_VILLAGE_ROSTER.find((n) => n.rank === 'genin')!;
        assert.equal(seat.npcTurnPolicy(genin).tier, 'tactical');
        assert.equal(seat.npcTurnPolicy(genin, { atWar: true }).tier, 'apex');
    });
});

describe('presence sends a squad to each war front', () => {
    it('four war defenders stand in the contested sector; the rest have no post and keep travelling the world (owner 2026-11-11)', async () => {
        const { npcPosts, NPC_FRONT_SQUAD } = await import('./_npc-presence.js');
        const { NPC_VILLAGE_ROSTER } = await import('../shared/npc-village-roster.js');
        const posts = npcPosts(Date.now(), NPC_VILLAGE_ROSTER, [18]);
        const atFront = [...posts.entries()].filter(([, p]) => p.sector === 18).map(([id]) => id);
        assert.equal(atFront.length, NPC_FRONT_SQUAD);
        assert.ok(atFront.every((id) => roster.NPC_WAR_DEFENDERS.some((d) => d.id === id)));
        assert.ok([...posts.values()].every((p) => p.duty === 'front'), 'only the front squad has a war post');
        assert.equal(posts.size, NPC_FRONT_SQUAD, 'every other free NPC is out on a journey (api/_npc-journeys.ts)');
    });
});

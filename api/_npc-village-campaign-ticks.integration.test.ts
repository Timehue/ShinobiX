import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';

// Cinderhold's village-war tick, the gaps an audit found (2026-11-10), end to
// end through the real handlers on the in-memory store:
//   - Cinderhold accepting a standing offer of peace records its own offer, so
//     an early peace is an AGREEMENT ending (the early-end strip applies), by
//     the inline propose-peace path and by the tick's re-read; switched off
//     (DISABLE_NPC_VILLAGE=1), the offer simply stands;
//   - the tick reads the war rows once, as a projection, reads whole only the
//     live Cinderhold wars, answers peace only where an offer stands and writes
//     nothing when nothing changed;
//   - a strike's target search reads only projected save facts, once per
//     strike window;
//   - a card defense by a queued NPC lapses on the clock when the attacker
//     walks out, so the NPC is free to defend again, and its loss wounds it once.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-village-campaign-ticks-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.DISABLE_NPC_VILLAGE;

const CH = 'Cinderhold Village';
const MOON = 'Moonshadow Village';
const STORM = 'Stormveil Village';
const FROST = 'Frostfang Village';
const NOW = Date.UTC(2026, 10, 10, 13, 0, 0);

let kv: typeof import('./_storage.js').kv;
let online: typeof import('./_realtime/online-store.js').onlineStore;
let token: typeof import('./_auth.js').issuePlayerToken;
let world: typeof import('./world-state.js');
let campaign: typeof import('./_npc-village-campaign.js');
let roster: typeof import('./_npc-war-roster.js');
let early: typeof import('./war/_early-end.js');
let villageWarKey: typeof import('./_war-state.js').villageWarKey;

function unwrap(mod: { default: unknown }) {
    const inner = mod.default as { default?: unknown };
    return (inner?.default ?? inner) as (req: unknown, res: unknown) => Promise<unknown>;
}

let seq = 0;
async function call(handler: unknown, name: string | null, body: Record<string, unknown> | null, method = 'POST') {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, getHeader: () => undefined, status(n: number) { out.status = n; return res; }, json(value: Record<string, any>) { out.body = value; return res; }, end: () => res };
    const ip = `10.94.${Math.floor(++seq / 250)}.${seq % 250}`;
    await (handler as (req: unknown, res: unknown) => Promise<unknown>)({
        method, body: body ?? undefined, query: {},
        headers: { ...(name ? { 'x-player-token': token(name), 'x-player-name': name } : {}), 'x-forwarded-for': ip },
        socket: { remoteAddress: ip },
    }, res);
    return out;
}

function playerCharacter(name: string, village: string, level: number) {
    return { name, level, village, ryo: 0, unspentStats: 0, hp: 10000, maxHp: 10000, chakra: 1000, maxChakra: 1000,
        stamina: 1000, maxStamina: 1000, stats: {}, equipment: {}, inventory: [], itemStacks: [], equippedJutsuIds: [], jutsu: [], jutsuMastery: [] };
}

const warRow = async (id: string) => (await kv.get<Record<string, any>>(`world:war:${id}`))!;

/** A seated Kage declares a village war on Cinderhold; returns its id, the clock moved into the live campaign. */
async function declareOnCinderhold(village: string, kage: string): Promise<string> {
    const ws = unwrap(await import('./world-state.js'));
    await kv.set(`save:${kage}`, { _saveVersion: 1, character: playerCharacter(kage, village, 60) });
    await kv.set(`village:kage:${village.toLowerCase().replace(/ /g, '-')}`, { seatedKage: kage });
    await kv.set(villageWarKey(village), { warResources: 5_000 });
    const declared = await call(ws, kage, { kind: 'war', war: { villages: [village, CH] } });
    assert.equal(declared.status, 200, JSON.stringify(declared.body));
    const id = String(declared.body.war.id);
    mock.timers.tick((await warRow(id)).campaign.startsAt - Date.now() + 60 * 60_000);
    return id;
}

/** The war is going badly for Cinderhold, and a player has fought in it (so an MVP would be stamped). */
async function cinderholdFarBehind(id: string, village: string, fighter: string) {
    const war = await warRow(id);
    war.campaign.pvp[village] = 1_000;
    war.contributions = { ...(war.contributions ?? {}), [fighter]: { name: fighter, side: village, damage: 500 } };
    await kv.set(`world:war:${id}`, war);
}

/** The early-end strip: an agreement ending before the floor stamps no MVP and no crate. */
function assertEarlyAgreement(war: Record<string, any>, label: string) {
    assert.ok(war.endedAt, `${label}: the war ended`);
    assert.equal(war.winnerVillage, undefined, `${label}: no winner`);
    assert.ok(Number(war.peaceProposals?.[CH]) > 0, `${label}: Cinderhold's own offer is recorded`);
    assert.equal(early.villageWarEndedByAgreement(war as never), true, `${label}: an agreement ending`);
    assert.equal(early.villageWarEndedEarlyByAgreement(war as never, early.warMinDurationMs()), true, `${label}: early`);
    assert.deepEqual(war.mvpByVillage, {}, `${label}: no MVP is stamped`);
    assert.equal(war.warCrateId, undefined, `${label}: no crate`);
    assert.equal(war.loserCrateId, undefined, `${label}: no consolation crate`);
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore: online } = await import('./_realtime/online-store.js'));
    ({ issuePlayerToken: token } = await import('./_auth.js'));
    ({ villageWarKey } = await import('./_war-state.js'));
    (await import('./_npc-duel-driver.js')).setNpcActionBeatForTest(0);
    (await import('./_npc-presence.js')).setNpcTravelMsForTest(0);
    world = (await import('./world-state.js')) as unknown as typeof world;
    campaign = await import('./_npc-village-campaign.js');
    roster = await import('./_npc-war-roster.js');
    early = await import('./war/_early-end.js');
    await kv.set('npc-village:state', { baseLevel: 60, target: 60, sample: 30, computedAt: Date.now() });
    const seed = await import('./_npc-village-seed.js');
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
    await world.seedHomeSectorOwnership(Date.now());
});

describe('Cinderhold village-war tick', { concurrency: false }, () => {
    it('an early peace Cinderhold accepts is an agreement ending, inline and on the tick; switched off, the offer stands', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: NOW });
        t.after(() => mock.timers.reset());
        const ws = unwrap(await import('./world-state.js'));

        // 1. Inline: the offer meets a Cinderhold already far behind, and it accepts at once.
        const moonWar = await declareOnCinderhold(MOON, 'moonkage');
        await cinderholdFarBehind(moonWar, MOON, 'moonfighter');
        const offered = await call(ws, 'moonkage', { kind: 'war-command', command: 'propose-peace', villages: [MOON, CH] });
        assert.equal(offered.status, 200, JSON.stringify(offered.body));
        assertEarlyAgreement(await warRow(moonWar), 'inline');

        // 2. The tick: the offer stood while Cinderhold was level; switched off it still stands.
        const stormWar = await declareOnCinderhold(STORM, 'stormkage');
        const standing = await call(ws, 'stormkage', { kind: 'war-command', command: 'propose-peace', villages: [STORM, CH] });
        assert.equal(standing.status, 200, JSON.stringify(standing.body));
        assert.ok(!(await warRow(stormWar)).endedAt, 'not far behind: the offer stands');
        await cinderholdFarBehind(stormWar, STORM, 'stormfighter');
        process.env.DISABLE_NPC_VILLAGE = '1';
        try {
            const again = await call(ws, 'stormkage', { kind: 'war-command', command: 'propose-peace', villages: [STORM, CH] });
            assert.equal(again.status, 200, JSON.stringify(again.body));
            assert.deepEqual((await campaign.runNpcVillageCampaign({ now: Date.now() })).peace, []);
            assert.deepEqual(await world.reconsiderNpcVillagePeace(Date.now(), [stormWar]), []);
            const off = await warRow(stormWar);
            assert.ok(!off.endedAt, 'switched off, Cinderhold answers nothing');
            assert.equal(off.peaceProposals?.[CH], undefined);
            assert.ok(Number(off.peaceProposals?.[STORM]) > 0, 'the player offer stands');
        } finally { delete process.env.DISABLE_NPC_VILLAGE; }

        // Back on: the tick answers exactly the war whose offer stands, with one scan of the war rows.
        const asked: string[][] = [];
        const keys = mock.method(kv, 'keys');
        const tick = await campaign.runNpcVillageCampaign({ now: Date.now(), peace: async (at, ids) => { asked.push(ids); return world.reconsiderNpcVillagePeace(at, ids); } });
        const warScans = keys.mock.calls.filter((c) => String(c.arguments[0]).startsWith('world:war:')).length;
        keys.mock.restore();
        assert.deepEqual(asked, [[stormWar]], 'peace is asked only about the war with a standing offer');
        assert.deepEqual(tick.peace, [stormWar]);
        assert.equal(warScans, 1, 'one scan of the war rows per tick (the peace re-read scans nothing)');
        assertEarlyAgreement(await warRow(stormWar), 'tick');
    });

    it('with no live Cinderhold war the tick reads no war row whole, asks no peace and writes nothing', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: NOW + 2 * 86_400_000 });
        t.after(() => mock.timers.reset());
        const { projectKvValue } = await import('./_storage-projection.js');
        const { NPC_CAMPAIGN_ASSIGNMENTS_KEY } = await import('./_npc-campaign-assignments.js');
        const fullRead = kv.mget.bind(kv);
        // The in-memory store has no projected read; give it Postgres's, so a whole-row read is visible.
        kv.mgetProjected = async (keys, projection) => (await fullRead(...keys)).map((value) => projectKvValue(value, projection));
        try {
            await campaign.runNpcVillageCampaign({ now: Date.now() }); // clears the ended wars' orders
            const mget = mock.method(kv, 'mget');
            const set = mock.method(kv, 'set');
            let asked = 0;
            const tick = await campaign.runNpcVillageCampaign({ now: Date.now(), peace: async () => { asked++; return []; } });
            const wholeWarReads = mget.mock.calls.flatMap((c) => c.arguments as unknown[]).filter((key) => String(key).startsWith('world:war:'));
            const stateWrites = set.mock.calls.filter((c) => c.arguments[0] === NPC_CAMPAIGN_ASSIGNMENTS_KEY).length;
            mget.mock.restore(); set.mock.restore();
            assert.equal(asked, 0, 'no live war, no peace pass');
            assert.deepEqual(tick.peace, []);
            assert.deepEqual(wholeWarReads, [], 'ended war rows are never read whole');
            assert.equal(stateWrites, 0, 'nothing changed, nothing written');
        } finally { delete kv.mgetProjected; }
    });

    it('a strike looks for a target once per strike window, reading only projected save facts', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: NOW + 4 * 86_400_000 });
        t.after(() => mock.timers.reset());
        const { projectKvValue } = await import('./_storage-projection.js');
        const { NPC_WAR_PARTY_TICK_MS } = await import('./_npc-war-party.js');
        const frostWar = await declareOnCinderhold(FROST, 'frostkage');
        // An enemy player is online in the wild, but too low for any war action: nobody is eligible.
        const low = 'frostlow';
        const character = playerCharacter(low, FROST, 10);
        await kv.set(`save:${low}`, { _saveVersion: 1, currentSector: 40, character });
        online.upsert({ name: low, sector: 40, character, tile: 62, tileSector: 40 } as never);
        const fullRead = kv.mget.bind(kv);
        const projected: string[] = [];
        kv.mgetProjected = async (keys, projection) => { projected.push(...keys); return (await fullRead(...keys)).map((value) => projectKvValue(value, projection)); };
        const deps = { peace: async () => [], fighterFree: async () => true, campaign: async () => ({ status: 200, body: {} }),
            openDuel: async () => ({ ok: true as const, battleId: 'stub', registered: false }) };
        try {
            const first = Math.floor(Date.now() / NPC_WAR_PARTY_TICK_MS) * NPC_WAR_PARTY_TICK_MS + NPC_WAR_PARTY_TICK_MS + 60_000;
            const mget = mock.method(kv, 'mget');
            const one = await campaign.runNpcVillageCampaign({ ...deps, now: first });
            const two = await campaign.runNpcVillageCampaign({ ...deps, now: first + 60_000 });
            const wholeSaveReads = mget.mock.calls.flatMap((c) => c.arguments as unknown[]).filter((key) => key === `save:${low}`).length;
            // Who may fight is decided from two projected facts; no raid is weighed
            // here (Cinderhold holds no intel yet), so no NPC save is read whole.
            const { NPC_VILLAGE_ROSTER } = await import('../shared/npc-village-roster.js');
            const npcSaves = new Set(NPC_VILLAGE_ROSTER.map((npc) => `save:${npc.id}`));
            const wholeNpcReads = mget.mock.calls.flatMap((c) => c.arguments as unknown[]).filter((key) => npcSaves.has(String(key))).length;
            mget.mock.restore();
            assert.equal(wholeNpcReads, 0, 'no Cinderhold save is read whole for eligibility');
            assert.ok(projected.some((key) => npcSaves.has(key)), 'eligibility comes from the projected facts');
            assert.deepEqual([...one.strikes, ...two.strikes], [], 'nobody eligible: no strike');
            assert.equal(wholeSaveReads, 0, 'the player\'s whole save is never read for a strike');
            assert.equal(projected.filter((key) => key === `save:${low}`).length, 1, 'one look per strike window, not one per minute');
            const three = await campaign.runNpcVillageCampaign({ ...deps, now: first + NPC_WAR_PARTY_TICK_MS });
            assert.deepEqual(three.strikes, []);
            assert.equal(projected.filter((key) => key === `save:${low}`).length, 2, 'the next window looks again');
        } finally { delete kv.mgetProjected; online.remove(low); }
        assert.ok(frostWar);
    });

    it('a card defense a queued NPC holds lapses when the attacker walks out, and its loss wounds it once', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: NOW + 4 * 86_400_000 + 3 * 60 * 60_000 });
        t.after(() => mock.timers.reset());
        const warCampaign = unwrap(await import('./village/war-campaign.js'));
        const keys = await kv.keys('world:war:*');
        const frostWar = keys.map((k) => k.slice('world:war:'.length)).find((id) => id.includes('frost'))!;
        let war = await warRow(frostWar);
        assert.ok(!war.endedAt);
        war.campaign.intel[FROST] = 72;
        await kv.set(`world:war:${frostWar}`, war);
        const hold = war.campaign.strongholds.find((o: { village: string; mode: string }) => o.village === CH && o.mode === 'card');
        const now = Date.now();
        // A Cinderhold shinobi free to fight now and through the attacker's absence.
        const { npcCampaignFighterFree } = campaign;
        let defender: (typeof roster.NPC_WAR_DEFENDERS)[number] | undefined;
        for (const npc of roster.NPC_WAR_DEFENDERS) {
            if (await npcCampaignFighterFree(npc.id, { allowPossessed: true, now }) && await npcCampaignFighterFree(npc.id, { allowPossessed: true, now: now + 20 * 60_000 })) { defender = npc; break; }
        }
        assert.ok(defender, 'an on-duty Cinderhold shinobi');
        const npcSave = (await kv.get<Record<string, any>>(`save:${defender!.id}`))!;
        online.upsert({ name: defender!.name, sector: 67, character: npcSave.character, tile: 60, tileSector: 67 } as never);
        const queueDefense = async () => kv.set(`village-campaign-defense:${frostWar}:g${war.declarationGeneration}:${defender!.id}`,
            { player: defender!.id, village: CH, objectiveId: hold.id, seenAt: Date.now() });
        await queueDefense();

        const attack = async (name: string) => {
            const character = playerCharacter(name, FROST, 60);
            await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: hold.sector, character });
            online.upsert({ name, sector: hold.sector, character, tile: 62, tileSector: hold.sector } as never);
            assert.equal((await call(warCampaign, name, { warId: frostWar, action: 'enter', objectiveId: hold.id })).status, 200);
            const started = await call(warCampaign, name, { warId: frostWar, action: 'start', objectiveId: hold.id });
            assert.equal(started.status, 200, JSON.stringify(started.body));
            return started.body;
        };
        try {
            const first = await attack('frostcarda');
            assert.equal(first.npc, false, 'the queued NPC defends, as a queued player would');
            assert.equal(await kv.get(`village-campaign-assigned:${defender!.id}`), first.runId);
            // The attacker closes the tab and never comes back.
            online.remove('frostcarda');
            mock.timers.tick(10 * 60_000);
            await queueDefense();
            const second = await attack('frostcardb');
            assert.equal(second.npc, false, `the NPC defends again once the walked-out duel lapsed: ${JSON.stringify(second).slice(0, 200)}`);
            const secondRun = (await kv.get<Record<string, any>>(`village-campaign-run:${second.runId}`))!;
            assert.equal(secondRun.defender, defender!.id);
            const firstRun = (await kv.get<Record<string, any>>(`village-campaign-run:${first.runId}`))!;
            assert.equal(firstRun.status, 'done', 'the abandoned duel ended on its clock');
            war = await warRow(frostWar);
            assert.equal(war.campaign.receipts[`run:${first.runId}`]?.village, CH, 'the walked-out attacker forfeits: Cinderhold\'s defense scores');

            // The second attacker wins: the NPC is wounded once, and a re-poll never rewrites a later wound.
            const key = `village-campaign-run:${second.runId}`;
            const run = (await kv.get<Record<string, any>>(key))!;
            run.aiCard.state.status = 'complete'; run.aiCard.state.winner = 'p1';
            await kv.set(key, run);
            assert.equal((await call(warCampaign, 'frostcardb', { warId: frostWar, action: 'state', runId: second.runId })).status, 200);
            const { npcWoundKey } = await import('./_npc-wounds.js');
            const wound = (await kv.get<Record<string, any>>(npcWoundKey(defender!.id)))!;
            assert.equal(wound?.by, 'frostcardb', 'the beaten defender is wounded');
            const later = { until: wound.until + 60 * 60_000, at: wound.at + 60 * 60_000, by: 'someoneelse' };
            await kv.set(npcWoundKey(defender!.id), later);
            assert.equal((await call(warCampaign, 'frostcardb', { warId: frostWar, action: 'state', runId: second.runId })).status, 200);
            assert.deepEqual(await kv.get(npcWoundKey(defender!.id)), later, 'polling a finished duel wounds nobody again');
        } finally {
            online.remove(defender!.name); online.remove('frostcardb');
        }
    });
});

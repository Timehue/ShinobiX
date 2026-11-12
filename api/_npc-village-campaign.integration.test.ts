import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import type { PvpSession } from './pvp/session.js';

// Push 4b, end to end through the real handlers on the in-memory store:
// a player Kage declares a five-day village war on Cinderhold, its campaign
// strongholds are Cinderhold's own land (68-74, never the gate), a queued
// Cinderhold shinobi defends a stronghold in a real PvP duel the server plays
// and its win scores Cinderhold, NPCs hold the shrine, Cinderhold accepts a
// standing offer of peace once it trails far behind, and a war with Cinderhold
// settles with no treasury moved either way. Cinderhold stays out of the
// player war villages throughout.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-village-campaign-integration-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.DISABLE_NPC_VILLAGE;

const CH = 'Cinderhold Village';
const MOON = 'Moonshadow Village';
const STORM = 'Stormveil Village';
const NOW = Date.UTC(2026, 10, 10, 13, 0, 0);

let kv: typeof import('./_storage.js').kv;
let online: typeof import('./_realtime/online-store.js').onlineStore;
let token: typeof import('./_auth.js').issuePlayerToken;
let driver: typeof import('./_npc-duel-driver.js');
let world: typeof import('./world-state.js');
let campaign: typeof import('./_npc-village-campaign.js');
let roster: typeof import('./_npc-war-roster.js');
let villageWarKey: typeof import('./_war-state.js').villageWarKey;
let fullRoster: typeof import('../shared/npc-village-roster.js').NPC_VILLAGE_ROSTER;
/** All thirty shinobi: at base 60 every rank is level 15+, so every one fights. */
const everyone = () => fullRoster;

function unwrap(mod: { default: unknown }) {
    const inner = mod.default as { default?: unknown };
    return (inner?.default ?? inner) as (req: unknown, res: unknown) => Promise<unknown>;
}

let seq = 0;
async function call(handler: unknown, name: string | null, body: Record<string, unknown> | null, method = 'POST') {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, getHeader: () => undefined, status(n: number) { out.status = n; return res; }, json(value: Record<string, any>) { out.body = value; return res; }, end: () => res };
    const ip = `10.92.${Math.floor(++seq / 250)}.${seq % 250}`;
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

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore: online } = await import('./_realtime/online-store.js'));
    ({ issuePlayerToken: token } = await import('./_auth.js'));
    ({ villageWarKey } = await import('./_war-state.js'));
    driver = await import('./_npc-duel-driver.js');
    driver.setNpcActionBeatForTest(0);
    (await import('./_npc-presence.js')).setNpcTravelMsForTest(0);
    world = (await import('./world-state.js')) as unknown as typeof world;
    campaign = await import('./_npc-village-campaign.js');
    roster = await import('./_npc-war-roster.js');
    ({ NPC_VILLAGE_ROSTER: fullRoster } = await import('../shared/npc-village-roster.js'));
    await kv.set('npc-village:state', { baseLevel: 60, target: 60, sample: 30, computedAt: Date.now() });
    const seed = await import('./_npc-village-seed.js');
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
    await world.seedHomeSectorOwnership(Date.now());
});

describe('Cinderhold in a five-day village war', { concurrency: false }, () => {
    it('stays outside the player war villages', async () => {
        const maps = await import('./_war-map-sectors.js');
        assert.ok(!(maps.WAR_VILLAGES as readonly string[]).includes(CH));
        assert.equal(maps.isWarVillage(CH), false);
        const { seatedKageOf } = await import('./_sector-war-garrison-defender.js');
        assert.equal(await seatedKageOf(CH), '');
    });

    it('a player Kage declares, an NPC defends a stronghold and holds the shrine, and Cinderhold takes peace only when far behind', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: NOW });
        t.after(() => mock.timers.reset());
        const ws = unwrap(await import('./world-state.js'));
        const warCampaign = unwrap(await import('./village/war-campaign.js'));
        const move = unwrap(await import('./pvp/move.js'));

        await kv.set('save:moonkage', { _saveVersion: 1, character: playerCharacter('moonkage', MOON, 60) });
        await kv.set('village:kage:moonshadow-village', { seatedKage: 'moonkage' });
        await kv.set(villageWarKey(MOON), { warResources: 5_000 });

        // Refusals first: two Cinderholds, the NPC itself over HTTP, the switch.
        assert.equal((await call(ws, 'moonkage', { kind: 'war', war: { villages: [CH, CH] } })).status, 400);
        const commander = roster.NPC_WAR_DEFENDERS[0]!;
        const byHand = await call(ws, commander.id, { kind: 'war', war: { villages: [CH, MOON] } });
        assert.equal(byHand.status, 403, `an NPC token over HTTP has no declaration authority: ${JSON.stringify(byHand.body)}`);
        process.env.DISABLE_NPC_VILLAGE = '1';
        assert.equal((await call(ws, 'moonkage', { kind: 'war', war: { villages: [MOON, CH] } })).status, 409);
        delete process.env.DISABLE_NPC_VILLAGE;

        // 1. The Kage declares; Cinderhold's strongholds are its own land, never the gate.
        const declared = await call(ws, 'moonkage', { kind: 'war', war: { villages: [MOON, CH] } });
        assert.equal(declared.status, 200, JSON.stringify(declared.body));
        const warId = String(declared.body.war.id);
        let war = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        const chHolds = war.campaign.strongholds.filter((o: { village: string }) => o.village === CH);
        assert.equal(chHolds.length, 3);
        for (const o of chHolds) assert.ok(o.sector >= 68 && o.sector <= 74, `stronghold ${o.sector} is Cinderhold land, not its gate`);

        // A sector war on Cinderhold now waits for the village war.
        const sectorWar = unwrap(await import('./village/sector-war.js'));
        await kv.set('save:moonkage', { _saveVersion: 1, character: playerCharacter('moonkage', MOON, 60) });
        const siege = await call(sectorWar, 'moonkage', { action: 'declare', village: MOON, sector: 70, playerName: 'moonkage' });
        assert.notEqual(siege.status, 200, 'no sector war on Cinderhold during its village war');

        // 2. The campaign opens. Cinderhold's shinobi are online at their gate
        // (its Genin and Chunin too: at this base they are level 15+ and fight).
        mock.timers.tick(war.campaign.startsAt - NOW + 60_000);
        let now = Date.now();
        for (const npc of everyone()) {
            const save = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
            online.upsert({ name: npc.name, sector: 67, character: save.character, tile: 60, tileSector: 67 } as never);
        }
        const first = await campaign.runNpcVillageCampaign({ now, peace: async () => [] });
        const combatHold = chHolds.find((o: { mode: string }) => o.mode === 'combat');
        assert.ok(first.defending.some((d) => d.objectiveId === combatHold.id && d.ok), `an NPC queues to defend the combat stronghold: ${JSON.stringify(first.defending)}`);

        // 3. A Moonshadow shinobi attacks it and meets a queued NPC in a real duel.
        const human = 'moonraider';
        const level = Number((await kv.get<Record<string, any>>(`save:${roster.NPC_WAR_DEFENDERS[0]!.id}`))!.character.level);
        const character = playerCharacter(human, MOON, level);
        await kv.set(`save:${human}`, { _saveVersion: 1, currentSector: combatHold.sector, character });
        online.upsert({ name: human, sector: combatHold.sector, character, tile: 62, tileSector: combatHold.sector } as never);
        war = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        war.campaign.intel[MOON] = 72;
        await kv.set(`world:war:${warId}`, war);
        assert.equal((await call(warCampaign, human, { warId, action: 'enter', objectiveId: combatHold.id })).status, 200);
        const started = await call(warCampaign, human, { warId, action: 'start', objectiveId: combatHold.id });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        assert.equal(started.body.npc, false, 'a queued NPC defends like a queued player, not the AI copy');
        const battleId = String(started.body.battleId);
        const session = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        assert.equal(session.npcDuel?.seat, 'p2');
        assert.equal(session.npcDuel?.paid, false, 'a campaign fight pays nobody');
        assert.equal(session.villageWarObjective?.objectiveId, combatHold.id);
        const defender = String(session.p2.name);

        for (let guard = 0; guard < 400; guard++) {
            const live = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
            if (live.status === 'done') break;
            if (live.activePlayer === 'p1') await call(move, human, { battleId, role: 'p1', action: 'wait', moveToken: `w${guard}` });
            else await driver.driveNpcDuel(battleId, 'p2');
            mock.timers.tick(1_000);
        }
        const done = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        assert.equal(done.status, 'done');
        assert.equal(done.winner, 'p2', `the NPC defender won (${defender})`);
        for (let i = 0; i < 5 && (await driver.driveNpcDuel(battleId, 'p2')) !== 'finished'; i++) mock.timers.tick(1_000);
        war = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        assert.equal(war.campaign.pvp[CH], 50, 'a stronghold defense Cinderhold wins scores like a player\'s');
        assert.equal(war.campaign.strongholds.find((o: { id: string }) => o.id === combatHold.id).bouts, 1);
        assert.ok(!(war.contributions?.[human]?.damage > 0), 'the loser scores nothing');
        online.remove(human);

        // 4. The shrine window opens: Cinderhold's shinobi go and hold it.
        mock.timers.tick(war.campaign.shrine[0].opensAt - Date.now() + 60_000);
        now = Date.now();
        const shrineTick = await campaign.runNpcVillageCampaign({ now, peace: async () => [] });
        const entered = shrineTick.shrine.filter((s) => s.action === 'shrine-enter' && s.ok);
        assert.ok(entered.length >= 1, `NPCs entered the shrine: ${JSON.stringify(shrineTick.shrine)}`);
        const { shrineRoomLocation } = await import('./_village-war-shrine-presence.js');
        war = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        const holder = everyone().find((n) => n.id === entered[0]!.npc)!;
        assert.ok(shrineRoomLocation(holder.name, war as never, war.campaign.shrine[0].sector), 'the NPC holds a shrine lease');
        const kept = await campaign.keepNpcShrineHolders({ now: Date.now() });
        assert.ok(kept.some((s) => s.npc === holder.id && s.action === 'shrine-state' && s.ok), JSON.stringify(kept));

        // 5. Peace: Moonshadow offers while Cinderhold leads; the offer stands.
        const offer = await call(ws, 'moonkage', { kind: 'war-command', command: 'propose-peace', villages: [MOON, CH] });
        assert.equal(offer.status, 200, JSON.stringify(offer.body));
        assert.ok(!(await kv.get<Record<string, any>>(`world:war:${warId}`))!.endedAt, 'Cinderhold does not take peace while it is not far behind');
        // Moonshadow pulls far ahead; the next tick Cinderhold accepts the standing offer.
        war = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        war.campaign.pvp[MOON] = 1_000;
        await kv.set(`world:war:${warId}`, war);
        const peaceTick = await campaign.runNpcVillageCampaign({ now: Date.now() });
        assert.deepEqual(peaceTick.peace, [warId]);
        war = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        assert.ok(war.endedAt, 'the war ended in peace');
        assert.equal(war.winnerVillage, undefined);
        for (const npc of everyone()) online.remove(npc.name);
    });

    it('an admin approves a Cinderhold village war, and its settlement moves no treasury', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: NOW + 10 * 86_400_000 });
        t.after(() => mock.timers.reset());
        const war = await import('./_npc-village-war.js');
        const ws = unwrap(await import('./world-state.js'));
        const now = Date.now();
        await kv.set(war.NPC_WAR_PROPOSAL_KEY, { id: 'npc-war-test', village: STORM, sector: 5, aggression: 80, createdAt: now, expiresAt: now + 3_600_000 });
        const approved = await war.approveNpcWar('npc-war-test', { headers: {}, remoteAddress: '127.0.0.1' }, now, 'village');
        assert.equal(approved.ok, true, JSON.stringify(approved));
        const warId = (approved as { warId?: string }).warId!;
        let row = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        assert.equal(row.declaredBy, roster.NPC_WAR_DEFENDERS[0]!.id);
        assert.deepEqual([...row.villages].sort(), [CH, STORM].sort());
        assert.equal(await war.readNpcWarProposal(now), null, 'the proposal is spent');

        // Stormveil wins the campaign; settlement runs on the next poll.
        await kv.set('game:village-state:stormveilvillage', { treasury: { ryo: 10_000, honorSeals: 100, fateShards: 5 } });
        await kv.set('game:village-state:cinderholdvillage', { treasury: { ryo: 7_000, honorSeals: 70, fateShards: 7 } });
        row.campaign.pvp[STORM] = 500;
        await kv.set(`world:war:${warId}`, row);
        mock.timers.tick(row.campaign.endsAt - now + 60_000);
        (await import('./_proc-cache.js')).__clearProcCache();
        assert.equal((await call(ws, null, null, 'GET')).status, 200);
        let marker: Record<string, any> | null = null;
        for (let i = 0; i < 50 && !marker; i++) {
            await new Promise((resolve) => setImmediate(resolve));
            const fresh = await kv.get<Record<string, any>>(`world:war:${warId}`);
            if (fresh?.endedAt && fresh.winnerVillage && !fresh.settled) {
                (await import('./_proc-cache.js')).__clearProcCache();
                await call(ws, null, null, 'GET');
            }
            const keys = await kv.keys('war:settled:*');
            marker = keys.length ? await kv.get<Record<string, any>>(keys[0]!) : null;
        }
        row = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        assert.equal(row.winnerVillage, STORM);
        assert.ok(marker, 'the war is marked settled');
        assert.deepEqual(marker!.spoils, { ryo: 0, honorSeals: 0, fateShards: 0 });
        assert.deepEqual((await kv.get<Record<string, any>>('game:village-state:stormveilvillage'))!.treasury, { ryo: 10_000, honorSeals: 100, fateShards: 5 });
        assert.deepEqual((await kv.get<Record<string, any>>('game:village-state:cinderholdvillage'))!.treasury, { ryo: 7_000, honorSeals: 70, fateShards: 7 });
        const standing = await kv.get<Record<string, any>>('village:war-standing:stormveilvillage');
        assert.ok(standing, 'the player village keeps its war-standing record');
        assert.equal(await kv.get('village:war-standing:cinderholdvillage'), null, 'Cinderhold keeps no standing or morale');
    });

    it('strikes travel first and attack on a later tick; field orders charge the allowance and fail when the NPC is beaten', async (t) => {
        const FROST = 'Frostfang Village';
        mock.timers.enable({ apis: ['Date'], now: NOW + 20 * 86_400_000 });
        t.after(() => mock.timers.reset());
        const ws = unwrap(await import('./world-state.js'));
        await kv.set('save:frostkage', { _saveVersion: 1, character: playerCharacter('frostkage', FROST, 60) });
        await kv.set('village:kage:frostfang-village', { seatedKage: 'frostkage' });
        await kv.set(villageWarKey(FROST), { warResources: 5_000 });
        const declared = await call(ws, 'frostkage', { kind: 'war', war: { villages: [FROST, CH] } });
        assert.equal(declared.status, 200, JSON.stringify(declared.body));
        const warId = String(declared.body.war.id);
        let war = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        mock.timers.tick(war.campaign.startsAt - Date.now() + 60_000);

        for (const npc of everyone()) {
            const save = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
            online.upsert({ name: npc.name, sector: 67, character: save.character, tile: 60, tileSector: 67 } as never);
        }
        const target = 'frostscout';
        const character = playerCharacter(target, FROST, 60);
        await kv.set(`save:${target}`, { _saveVersion: 1, currentSector: 40, character });
        online.upsert({ name: target, sector: 40, character, tile: 62, tileSector: 40 } as never);
        const duels: Array<{ npc: string; target: string; sector: number }> = [];
        const deps = {
            peace: async () => [],
            fighterFree: async () => true,
            openDuel: async (npc: { id: string }, who: string, sector: number) => { duels.push({ npc: npc.id, target: who, sector }); return { ok: true as const, battleId: 'stub-duel', registered: false }; },
        };

        // Tick 1: a strike order is sent to the target's sector, but no attack yet.
        const first = await campaign.runNpcVillageCampaign({ ...deps, now: Date.now() });
        const sent = first.strikes.find((s) => s.stage === 'sent');
        assert.ok(sent, JSON.stringify(first.strikes));
        assert.equal(sent!.target, target);
        assert.equal(sent!.sector, 40);
        assert.equal(duels.length, 0, 'it travels first');
        const striker = everyone().find((n) => n.id === sent!.npc)!;
        assert.equal(online.get(striker.name)?.sector, 40, 'the striker took the road to the target');
        // A field order started too, charged to that NPC's own allowance.
        const op = first.operations.find((o) => o.stage === 'started');
        assert.ok(op, JSON.stringify(first.operations));
        war = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        const usage = Object.values(war.campaign.usage as Record<string, { players: Record<string, { total: number }> }>)[0]!;
        assert.equal(usage.players[op!.npc]!.total, 1, 'the personal daily allowance is charged');

        // Tick 2, a minute later: both still there, so the strike lands.
        mock.timers.tick(60_000);
        const second = await campaign.runNpcVillageCampaign({ ...deps, now: Date.now() });
        assert.ok(second.strikes.some((s) => s.stage === 'attacked' && s.npc === striker.id), JSON.stringify(second.strikes));
        assert.deepEqual(duels, [{ npc: striker.id, target, sector: 40 }]);
        const { mercTargetsOnCooldown } = await import('./_merc-roam.js');
        assert.ok((await mercTargetsOnCooldown([target], Date.now())).has(target), 'the shared 15-minute target cooldown');

        // The field order's NPC is beaten before it is done: the order fails, nothing scores.
        const { woundNpc } = await import('./_npc-wounds.js');
        await woundNpc(op!.npc, Date.now(), target);
        const third = await campaign.runNpcVillageCampaign({ ...deps, now: Date.now() });
        assert.ok(third.operations.some((o) => o.npc === op!.npc && o.missionId === op!.missionId && o.stage === 'failed'), JSON.stringify(third.operations));
        war = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        assert.equal(war.campaign.admissions[op!.missionId].field.status, 'failed');
        assert.equal(war.campaign.receipts[`field:${op!.missionId}`], undefined);

        // The next order (another NPC, next window) completes once its time is up.
        mock.timers.tick(10 * 60_000);
        const fourth = await campaign.runNpcVillageCampaign({ ...deps, fighterFree: async (id: string) => id !== op!.npc, now: Date.now() });
        const next = fourth.operations.find((o) => o.stage === 'started');
        assert.ok(next, JSON.stringify(fourth.operations));
        mock.timers.tick(campaign.NPC_OPERATION_MAX_MS + 1_000);
        const fifth = await campaign.runNpcVillageCampaign({ ...deps, fighterFree: async (id: string) => id !== op!.npc, now: Date.now() });
        const doneOp = fifth.operations.find((o) => o.missionId === next!.missionId);
        assert.equal(doneOp?.stage, 'completed', JSON.stringify(fifth.operations));
        war = (await kv.get<Record<string, any>>(`world:war:${warId}`))!;
        assert.ok(war.campaign.receipts[`field:${next!.missionId}`]?.points > 0, 'scored as a PvE operation');
        assert.equal(war.campaign.receipts[`field:${next!.missionId}`]?.village, CH);

        // Owner ruling 2026-11-11: a Chunin at level 15+ takes a war job like
        // the ANBU; a Genin under 15 is never ordered, even when it is free.
        const high = everyone().find((n) => n.rank === 'chunin')!;
        const low = everyone().find((n) => n.rank === 'genin')!;
        for (const [npc, lvl] of [[high, 20], [low, 12]] as const) {
            const save = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
            await kv.set(`save:${npc.id}`, { ...save, character: { ...save.character, level: lvl } });
        }
        roster.resetNpcWarParticipantsCacheForTest();
        mock.timers.tick(10 * 60_000);
        const onlyThem = async (id: string) => id === high.id || id === low.id;
        const reserveTick = await campaign.runNpcVillageCampaign({ ...deps, fighterFree: onlyThem, now: Date.now() });
        const ordered = new Set([
            ...reserveTick.defending.map((r) => r.npc), ...reserveTick.shrine.map((r) => r.npc), ...reserveTick.strikes.map((r) => r.npc),
            ...reserveTick.operations.map((r) => r.npc), ...reserveTick.raids.map((r) => r.npc),
        ]);
        assert.ok(ordered.has(high.id), `the level-20 Chunin is ordered: ${JSON.stringify(reserveTick)}`);
        assert.ok(!ordered.has(low.id), 'the level-12 Genin is not');
        const orders = (await kv.get<{ assignments: Record<string, unknown> }>('npc-village:campaign-assignments'))!.assignments;
        assert.ok(orders[high.id]);
        assert.equal(orders[low.id], undefined);
        roster.resetNpcWarParticipantsCacheForTest();
        for (const npc of everyone()) online.remove(npc.name);
        online.remove(target);
    });

    it('the peace rule: at most half the enemy total and at least 100 behind', async () => {
        const { npcAcceptsPeace } = await import('../shared/village-war-campaign.js');
        const c = (pvpCh: number, pvpEnemy: number) => ({ pvp: { [CH]: pvpCh, [MOON]: pvpEnemy }, pve: {} } as never);
        assert.equal(npcAcceptsPeace(c(50, 99), CH, MOON), false, 'behind by under 100');
        assert.equal(npcAcceptsPeace(c(100, 199), CH, MOON), false, 'more than half');
        assert.equal(npcAcceptsPeace(c(100, 200), CH, MOON), true);
        assert.equal(npcAcceptsPeace(c(0, 100), CH, MOON), true);
        assert.equal(npcAcceptsPeace(c(0, 0), CH, MOON), false);
    });
});

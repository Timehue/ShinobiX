import assert from 'node:assert/strict';
import { before, describe, it, mock } from 'node:test';
import type { PvpSession } from './pvp/session.js';

// Owner ruling 2026-11-10, "they should raid player strongholds": Cinderhold
// attacks a PLAYER village's campaign strongholds in a five-day village war
// exactly as a player village does, end to end through the real handlers on
// the in-memory store:
//   - it raids only strongholds its own intel has discovered, open and under
//     the bout limit; the raider walks there, enters with the real `enter`
//     action and starts the assault with the real `start` action on a LATER tick;
//   - against the defending village's AI copy (nobody queued) the assault is
//     scored as PvE support under the raider's own daily allowance, with no
//     bout counted (as for a player), and a beaten raider is wounded;
//   - against a queued player defender it is a real PvP duel with the NPC in
//     seat p1, the defender gets the "you were attacked" notice, and the win
//     scores for Cinderhold and counts a bout;
//   - a card stronghold's queued defender plays a real PvP Chronicle duel the
//     raider's card seat plays (the defender here walks away and forfeits);
//   - DISABLE_NPC_VILLAGE=1 raids nothing; once the campaign is over nothing
//     raids and the idle tick reads no war row whole.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-village-raids-integration-secret';
process.env.DISABLE_COMBAT_RECEIPTS = '1';
delete process.env.DISABLE_VILLAGE_WAR;
delete process.env.DISABLE_NPC_VILLAGE;

const CH = 'Cinderhold Village';
const MOON = 'Moonshadow Village';
const NOW = Date.UTC(2026, 10, 11, 9, 0, 0);
const TICK = 60_000;

let kv: typeof import('./_storage.js').kv;
let online: typeof import('./_realtime/online-store.js').onlineStore;
let token: typeof import('./_auth.js').issuePlayerToken;
let campaign: typeof import('./_npc-village-campaign.js');
let roster: typeof import('./_npc-war-roster.js');
let villageWarKey: typeof import('./_war-state.js').villageWarKey;

function unwrap(mod: { default: unknown }) {
    const inner = mod.default as { default?: unknown };
    return (inner?.default ?? inner) as (req: unknown, res: unknown) => Promise<unknown>;
}

let seq = 0;
async function call(handler: unknown, name: string | null, body: Record<string, unknown> | null, method = 'POST') {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, getHeader: () => undefined, status(n: number) { out.status = n; return res; }, json(value: Record<string, any>) { out.body = value; return res; }, end: () => res };
    const ip = `10.96.${Math.floor(++seq / 250)}.${seq % 250}`;
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
const tick = () => campaign.runNpcVillageCampaign({ now: Date.now(), peace: async () => [] });

/** Only `keep` stays raidable: every other Moonshadow stronghold is fought out. */
async function onlyRaidable(warId: string, keep: string) {
    const war = await warRow(warId);
    for (const o of war.campaign.strongholds) if (o.village === MOON) o.bouts = o.id === keep ? 0 : o.limit;
    await kv.set(`world:war:${warId}`, war);
}

/** Into the next war-party window (one new raid order per window), a minute in. */
async function nextWindow() {
    const { NPC_WAR_PARTY_TICK_MS } = await import('./_npc-war-party.js');
    mock.timers.tick(NPC_WAR_PARTY_TICK_MS - (Date.now() % NPC_WAR_PARTY_TICK_MS) + TICK);
}

/** Ticks until a raid reaches `stage` (at most `max` ticks a minute apart); returns every raid row seen. */
async function tickUntil(stage: string, max = 6) {
    const seen: Array<Record<string, any>> = [];
    for (let i = 0; i < max; i++) {
        const report = await tick();
        seen.push(...report.raids);
        if (report.raids.some((r) => r.stage === stage)) return seen;
        mock.timers.tick(TICK);
    }
    return seen;
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore: online } = await import('./_realtime/online-store.js'));
    ({ issuePlayerToken: token } = await import('./_auth.js'));
    ({ villageWarKey } = await import('./_war-state.js'));
    (await import('./_npc-duel-driver.js')).setNpcActionBeatForTest(0);
    (await import('./_npc-campaign-card-seat.js')).setNpcCampaignCardPaceForTest(0);
    (await import('./_npc-presence.js')).setNpcTravelMsForTest(0);
    campaign = await import('./_npc-village-campaign.js');
    roster = await import('./_npc-war-roster.js');
    await kv.set('npc-village:state', { baseLevel: 60, target: 60, sample: 30, computedAt: Date.now() });
    const seed = await import('./_npc-village-seed.js');
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
    await (await import('./world-state.js')).seedHomeSectorOwnership(Date.now());
});

describe('Cinderhold raids player strongholds', { concurrency: false }, () => {
    let warId = '';

    it('discovers, walks, enters and raids the AI copy: PvE support under the raider\'s allowance, no bout; beaten, it is wounded', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: NOW });
        t.after(() => mock.timers.reset());
        const ws = unwrap(await import('./world-state.js'));
        // The Moonshadow Kage is the AI copy that defends an unwatched stronghold.
        await kv.set('save:moonraidkage', { _saveVersion: 1, character: playerCharacter('moonraidkage', MOON, 60) });
        await kv.set('village:kage:moonshadow-village', { seatedKage: 'moonraidkage' });
        await kv.set(villageWarKey(MOON), { warResources: 5_000 });
        const declared = await call(ws, 'moonraidkage', { kind: 'war', war: { villages: [MOON, CH] } });
        assert.equal(declared.status, 200, JSON.stringify(declared.body));
        warId = String(declared.body.war.id);
        let war = await warRow(warId);
        mock.timers.tick(war.campaign.startsAt - Date.now() + TICK);
        for (const npc of roster.NPC_WAR_DEFENDERS) {
            const save = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
            online.upsert({ name: npc.name, sector: 67, character: save.character, tile: 60, tileSector: 67 } as never);
        }

        // Undiscovered: Cinderhold has no intel, so it sees no Moonshadow stronghold to raid.
        const blind = await tick();
        assert.deepEqual(blind.raids, [], 'no intel, no raid');

        // Its espionage has revealed Moonshadow's strongholds; only the combat one is still open.
        war = await warRow(warId);
        war.campaign.intel[CH] = 72;
        await kv.set(`world:war:${warId}`, war);
        const combatHold = war.campaign.strongholds.find((o: { village: string; mode: string }) => o.village === MOON && o.mode === 'combat');
        await onlyRaidable(warId, combatHold.id);
        await nextWindow();

        const seen = await tickUntil('finished');
        const sent = seen.find((r) => r.stage === 'sent');
        assert.ok(sent, JSON.stringify(seen));
        assert.equal(sent!.objectiveId, combatHold.id);
        const raider = roster.NPC_WAR_DEFENDERS.find((n) => n.id === sent!.npc)!;
        const stages = seen.filter((r) => r.npc === raider.id).map((r) => r.stage);
        assert.deepEqual(stages, ['sent', 'entered', 'started', 'finished'], 'walk, enter, then start on a later tick');
        const started = seen.find((r) => r.stage === 'started')!;
        assert.equal(started.against, 'copy', 'nobody queued: the village\'s AI copy defends');
        assert.equal(online.get(raider.name)?.sector, combatHold.sector, 'the raider stands in the stronghold sector');

        const run = (await kv.get<Record<string, any>>(`village-campaign-run:${started.runId}`))!;
        assert.equal(run.attacker, raider.id);
        assert.equal(run.npc, true);
        assert.equal(run.defender, 'moonraidkage');
        assert.ok(run.merc, 'the assault was fought on the server');
        assert.equal(run.status, 'done');
        war = await warRow(warId);
        const receipt = war.campaign.receipts[`run:${started.runId}`];
        assert.ok(receipt, 'the run has its receipt');
        assert.equal(receipt.village, CH);
        assert.equal(war.campaign.admissions[started.runId].finished, true);
        assert.equal(war.campaign.admissions[started.runId].npc, true);
        const usage = war.campaign.usage[`${CH}:0`].players[raider.id];
        assert.equal(usage.categories.sabotage, 1, 'charged to the raider\'s own daily allowance');
        assert.equal(war.campaign.strongholds.find((o: { id: string }) => o.id === combatHold.id).bouts, 0, 'an AI-copy assault counts no bout, as for a player');
        if (run.merc.winner === 'p1') {
            assert.ok(receipt.points > 0 && war.campaign.pve[CH] >= receipt.points, 'a won assault scores as PvE support');
            assert.equal(war.contributions[raider.id].raids, 1);
        } else assert.equal(receipt.points, 0);
        assert.ok(!(war.campaign.pve[MOON] > 0), 'the copy holding scores nothing for anyone');

        // The next window's raider is beaten by the copy: no points, and it is wounded.
        const assault = await import('./_village-war-npc-assault.js');
        assault.setNpcGarrisonAssaultFightForTest(() => ({ mercWon: false, playerWon: true, rounds: 4 }));
        try {
            await nextWindow();
            const lost = await tickUntil('finished');
            const second = lost.find((r) => r.stage === 'started');
            assert.ok(second, JSON.stringify(lost));
            war = await warRow(warId);
            assert.equal(war.campaign.receipts[`run:${second!.runId}`].points, 0);
            const { readNpcWound } = await import('./_npc-wounds.js');
            const wound = await readNpcWound(second!.npc);
            assert.ok(wound && wound.until - Date.now() > 2.9 * 60 * 60_000, 'a beaten raider is wounded for the war front\'s 3 h');
        } finally { assault.setNpcGarrisonAssaultFightForTest(null); }

        // Every Moonshadow stronghold fought out to its bout limit: nothing left to raid.
        war = await warRow(warId);
        for (const o of war.campaign.strongholds) if (o.village === MOON) o.bouts = o.limit;
        await kv.set(`world:war:${warId}`, war);
        await nextWindow();
        const none = await tick();
        assert.deepEqual(none.raids, [], 'the bout limit stops raids');
    });

    it('meets a queued player defender in a real duel with the NPC in p1: the defender is told, the win scores and counts a bout', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: NOW + 2 * 60 * 60_000 });
        t.after(() => mock.timers.reset());
        const warCampaign = unwrap(await import('./village/war-campaign.js'));
        const move = unwrap(await import('./pvp/move.js'));
        let war = await warRow(warId);
        const combatHold = war.campaign.strongholds.find((o: { village: string; mode: string }) => o.village === MOON && o.mode === 'combat');
        await onlyRaidable(warId, combatHold.id);

        const human = 'moonholdguard';
        const level = Number((await kv.get<Record<string, any>>(`save:${roster.NPC_WAR_DEFENDERS[0]!.id}`))!.character.level);
        const character = playerCharacter(human, MOON, level);
        await kv.set(`save:${human}`, { _saveVersion: 1, currentSector: combatHold.sector, character });
        // Queued from Town Hall, in the village (out of reach of a Cinderhold strike in the wild).
        online.upsert({ name: human, sector: 0, character } as never);
        const queued = await call(warCampaign, human, { warId, action: 'defend', objectiveId: combatHold.id });
        assert.equal(queued.status, 200, JSON.stringify(queued.body));
        const pvpBefore = Number(war.campaign.pvp[CH] ?? 0);

        await nextWindow();
        const seen = await tickUntil('started');
        const started = seen.find((r) => r.stage === 'started');
        assert.ok(started, JSON.stringify(seen));
        assert.equal(started!.against, 'player', 'a queued defender meets the raider, as a player raider would be met');
        const battleId = String(started!.battleId);
        const session = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        assert.equal(session.npcDuel?.seat, 'p1', 'the raider attacks from seat p1');
        assert.equal(session.npcDuel?.npc, started!.npc);
        assert.equal(session.npcDuel?.paid, false, 'a campaign fight pays nobody');
        assert.equal(session.villageWarObjective?.objectiveId, combatHold.id);
        assert.equal(String(session.p2.name), human);
        const notices = (await kv.get<Array<Record<string, any>>>(`challenges:${human}`)) ?? [];
        assert.ok(notices.some((n) => n.sectorAttack === true && n.battleId === battleId), `the defender is told they were attacked: ${JSON.stringify(notices)}`);

        const driver = await import('./_npc-duel-driver.js');
        for (let guard = 0; guard < 400; guard++) {
            const live = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
            if (live.status === 'done') break;
            if (live.activePlayer === 'p2') await call(move, human, { battleId, role: 'p2', action: 'wait', moveToken: `w${guard}` });
            else await driver.driveNpcDuel(battleId, 'p1');
            mock.timers.tick(1_000);
        }
        const done = (await kv.get<PvpSession>(`pvp:${battleId}`))!;
        assert.equal(done.status, 'done');
        assert.equal(done.winner, 'p1', 'the raider beat a defender who only waited');
        for (let i = 0; i < 5 && (await driver.driveNpcDuel(battleId, 'p1')) !== 'finished'; i++) mock.timers.tick(1_000);
        war = await warRow(warId);
        // (The test's fought-out strongholds may settle their bonuses on this write too, so read the duel's own receipt.)
        const receipt = war.campaign.receipts[`combat:${battleId}`];
        assert.deepEqual({ points: receipt?.points, village: receipt?.village, player: receipt?.player }, { points: 50, village: CH, player: started!.npc },
            'a stronghold win scores for Cinderhold like a player\'s');
        assert.ok(Number(war.campaign.pvp[CH] ?? 0) - pvpBefore >= 50);
        const hold = war.campaign.strongholds.find((o: { id: string }) => o.id === combatHold.id);
        assert.equal(hold.bouts, 1, 'and counts a bout');
        assert.equal(hold.wins[CH], 1);
        assert.equal(war.contributions[started!.npc].pvpKills, 1, 'the raider shows in the war\'s contributions like a player');

        const after = await tick();
        assert.ok(after.raids.some((r) => r.stage === 'finished' && r.npc === started!.npc && r.points === 50), JSON.stringify(after.raids));
        const { readNpcCampaignState } = await import('./_npc-campaign-assignments.js');
        assert.equal((await readNpcCampaignState()).assignments[started!.npc], undefined, 'the raider\'s order ends with its battle');
        online.remove(human);
    });

    it('a card stronghold\'s queued defender plays a real Chronicle duel the raider\'s seat plays', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: NOW + 4 * 60 * 60_000 });
        t.after(() => mock.timers.reset());
        const warCampaign = unwrap(await import('./village/war-campaign.js'));
        const seat = await import('./_npc-campaign-card-seat.js');
        const { TURN_TIMEOUT_MS } = await import('../shared/chronicle-duel.js');
        let war = await warRow(warId);
        const cardHold = war.campaign.strongholds.find((o: { village: string; mode: string }) => o.village === MOON && o.mode === 'card');
        await onlyRaidable(warId, cardHold.id);
        const human = 'mooncardguard';
        const character = playerCharacter(human, MOON, 60);
        await kv.set(`save:${human}`, { _saveVersion: 1, currentSector: cardHold.sector, character });
        online.upsert({ name: human, sector: 0, character } as never);
        const queued = await call(warCampaign, human, { warId, action: 'defend', objectiveId: cardHold.id });
        assert.equal(queued.status, 200, JSON.stringify(queued.body));
        const pvpBefore = Number(war.campaign.pvp[CH] ?? 0);

        await nextWindow();
        const seen = await tickUntil('started');
        const started = seen.find((r) => r.stage === 'started');
        assert.ok(started, JSON.stringify(seen));
        assert.equal(started!.against, 'player');
        assert.ok((await seat.liveNpcCampaignCardRuns())[started!.runId!], 'the raider\'s card seat is registered');
        const key = `village-campaign-run:${started!.runId}`;
        const run = (await kv.get<Record<string, any>>(key))!;
        assert.ok(run.card, 'a real PvP Chronicle duel, not an AI match');
        assert.equal(run.attacker, started!.npc);
        assert.equal(run.defender, human);

        // The defender never plays: the raider plays its turns, and the duel's own clock forfeits the absentee.
        let npcActed = false;
        for (let guard = 0; guard < 80; guard++) {
            const live = (await kv.get<Record<string, any>>(key))!;
            if (live.status === 'done') break;
            const state = live.card;
            if (state.status === 'active' && state.activePlayer === 'p1' && !state.responseWindow) npcActed = true;
            const humanTurn = state.status === 'active' && (state.responseWindow ? state.responseWindow.responder === 'p2' : state.activePlayer === 'p2');
            if (humanTurn) mock.timers.tick(TURN_TIMEOUT_MS + 1_000);
            await seat.driveNpcCampaignCardRun(started!.runId!, { npc: started!.npc, warId, at: Date.now() });
        }
        const finished = (await kv.get<Record<string, any>>(key))!;
        assert.equal(finished.status, 'done', `the duel ended: ${JSON.stringify(finished.card?.log?.slice(-4))}`);
        // Its own turns were played, not timed out (the background kick may have played them between reads).
        const own = (finished.card.events ?? []).filter((e: { actor?: string; kind: string }) => e.actor === 'p1' && e.kind !== 'turn-started' && e.kind !== 'duel-ended');
        assert.ok(npcActed || own.length > 0, 'the raider played turns of its own');
        assert.ok(own.length > 0, `the raider acted: ${JSON.stringify((finished.card.events ?? []).slice(-12).map((e: { kind: string; actor?: string }) => `${e.actor}:${e.kind}`))}`);
        assert.ok(!(Number(finished.card.afkStrikes?.p1) > 0), 'the raider never let its own clock run out');
        assert.equal(finished.card.winner, 'p1', 'the walked-out defender forfeits');
        war = await warRow(warId);
        // (The test's fought-out strongholds settle their bonuses on this write too, so read the duel's own receipt.)
        assert.deepEqual({ points: war.campaign.receipts[`run:${started!.runId}`]?.points, village: war.campaign.receipts[`run:${started!.runId}`]?.village },
            { points: 50, village: CH }, 'the stronghold win scores for Cinderhold like a player\'s');
        assert.ok(Number(war.campaign.pvp[CH] ?? 0) - pvpBefore >= 50);
        assert.equal(war.campaign.strongholds.find((o: { id: string }) => o.id === cardHold.id).bouts, 1);
        assert.equal((await seat.liveNpcCampaignCardRuns())[started!.runId!], undefined, 'the seat lets the finished run go');
        online.remove(human);

        // Nobody queued now: the next raider plays the AI copy's Chronicle match from the attacker's seat, to the end.
        // Short of hands, as when the shrine squad and a field order take the
        // spare shinobi: every unposted one has spent its daily allowance, so
        // the raider must be called off a stronghold post (this used to starve
        // the raid on some runs).
        await nextWindow();
        const { readNpcCampaignState, writeNpcCampaignState } = await import('./_npc-campaign-assignments.js');
        const state = await readNpcCampaignState();
        // The stronghold squads stand as they are (posts kept alive across the window jump).
        const posted = Object.entries(state.assignments).filter(([, a]) => a.kind === 'stronghold').map(([id]) => id);
        for (const id of posted) state.assignments[id]!.until = Date.now() + 10 * TICK;
        await writeNpcCampaignState(state);
        assert.ok(posted.length > 0, 'Cinderhold has stronghold squads posted');
        // Every shinobi not on a stronghold post (unposted, or on a shrine or field order that may end this tick) is spent.
        const spent = roster.NPC_WAR_DEFENDERS.map((npc) => npc.id).filter((id) => !posted.includes(id));
        war = await warRow(warId);
        const day = `${CH}:${Math.floor((Date.now() - war.campaign.startsAt) / 86_400_000)}`;
        war.campaign.usage[day] ??= { total: 0, categories: {}, players: {} };
        for (const id of spent) war.campaign.usage[day].players[id] = { total: 4, categories: { sabotage: 2 } };
        await kv.set(`world:war:${warId}`, war);
        const seenCopy = await tickUntil('started');
        const vsCopy = seenCopy.find((r) => r.stage === 'started');
        assert.ok(vsCopy, `a second card raid starts: ${JSON.stringify(seenCopy)}`);
        assert.ok(posted.includes(vsCopy!.npc), 'the raider was called off a stronghold post');
        const queue = await kv.get(`village-campaign-defense:${warId}:g${war.declarationGeneration}:${vsCopy!.npc}`);
        assert.equal(queue, null, 'and left its defense queue');
        assert.equal(vsCopy!.against, 'copy');
        const copyKey = `village-campaign-run:${vsCopy!.runId}`;
        assert.ok((await kv.get<Record<string, any>>(copyKey))!.aiCard, 'the AI match a player attacker would play');
        for (let guard = 0; guard < 300; guard++) {
            if ((await kv.get<Record<string, any>>(copyKey))!.status === 'done') break;
            await seat.driveNpcCampaignCardRun(vsCopy!.runId!, { npc: vsCopy!.npc, warId, at: Date.now() });
            mock.timers.tick(1_000);
        }
        const copyRun = (await kv.get<Record<string, any>>(copyKey))!;
        assert.equal(copyRun.status, 'done', 'the raider played the AI match to its end');
        war = await warRow(warId);
        const copyReceipt = war.campaign.receipts[`run:${vsCopy!.runId}`];
        assert.equal(copyReceipt?.village, CH);
        assert.equal(copyReceipt.points > 0, copyRun.aiCard.state.winner === 'p1', 'PvE support only for a won assault');
        assert.equal(war.campaign.strongholds.find((o: { id: string }) => o.id === cardHold.id).bouts, 1, 'no bout for the AI copy');
    });

    it('the seat asks the hard Chronicle AI for seat p1 and gets a move legal for p1', async () => {
        const { createMatch, applyAction } = await import('../shared/chronicle-duel.js');
        const { resolveChronicleDeckMutation } = await import('./card-clash/_deck.js');
        const { chooseP1Intents } = await import('./_npc-campaign-card-seat.js');
        const deck = resolveChronicleDeckMutation(playerCharacter('deckprobe', MOON, 60), []);
        assert.ok(deck.ok);
        const ids = deck.ok ? deck.value.deck : [];
        let state = createMatch('seatone', ids, 'seattwo', ids, () => 0.1, NOW);
        if (state.activePlayer !== 'p1') state = createMatch('seatone', ids, 'seattwo', ids, () => 0.9, NOW);
        assert.equal(state.activePlayer, 'p1');
        const choices = chooseP1Intents(state);
        assert.ok(choices?.length, 'p1 has a move');
        assert.ok(choices!.some((intent) => applyAction(state, 'p1', intent, NOW).ok), JSON.stringify(choices));
        const flipped = { ...state, activePlayer: 'p2' as const };
        assert.equal(chooseP1Intents(flipped), null, 'not p1\'s move: nothing');
    });

    it('switched off it raids nothing; once the campaign is over nothing raids and the idle tick reads no war row whole', async (t) => {
        mock.timers.enable({ apis: ['Date'], now: NOW + 6 * 60 * 60_000 });
        t.after(() => mock.timers.reset());
        let war = await warRow(warId);
        const combatHold = war.campaign.strongholds.find((o: { village: string; mode: string }) => o.village === MOON && o.mode === 'combat');
        await onlyRaidable(warId, combatHold.id);
        await nextWindow();
        process.env.DISABLE_NPC_VILLAGE = '1';
        try {
            const off = await tick();
            assert.deepEqual(off.raids, [], 'DISABLE_NPC_VILLAGE=1: no raid');
        } finally { delete process.env.DISABLE_NPC_VILLAGE; }

        war = await warRow(warId);
        mock.timers.tick(war.campaign.endsAt - Date.now() + TICK);
        const ended = await tick(); // clears the ended war's orders
        assert.deepEqual(ended.raids, [], 'the campaign is over: no raid');
        const { projectKvValue } = await import('./_storage-projection.js');
        const { NPC_CAMPAIGN_ASSIGNMENTS_KEY } = await import('./_npc-campaign-assignments.js');
        const fullRead = kv.mget.bind(kv);
        kv.mgetProjected = async (keys, projection) => (await fullRead(...keys)).map((value) => projectKvValue(value, projection));
        try {
            const mget = mock.method(kv, 'mget');
            const get = mock.method(kv, 'get');
            const set = mock.method(kv, 'set');
            const idle = await tick();
            const wholeWarReads = [...mget.mock.calls.flatMap((c) => c.arguments as unknown[]), ...get.mock.calls.map((c) => c.arguments[0])]
                .filter((k) => String(k).startsWith('world:war:'));
            const stateWrites = set.mock.calls.filter((c) => c.arguments[0] === NPC_CAMPAIGN_ASSIGNMENTS_KEY).length;
            mget.mock.restore(); get.mock.restore(); set.mock.restore();
            assert.deepEqual(idle.raids, []);
            assert.deepEqual(wholeWarReads, [], 'no war row is read whole on an idle tick');
            assert.equal(stateWrites, 0, 'and nothing is written');
        } finally { delete kv.mgetProjected; }
        for (const npc of roster.NPC_WAR_DEFENDERS) online.remove(npc.name);
    });
});

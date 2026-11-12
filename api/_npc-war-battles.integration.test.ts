import assert from 'node:assert/strict';
import { before, mock, test } from 'node:test';

// Cinderhold Push 3 (owner ruling 2026-11-09: pet and card battles against the
// NPCs happen only inside war features). Through the REAL handlers on the
// isolated memory store: a war card duel against an NPC that the server plays
// to the end, the capped Chronicle Point rule, and the NPC's war pet team.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'npc-war-battles-session-secret-32chars';
delete process.env.DISABLE_VILLAGE_WAR;

type Handler = (req: never, res: never) => Promise<unknown>;
let kv: typeof import('./_storage.js').kv;
let online: typeof import('./_realtime/online-store.js').onlineStore;
let token: typeof import('./_auth.js').issuePlayerToken;
let war: typeof import('./_sector-war.js');
let roster: typeof import('../shared/npc-village-roster.js');
let cp: typeof import('./card-clash/_card-cp.js');
let driver: typeof import('./_npc-card-duel-driver.js');
let card: Handler;

const ATTACKER = 'Moonshadow Village';
const SECTOR = 68;

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ onlineStore: online } = await import('./_realtime/online-store.js'));
    ({ issuePlayerToken: token } = await import('./_auth.js'));
    war = await import('./_sector-war.js');
    roster = await import('../shared/npc-village-roster.js');
    cp = await import('./card-clash/_card-cp.js');
    driver = await import('./_npc-card-duel-driver.js');
    const mod = await import('./village/sector-card.js');
    card = ((mod.default as unknown as { default?: Handler })?.default ?? mod.default) as unknown as Handler;
    driver.setNpcCardBeatForTest(0);
    await kv.set('npc-village:state', { baseLevel: 60, target: 60, sample: 30, computedAt: Date.now(), petBaseLevel: 30 });
    const seed = await import('./_npc-village-seed.js');
    assert.deepEqual((await seed.seedNpcVillage()).failures, []);
});

let ipSeq = 0;
async function call(player: string, body: Record<string, unknown>) {
    const out = { status: 200, body: {} as Record<string, any> };
    const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(v: Record<string, any>) { out.body = v; return res; }, end: () => res };
    const ip = `10.71.0.${++ipSeq % 250}`;
    await card({ method: 'POST', body: { playerName: player, ...body }, query: {},
        headers: { 'x-player-name': player, 'x-player-token': token(player) ?? '' }, socket: { remoteAddress: ip } } as never, res as never);
    return out;
}

async function seedHuman(name: string, level: number) {
    const character = { name, level, village: ATTACKER, chroniclePoints: 0, createdAt: Date.UTC(2026, 0, 1), hp: 1000, maxHp: 1000 };
    await kv.set(`save:${name}`, { _saveVersion: 1, currentSector: SECTOR, character });
    online.upsert({ name, sector: SECTOR, character });
}
const pointsOf = async (name: string) => Number((await kv.get<{ character: { chroniclePoints?: number } }>(`save:${name}`))?.character.chroniclePoints ?? 0);

test('a war card duel against a Cinderhold shinobi: the server joins with its deck and plays it out', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 10, 0, 0) });
    t.after(() => mock.timers.reset());
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'elite')!;
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    const human = 'warcardhuman';
    await seedHuman(human, Number(npcSave.character.level));
    online.upsert({ name: npc.name, sector: SECTOR, character: npcSave.character });
    const contest = war.newSectorWarSession({ sector: SECTOR, attackerVillage: ATTACKER, defenderVillage: roster.NPC_VILLAGE_ROSTER.length ? npcSave.character.village : '', winCondition: 'card', now: Date.now() - 60 * 60 * 1000 });
    await kv.set(war.sectorWarKey(contest.id), contest);

    const engaged = await call(human, { action: 'engage', sectorWarId: contest.id, target: npc.name });
    assert.equal(engaged.status, 200, JSON.stringify(engaged.body));
    const engageId = String(engaged.body.engageId);
    assert.equal(online.get(npc.name)?.pendingAttacker ?? null, null, 'no attack flag on an NPC: it has no client to wake');
    // An admin cannot take the NPC over while its war duel is live.
    process.env.ADMIN_PASSWORD = 'npc-war-admin';
    const possess = (await import('./admin/npc-possess.js')).default as unknown as Handler;
    const took = { status: 200, body: {} as Record<string, any> };
    const tookRes = { setHeader: () => tookRes, status(n: number) { took.status = n; return tookRes; }, json(v: Record<string, any>) { took.body = v; return tookRes; }, end: () => tookRes };
    await possess({ method: 'POST', body: { npc: npc.id, action: 'take' }, query: {}, headers: { 'x-admin-password': 'npc-war-admin' }, socket: { remoteAddress: '10.72.0.1' } } as never, tookRes as never);
    assert.equal(took.status, 409, JSON.stringify(took.body));
    // The engage kicked the seat; drive it to be sure the NPC has taken its place.
    await driver.driveNpcCardDuel(engageId, (await driver.liveNpcCardDuels())[engageId]!);
    const { applyAction } = await import('../shared/chronicle-duel.js');
    type Row = { status: string; state?: import('../shared/chronicle-duel.js').ChronicleMatch };
    let row = (await kv.get<Row>(`sector-card-open:${engageId}`))!;
    assert.equal(row.status, 'active', 'the NPC joined the duel with its own saved deck');

    // The player only ever passes and ends turns; the NPC must win on its own.
    const HUMAN_STEPS = ['pass-response', 'advance-phase', 'enter-end-phase', 'end-turn'] as const;
    for (let guard = 0; guard < 600 && row.status === 'active'; guard++) {
        const state = row.state!;
        const humanToAct = state.responseWindow ? state.responseWindow.responder === 'p1' : state.activePlayer === 'p1';
        if (humanToAct) {
            const step = HUMAN_STEPS.find((action) => applyAction(state, 'p1', { action }, Date.now()).ok);
            assert.ok(step, `the player always has a legal pass (phase ${state.phase})`);
            const moved = await call(human, { action: step, sectorWarId: contest.id, engageId });
            assert.equal(moved.status, 200, JSON.stringify(moved.body));
        } else {
            await driver.driveNpcCardDuel(engageId, (await driver.liveNpcCardDuels())[engageId]!);
        }
        mock.timers.tick(3_000);
        row = (await kv.get<Row>(`sector-card-open:${engageId}`))!;
    }
    assert.equal(row.status, 'done', 'the duel was played to its end');
    assert.equal(row.state?.winner, 'p2', 'an idle player loses to the NPC');
    // The seat retires the duel; the player's capped loss share pays, the NPC's nothing.
    assert.equal(await driver.driveNpcCardDuel(engageId, (await driver.liveNpcCardDuels())[engageId]!), 'finished');
    const settled = (await kv.get<{ cpCredit?: { status: string; reason?: string }; participation?: unknown }>(`sector-card-open:${engageId}`))!;
    // A player who only ever passed did not play the duel: the free-play
    // participation gate (unchanged) pays them nothing, exactly as against a player.
    assert.equal(settled.cpCredit?.reason, 'participation', JSON.stringify(settled.cpCredit) + JSON.stringify(settled.participation));
    assert.equal(await pointsOf(human), 0);
    assert.equal(await pointsOf(npc.id), 0, 'the NPC is never paid');
    assert.deepEqual(await driver.liveNpcCardDuels(), {});
});

test('card duels with NPCs pay the normal 20/8: the first win and the first loss per NPC per day, five a day each, from separate counts; never the NPC', async () => {
    const now = Date.UTC(2026, 10, 9, 14, 0, 0);
    const human = 'cpnpcfarmer';
    await seedHuman(human, 60);
    const npcs = roster.NPC_VILLAGE_ROSTER.filter((n) => n.rank === 'elite' || n.rank === 'jonin');
    let seq = 0;
    const settle = async (npcId: string, humanWins: boolean, extra: Record<string, unknown> = {}) => {
        const session = {
            p1Name: human, p2Name: npcId, updatedAt: now + seq * 1000,
            state: { status: 'complete', winner: humanWins ? 'p1' : 'p2', turnNumber: 6 },
            participation: { startedAt: now - 120_000, p1Actions: 5, p2Actions: 5, endedBy: 'play' },
            ...extra,
        } as never;
        const credit = cp.prepareCardPvpCpCredit(session, `npc-cp-${++seq}`, 'war')!;
        await cp.settleCardCpCredit(credit);
        return credit;
    };
    const first = await settle(npcs[0]!.id, true);
    assert.deepEqual(first.amounts, { winner: 20, loser: 0 });
    const repeat = await settle(npcs[0]!.id, true);
    assert.deepEqual(repeat.amounts, { winner: 0, loser: 0 }, 'a second duel with the same NPC today pays nothing');
    assert.equal(cp.cardCpView(repeat, human)?.reason, 'repeat');
    // 2026-11-11: a loss pays the normal 8-point loss share for the first loss
    // to each NPC a day, at most five, from its OWN count: it never spends a
    // win slot, and a win never spends a loss slot.
    const lost = await settle(npcs[1]!.id, false);
    assert.deepEqual(lost.amounts, { winner: 0, loser: 8 }, 'the first loss to an NPC today pays the loss share; the NPC gets nothing');
    assert.deepEqual((await settle(npcs[1]!.id, false)).amounts, { winner: 0, loser: 0 }, 'a second loss to the same NPC today pays nothing');
    assert.equal((await settle(npcs[1]!.id, true)).amounts?.winner, 20, 'the first WIN over that NPC today still pays');
    assert.deepEqual((await settle(npcs[0]!.id, false)).amounts, { winner: 0, loser: 8 }, 'a win over npcs[0] spent no loss slot');
    const controlled = await settle(npcs[2]!.id, true, { npcControlled: true });
    assert.deepEqual(controlled.amounts, { winner: 0, loser: 0 }, 'an admin-played NPC pays nobody');
    assert.deepEqual((await settle(npcs[2]!.id, false, { npcControlled: true })).amounts, { winner: 0, loser: 0 }, 'win or lose');
    for (const npc of npcs.slice(3, 6)) assert.equal((await settle(npc.id, true)).amounts?.winner, 20);
    assert.equal((await settle(npcs[6]!.id, true)).amounts?.winner, 0, 'a sixth win the same day pays nothing');
    for (const npc of npcs.slice(3, 6)) assert.equal((await settle(npc.id, false)).amounts?.loser, 8, 'losses count on their own');
    assert.equal((await settle(npcs[6]!.id, false)).amounts?.loser, 0, 'a sixth NPC loss the same day pays nothing');
    assert.equal(await pointsOf(human), 20 * 5 + 8 * 5);
    for (const npc of npcs.slice(0, 7)) assert.equal(await pointsOf(npc.id), 0);

    // A clan-war Chronicle Showdown against a Cinderhold clan pays like one
    // between two player clans (owner ruling 2026-11-10): the normal pair
    // weight, even after the NPC daily cap is spent, and never the NPC.
    const clanWar = async (npcId: string, humanWins: boolean, extra: Record<string, unknown> = {}) => {
        const session = {
            p1Name: human, p2Name: npcId, updatedAt: now + ++seq * 1000,
            state: { status: 'complete', winner: humanWins ? 'p1' : 'p2', turnNumber: 6 },
            participation: { startedAt: now - 120_000, p1Actions: 5, p2Actions: 5, endedBy: 'play' },
            ...extra,
        } as never;
        const credit = cp.prepareCardPvpCpCredit(session, `card-pvp:cw:npc-cw-${seq}:${now}`, 'war')!;
        await cp.settleCardCpCredit(credit);
        return credit;
    };
    const cwWin = await clanWar(npcs[0]!.id, true);
    // Both PvP shares are set as between players; the NPC's share is never paid.
    assert.deepEqual(cwWin.amounts, { winner: 20, loser: 8 }, 'a clan-war win pays the full PvP share past the NPC cap');
    assert.equal(cwWin.pairOrdinal, 1, 'it takes the normal pair-weight slot');
    const cwLoss = await clanWar(npcs[7]!.id, false);
    assert.deepEqual(cwLoss.amounts, { winner: 20, loser: 8 }, 'a clan-war loss pays the PvP loss share');
    const cwControlled = await clanWar(npcs[8]!.id, true, { npcControlled: true });
    assert.deepEqual(cwControlled.amounts, { winner: 0, loser: 0 }, 'an admin-played NPC still pays nobody');
    assert.equal(await pointsOf(human), 20 * 5 + 8 * 5 + 20 + 8);
    for (const npc of npcs.slice(0, 9)) assert.equal(await pointsOf(npc.id), 0);
});

test('an NPC fields its own scaled companions in a war pet battle', async () => {
    const { buildWarTeam, WAR_TEAM_SIZE } = await import('./_pet-showdown/war-team.js');
    const { npcPetLevelFor } = await import('./_npc-village-scaling.js');
    const { npcPetLevels } = await import('./_npc-village-seed.js');
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'commander')!;
    const save = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    const team = buildWarTeam(save.character)!;
    assert.equal(team.length, Math.min(WAR_TEAM_SIZE, npc.pets.length));
    const scaled = npcPetLevels(npc, npcPetLevelFor(npc.rank, 30));
    for (const pet of team) assert.ok(scaled.includes((pet as unknown as { level: number }).level), 'each fielded companion is one of its scaled pets');
});

test("the card AI's choice never depends on the opponent's hidden hand or deck", async () => {
    const { createMatch, applyAction } = await import('../shared/chronicle-duel.js');
    const { CHRONICLE_AI_DECKS, chooseAiIntents } = await import('./card-clash/_ai-engine.js');
    let state = createMatch('peeker', [...CHRONICLE_AI_DECKS.hard], 'seat', [...CHRONICLE_AI_DECKS.hard], () => 0.37, Date.UTC(2026, 10, 9));
    const pool = [...CHRONICLE_AI_DECKS.medium, ...CHRONICLE_AI_DECKS.easy];
    let checked = 0;
    for (let step = 0; step < 400 && state.status === 'active'; step++) {
        const now = Date.UTC(2026, 10, 9) + step * 1000;
        const choice = chooseAiIntents(state, 'hard');
        if (choice) {
            // Rewrite everything p1 holds face-down (hand and deck) with other cards.
            const scrambled = structuredClone(state);
            scrambled.p1.hand = scrambled.p1.hand.map((_, i) => pool[(i * 7 + step) % pool.length]!);
            scrambled.p1.deck = scrambled.p1.deck.map((_, i) => pool[(i * 11 + step) % pool.length]!);
            assert.deepEqual(chooseAiIntents(scrambled, 'hard'), choice, `step ${step}`);
            checked++;
            const legal = choice.find((intent) => applyAction(state, 'p2', intent, now).ok);
            if (!legal) break;
            state = (applyAction(state, 'p2', legal, now) as { ok: true; state: typeof state }).state;
        } else {
            const pass = ['pass-response', 'advance-phase', 'enter-end-phase', 'end-turn'].find((action) => applyAction(state, 'p1', { action }, now).ok);
            if (!pass) break;
            state = (applyAction(state, 'p1', { action: pass }, now) as { ok: true; state: typeof state }).state;
        }
    }
    assert.ok(checked > 10, `checked ${checked} AI decisions`);
});
test('no NPC sits at the war table, and no NPC battle feeds the war purse', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'chunin')!;
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    const contest = war.newSectorWarSession({ sector: 69, attackerVillage: ATTACKER, defenderVillage: npcSave.character.village, winCondition: 'card', now: Date.now() - 60 * 60 * 1000 });
    await kv.set(war.sectorWarKey(contest.id), contest);
    const seated = await call(npc.id, { action: 'join', sectorWarId: contest.id });
    assert.equal(seated.status, 403, JSON.stringify(seated.body));
    const { sectorWarPurseEligible } = await import('./_sector-war-purse-eligibility.js');
    await seedHuman('pursehunter', Number(npcSave.character.level));
    assert.equal(await sectorWarPurseEligible({ winnerName: 'pursehunter', loserName: npc.id, endedAt: Date.now() }), false);
    assert.equal(await sectorWarPurseEligible({ winnerName: npc.id, loserName: 'pursehunter', endedAt: Date.now() }), false);
});

test('NPC pets are raised the way players\' are: move power per level, the level-50 unlock, and a build that fits the species', async () => {
    const { grownNpcPet } = await import('./_npc-village-seed.js');
    const { createOwnedPet } = await import('./pet/_owned-pet.js');
    const { PET_CATALOG } = await import('./pet/_catalog.js');
    const id = Object.keys(PET_CATALOG).find((key) => key.startsWith('mythic'))!;
    const base = createOwnedPet(id, { origin: 'wild' } as never);
    const raised = grownNpcPet(base, 60);
    assert.equal(raised.level, 60);
    assert.equal(raised.unlockedForPve, true);
    const powers = (list: unknown) => (list as Array<{ power: number }>).map((j) => j.power);
    assert.ok(powers(raised.jutsus).every((p, i) => p === 0 || p >= powers(base.jutsus)[i]! + 30), 'each move gained floor(60/2) power');
    // Across the catalog the strongest growth stat is not always Vitality.
    const leads = new Set(Object.keys(PET_CATALOG).slice(0, 60).map((key) => {
        const pet = grownNpcPet(createOwnedPet(key, { origin: 'wild' } as never), 40);
        const alloc = pet.growthAllocation as Record<string, number>;
        return Object.entries(alloc).sort((a, b) => b[1] - a[1])[0]![0];
    }));
    assert.ok(leads.size >= 3, `builds lean different ways by species: ${[...leads]}`);
});

test('the pet sample is the first fifteen eligible players who own a pet', async () => {
    const { petSampleFrom } = await import('./_npc-village-scaling.js');
    const saves = [{ character: { pets: [] } }, ...Array.from({ length: 20 }, (_, i) => ({ character: { pets: [{ level: i + 1 }] } }))];
    const sample = petSampleFrom(saves);
    assert.equal(sample.length, 15);
    assert.deepEqual(sample[0], [1], 'the pet-less top player gave their place to the next');
});

test('war pet battles: an NPC never fights one itself; its team answers an engage, untouched, once it is free', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 16, 0, 0) });
    t.after(() => mock.timers.reset());
    const petMod = await import('./village/sector-pet.js');
    const pet = ((petMod.default as unknown as { default?: Handler })?.default ?? petMod.default) as unknown as Handler;
    const callPet = async (player: string, body: Record<string, unknown>) => {
        const out = { status: 200, body: {} as Record<string, any> };
        const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(v: Record<string, any>) { out.body = v; return res; }, end: () => res };
        await pet({ method: 'POST', body: { playerName: player, ...body }, query: {}, headers: { 'x-player-name': player, 'x-player-token': token(player) ?? '' }, socket: { remoteAddress: `10.73.0.${++ipSeq % 250}` } } as never, res as never);
        return out;
    };
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'jonin')!;
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    const contest = war.newSectorWarSession({ sector: 70, attackerVillage: ATTACKER, defenderVillage: npcSave.character.village, winCondition: 'pet', now: Date.now() - 60 * 60 * 1000 });
    await kv.set(war.sectorWarKey(contest.id), contest);
    // As the NPC itself (an admin's takeover token): refused.
    assert.equal((await callPet(npc.id, { action: 'join', sectorWarId: contest.id })).status, 403);
    // A player engages it: its own sealed team fights, and its save is not written.
    const { createOwnedPet } = await import('./pet/_owned-pet.js');
    const mine = createOwnedPet('standard-0', { origin: 'wild' } as never);
    const human = 'warpethuman';
    const character = { name: human, level: Number(npcSave.character.level), village: ATTACKER, createdAt: Date.UTC(2026, 0, 1), pets: [mine], activePetId: mine.id };
    await kv.set(`save:${human}`, { _saveVersion: 1, currentSector: 70, character });
    online.remove(npc.name);
    online.upsert({ name: human, sector: 70, character });
    online.upsert({ name: npc.name, sector: 70, character: npcSave.character });
    const before = JSON.stringify(await kv.get(`save:${npc.id}`));
    const fought = await callPet(human, { action: 'engage', sectorWarId: contest.id, target: npc.name, petId: mine.id });
    assert.equal(fought.status, 200, JSON.stringify(fought.body));
    assert.equal(JSON.stringify(await kv.get(`save:${npc.id}`)), before, 'nothing is written to the NPC');
    // While the NPC is in a shinobi duel the server plays, it cannot be engaged.
    const duel = await import('./_npc-duel.js');
    mock.timers.tick(5 * 60_000); // past the loser's shield from the first battle
    await duel.registerNpcDuel('pet-busy-check', { version: 1, npc: npc.id, seat: 'p2', paid: false });
    online.upsert({ name: human, sector: 70, character });
    online.upsert({ name: npc.name, sector: 70, character: npcSave.character });
    const busy = await callPet(human, { action: 'engage', sectorWarId: contest.id, target: npc.name, petId: mine.id });
    assert.ok(busy.status === 409, JSON.stringify(busy.body));
    await duel.forgetNpcDuel('pet-busy-check');
});

test('an admin playing the NPC seat in a war card duel: it scores for the war but pays no Chronicle Points', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 18, 0, 0) });
    t.after(() => mock.timers.reset());
    process.env.ADMIN_PASSWORD = 'npc-war-admin';
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'genin')!;
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    const human = 'warcardadminfoe';
    await seedHuman(human, Number(npcSave.character.level));
    online.upsert({ name: npc.name, sector: SECTOR, character: npcSave.character });
    const contest = war.newSectorWarSession({ sector: 71, attackerVillage: ATTACKER, defenderVillage: npcSave.character.village, winCondition: 'card', now: Date.now() - 60 * 60 * 1000 });
    await kv.set(war.sectorWarKey(contest.id), contest);
    // The store never moves a live row between sectors: place both afresh.
    online.remove(human); online.remove(npc.name);
    online.upsert({ name: human, sector: 71, character: (await kv.get<Record<string, any>>(`save:${human}`))!.character });
    online.upsert({ name: npc.name, sector: 71, character: npcSave.character });
    // The NPC's own (server) token can never open a duel; only an admin controlling it could.
    assert.equal((await call(npc.id, { action: 'engage', sectorWarId: contest.id, target: human })).status, 403);
    const engaged = await call(human, { action: 'engage', sectorWarId: contest.id, target: npc.name });
    assert.equal(engaged.status, 200, JSON.stringify(engaged.body));
    const engageId = String(engaged.body.engageId);
    await driver.driveNpcCardDuel(engageId, (await driver.liveNpcCardDuels())[engageId]!);
    // While it is live, a shinobi duel cannot be sealed against the same NPC.
    const duel = await import('./_npc-duel.js');
    await assert.rejects(() => duel.sealNpcDuel({ battleId: 'cross-mode', rewardAuthority: 'world', p1: { name: human }, p2: { name: npc.name } }, { sessionsEnabled: true }), /npc-duel-busy/);
    // An admin sends a move on the NPC's seat by password.
    const { applyAction } = await import('../shared/chronicle-duel.js');
    type Row = { status: string; npcControlled?: boolean; state?: import('../shared/chronicle-duel.js').ChronicleMatch };
    let row = (await kv.get<Row>(`sector-card-open:${engageId}`))!;
    for (let guard = 0; guard < 200 && !row.npcControlled && row.status === 'active'; guard++) {
        const state = row.state!;
        const npcToAct = state.responseWindow ? state.responseWindow.responder === 'p2' : state.activePlayer === 'p2';
        const side = npcToAct ? 'p2' : 'p1';
        const step = ['pass-response', 'advance-phase', 'enter-end-phase', 'end-turn'].find((action) => applyAction(state, side, { action }, Date.now()).ok)!;
        const out = { status: 200, body: {} as Record<string, any> };
        const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(v: Record<string, any>) { out.body = v; return res; }, end: () => res };
        if (npcToAct) await card({ method: 'POST', body: { action: step, sectorWarId: contest.id, engageId, side: 'p2' }, query: {}, headers: { 'x-admin-password': 'npc-war-admin' }, socket: { remoteAddress: '10.74.0.1' } } as never, res as never);
        else await call(human, { action: step, sectorWarId: contest.id, engageId });
        mock.timers.tick(2_000);
        row = (await kv.get<Row>(`sector-card-open:${engageId}`))!;
    }
    assert.equal(row.npcControlled, true, 'an admin move on the NPC seat marks the duel');
    // Finish it as a properly played human win: it scores for the war like any
    // duel (owner ruling 2026-11-09), but pays no Chronicle Points.
    const done = (await kv.get<Record<string, any>>(`sector-card-open:${engageId}`))!;
    done.state.status = 'complete'; done.state.winner = 'p1'; done.state.turnNumber = 6; done.status = 'done'; done.updatedAt = Date.now();
    done.participation = { startedAt: Date.now() - 120_000, p1Actions: 5, p2Actions: 5, endedBy: 'play' };
    await kv.set(`sector-card-open:${engageId}`, done);
    const result = await call(human, { action: 'state', sectorWarId: contest.id, engageId });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.warResult?.scored, true, JSON.stringify(result.body.warResult));
    assert.equal(await pointsOf(human), 0);
    await duel.forgetNpcCardDuel(engageId);
});

test('the Cinderhold kill switch closes war engages and admin control', async () => {
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'chunin' && n.id !== roster.NPC_VILLAGE_ROSTER[0]!.id)!;
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    const contest = war.newSectorWarSession({ sector: 72, attackerVillage: ATTACKER, defenderVillage: npcSave.character.village, winCondition: 'card', now: Date.now() - 60 * 60 * 1000 });
    await kv.set(war.sectorWarKey(contest.id), contest);
    const human = 'killswitchfoe';
    await seedHuman(human, Number(npcSave.character.level));
    online.remove(human); online.remove(npc.name);
    online.upsert({ name: human, sector: 72, character: (await kv.get<Record<string, any>>(`save:${human}`))!.character });
    online.upsert({ name: npc.name, sector: 72, character: npcSave.character });
    process.env.DISABLE_NPC_VILLAGE = '1';
    try {
        const refused = await call(human, { action: 'engage', sectorWarId: contest.id, target: npc.name });
        assert.equal(refused.status, 409, JSON.stringify(refused.body));
        process.env.ADMIN_PASSWORD = 'npc-war-admin';
        const possess = (await import('./admin/npc-possess.js')).default as unknown as Handler;
        const out = { status: 200, body: {} as Record<string, any> };
        const res = { setHeader: () => res, status(n: number) { out.status = n; return res; }, json(v: Record<string, any>) { out.body = v; return res; }, end: () => res };
        await possess({ method: 'POST', body: { npc: npc.id, action: 'take' }, query: {}, headers: { 'x-admin-password': 'npc-war-admin' }, socket: { remoteAddress: '10.75.0.1' } } as never, res as never);
        assert.equal(out.status, 503, JSON.stringify(out.body));
    } finally { delete process.env.DISABLE_NPC_VILLAGE; }
});
test('an admin-controlled NPC may start a war card duel itself, and it is marked and registered', async (t) => {
    mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 9, 20, 0, 0) });
    t.after(() => mock.timers.reset());
    const npc = roster.NPC_VILLAGE_ROSTER.find((n) => n.rank === 'jonin' && n.id !== roster.NPC_VILLAGE_ROSTER.find((m) => m.rank === 'jonin')!.id)!;
    const npcSave = (await kv.get<Record<string, any>>(`save:${npc.id}`))!;
    const human = 'possessedfoe';
    await seedHuman(human, Number(npcSave.character.level));
    const contest = war.newSectorWarSession({ sector: 73, attackerVillage: ATTACKER, defenderVillage: npcSave.character.village, winCondition: 'card', now: Date.now() - 60 * 60 * 1000 });
    await kv.set(war.sectorWarKey(contest.id), contest);
    online.remove(human); online.remove(npc.name);
    online.upsert({ name: human, sector: 73, character: (await kv.get<Record<string, any>>(`save:${human}`))!.character });
    online.upsert({ name: npc.name, sector: 73, character: npcSave.character });
    const { npcPossessKey } = await import('./_npc-possession.js');
    await kv.set(npcPossessKey(npc.id), { by: 'admin', at: Date.now(), expiresAt: Date.now() + 60 * 60_000 });
    try {
        const engaged = await call(npc.id, { action: 'engage', sectorWarId: contest.id, target: human });
        assert.equal(engaged.status, 200, JSON.stringify(engaged.body));
        const engageId = String(engaged.body.engageId);
        const row = (await kv.get<{ npcControlled?: boolean; p2Name?: string }>(`sector-card-open:${engageId}`))!;
        assert.equal(row.npcControlled, true);
        assert.equal(row.p2Name, npc.id, 'the NPC holds the defending seat');
        assert.ok((await driver.liveNpcCardDuels())[engageId], 'registered, so the server takes the seat back on release');
        await (await import('./_npc-duel.js')).forgetNpcCardDuel(engageId);
    } finally { await kv.del(npcPossessKey(npc.id)); }
});
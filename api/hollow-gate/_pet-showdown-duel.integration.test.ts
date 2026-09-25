import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { hollowGateCombatBindingKey, hollowGateCombatReward, type HollowGateCombatBinding } from './_combat-session.js';
import { validateHollowGateFloorManifest } from './_floor-manifest.js';
import { hollowGateRunKey, rewardMultiplierForToken, type HollowGateRunToken } from './_run-token.js';

// "Send pet" on a Hollow Hound encounter fights the road beasts' Colosseum
// duel: a random 1v1, 2v2 or 3v3 on the server-authoritative Showdown engine,
// against the run's own Hounds. The Gate settles the server-decided result
// with its own reward, once. Every case runs the real handlers on the
// in-memory KV: combat-start, /pet/showdown, combat-settle, step and settle.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');

type Handler = (req: never, res: never) => Promise<unknown>;
type Reply = { status: number; body: Record<string, any> };
type SessionRecord = {
    sessionId: string; playerName: string; format: string; round: number; finished: boolean;
    outcome: 'win' | 'loss' | null; rewardEligible: boolean; bindingKind?: string;
    player: Array<{ id: string; level: number }>; enemy: Array<{ id: string; name: string; level: number }>;
};

let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let resetRateLimits: () => void;
let setFieldSizeRoll: typeof import('../pet/_hollow-gate-showdown.js').__setHollowGateFieldSizeRollForTest;
const handlers: Record<string, Handler> = {};

const PLAYER = 'petduelist';
const TOKEN = 'petduelisttoken01';
const WIDTH = 15;
const HEIGHT = 11;
const runKey = hollowGateRunKey(PLAYER, TOKEN);
const saveKey = `save:${PLAYER}`;
/** The Hound tile under test sits at (5,1); (4,1) is open floor. */
const HOUND = { x: 5, y: 1, node: `floor:1:tile:${1 * WIDTH + 5}` };
const ENCOUNTER_KEY = `1:battle:${HOUND.node}`;

const pet = (id: string, level: number, extra: Record<string, unknown> = {}) => ({
    id, name: `Pet ${id}`, rarity: 'rare', element: 'Earth', level, xp: 0, maxLevel: 100,
    hp: 480 + level, attack: 80 + level, defense: 70, speed: 50,
    jutsus: [{ name: 'Proof Fang', power: 88, cooldown: 2, currentCooldown: 0, kind: 'damage' }],
    unlockedForPve: true, ...extra,
});
/** The pet the player sends. Its partners need no PvE clearance: like the road
 * draw, they come from any ready carried pet. */
const LEAD = pet('pet-kuro', 52);
const PARTNERS = [pet('pet-ash', 50), pet('pet-bramble', 44), pet('pet-cinder', 20, { unlockedForPve: false })];

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ __resetRateLimitsForTest: resetRateLimits } = await import('../_ratelimit.js'));
    ({ __setHollowGateFieldSizeRollForTest: setFieldSizeRoll } = await import('../pet/_hollow-gate-showdown.js'));
    for (const [name, path] of [
        ['step', './step.js'], ['combatStart', './combat-start.js'], ['combatSettle', './combat-settle.js'],
        ['runSettle', './settle.js'], ['showdown', '../pet/showdown.js'],
    ] as const) {
        handlers[name] = (await import(path)).default as unknown as Handler;
    }
});

beforeEach(async () => {
    const keys = await kv.keys('*');
    if (keys.length) await kv.del(...keys);
    resetRateLimits();
    setFieldSizeRoll(null);
});

after(() => setFieldSizeRoll(null));

async function invoke(name: string, body: Record<string, unknown>): Promise<Reply> {
    const reply: Reply = { status: 200, body: {} };
    const res = {
        setHeader: () => res,
        status: (status: number) => { reply.status = status; return res; },
        json: (data: Record<string, unknown>) => { reply.body = data; return res; },
        end: () => res,
    };
    await handlers[name]({
        method: 'POST', body: { ...body, playerName: PLAYER }, query: {},
        headers: { 'x-player-name': PLAYER, 'x-player-token': issuePlayerToken(PLAYER)! },
        socket: { remoteAddress: '127.0.0.1' },
    } as never, res as never);
    return reply;
}
/** A Hollow Gate endpoint: every one carries the run token. */
const gate = (name: string, body: Record<string, unknown>) => invoke(name, { ...body, token: TOKEN });
/** /api/pet/showdown: the duel entry carries only its run selector. */
const showdown = (body: Record<string, unknown>) => invoke('showdown', body);
const openDuel = (runId: string) => showdown({ action: 'hollow-gate', hollowGate: { token: TOKEN, runId } });

function board() {
    const tiles = Array.from({ length: WIDTH * HEIGHT }, () => ({ kind: 'empty', terrain: 'room_floor' }));
    let index = 20;
    for (const [kind, count] of [
        ['battle', 5], ['elite', 1], ['trap', 1], ['chest', 3], ['shard_vein', 1],
        ['locked', 1], ['shrine', 1], ['story', 1], ['npc', 1],
    ] as const) {
        for (let placed = 0; placed < count; placed += 1) tiles[index++].kind = kind;
    }
    tiles[WIDTH * 9 + 1].kind = 'exit';
    tiles[WIDTH * 9 + 13].kind = 'descend';
    const validated = validateHollowGateFloorManifest({ floor: 1, finalFloor: false, width: WIDTH, height: HEIGHT, playerX: 1, playerY: 1, tiles });
    if (!validated.ok) throw new Error(validated.reason);
    return validated.manifest;
}

async function seed(pets: Array<Record<string, unknown>> = [LEAD, ...PARTNERS]) {
    const run: HollowGateRunToken = {
        playerName: PLAYER, mintedAt: Date.now(), floorDepth: 5, currentFloor: 1,
        seed: 'petduelist-seed', entryCurrencies: { ryo: 400 }, entryItems: {},
        offeredAugmentIds: ['keen-edge'], chosenAugmentId: 'keen-edge', dailyRunOrdinal: 1,
        floorManifests: { '1': board() }, position: { x: HOUND.x, y: HOUND.y },
        torch: 8, threat: 12, stepVersion: 3, recentStepIds: [],
    };
    await kv.set(runKey, run);
    await kv.set(saveKey, { _saveVersion: 1, character: {
        name: PLAYER, level: 50, hp: 500, maxHp: 500, ryo: 400,
        pets, activePetId: LEAD.id,
        itemStacks: [], hollowGateRun: { runToken: TOKEN, serverSeed: run.seed, floor: 1 },
    } });
    return run;
}

/** "Send pet": combat-start seals a Pet-mode encounter for the Hound tile. */
async function sendPet(): Promise<{ runId: string; binding: HollowGateCombatBinding }> {
    const started = await gate('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pet' });
    assert.equal(started.status, 200, JSON.stringify(started.body));
    assert.equal(started.body.combatMode, 'pet');
    const runId = String(started.body.runId);
    return { runId, binding: (await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(runId)))! };
}

const sessionKey = (sessionId: string) => `pet:showdown:${PLAYER}:${sessionId}`;
const readSession = (sessionId: string) => kv.get<SessionRecord>(sessionKey(sessionId));
async function decide(sessionId: string, outcome: 'win' | 'loss') {
    const session = (await readSession(sessionId))!;
    await kv.set(sessionKey(sessionId), { ...session, finished: true, outcome });
}
const ryo = async () => (await kv.get<{ character: { ryo: number } }>(saveKey))!.character.ryo;
let steps = 0;
const step = (from: [number, number], to: [number, number]) => gate('step', {
    requestId: `pet-duel-step-${++steps}`, fromX: from[0], fromY: from[1], toX: to[0], toY: to[1],
});

for (const size of [1, 2, 3] as const) {
    test(`Send pet opens a server-drawn ${size}v${size} Showdown duel against the run's own Hounds`, async () => {
        await seed();
        const maxima: number[] = [];
        setFieldSizeRoll((maximum) => { maxima.push(maximum); return size; });
        const { runId, binding } = await sendPet();
        assert.equal(binding.petAuthority?.engine, 'showdown', 'the parent mounts its duel on Showdown');

        const opened = await openDuel(runId);
        assert.equal(opened.status, 200, JSON.stringify(opened.body));
        const { state, petIds } = opened.body;
        assert.deepEqual(maxima, [3], 'four ready pets can field at most a 3v3');
        assert.equal(state.format, `${size}v${size}`);
        assert.equal(state.sessionId, binding.petAuthority!.proofId, 'the parent binding named the session');
        assert.equal(state.finished, false);
        assert.equal(state.player.length, size);
        assert.equal(state.enemy.length, size);
        assert.equal(petIds[0], LEAD.id, 'the pet the player sent always leads');
        assert.equal(new Set(petIds).size, size);
        assert.ok(petIds.every((id: string) => [LEAD, ...PARTNERS].some((owned) => owned.id === id)));
        assert.deepEqual(state.player.map((fighter: { id: string }) => fighter.id), petIds);
        // The AI side is the run's own Hound, once per fielded pet, each scaled
        // off the pet it faces, and each one distinct on the field.
        assert.ok(state.enemy.every((hound: { id: string }) => /^hollow-hound-encounter-\d{10,}$/.test(hound.id)));
        assert.equal(new Set(state.enemy.map((hound: { name: string }) => hound.name)).size, size);
        assert.deepEqual(state.enemy.map((hound: { level: number }) => hound.level), state.player.map((mine: { level: number }) => mine.level));
        assert.equal(state.enemyTeamName, size === 1 ? 'Ashfang Hollow Hound' : 'Ashfang Hollow Hound Pack');

        const session = (await readSession(state.sessionId))!;
        assert.equal(session.rewardEligible, false, 'the duel itself never pays; the Gate settles it');
        assert.equal(session.bindingKind, 'hollow-gate');
        assert.deepEqual(await kv.get(`sd-hg:${PLAYER}:${state.sessionId}`), { runId, petIds });
        assert.equal(await ryo(), 400, 'opening the duel costs and pays nothing');
    });
}

test('the draw is capped by the pets that can take the field, as the road draw is', async () => {
    // Two partners are busy: the lead and one partner can field at most a 2v2.
    const training = { training: { endsAt: Date.now() + 60_000 } };
    await seed([LEAD, PARTNERS[0], { ...PARTNERS[1], ...training }, { ...PARTNERS[2], expedition: { endsAt: Date.now() + 60_000 } }]);
    const maxima: number[] = [];
    setFieldSizeRoll((maximum) => { maxima.push(maximum); return 3; });
    const pair = await openDuel((await sendPet()).runId);
    assert.equal(pair.status, 200, JSON.stringify(pair.body));
    assert.deepEqual(maxima, [2]);
    assert.equal(pair.body.state.format, '2v2');
    assert.deepEqual(pair.body.petIds, [LEAD.id, PARTNERS[0].id]);

    // A lone ready pet always fights a 1v1.
    await kv.del(...await kv.keys('*'));
    resetRateLimits();
    await seed([LEAD, { ...PARTNERS[0], ...training }]);
    maxima.length = 0;
    const lone = await openDuel((await sendPet()).runId);
    assert.equal(lone.status, 200, JSON.stringify(lone.body));
    assert.deepEqual(maxima, [1]);
    assert.equal(lone.body.state.format, '1v1');
    assert.deepEqual(lone.body.petIds, [LEAD.id]);
});

test('a reload resumes the same duel instead of drawing a new one', async () => {
    await seed();
    setFieldSizeRoll(() => 3);
    const { runId } = await sendPet();
    const opened = await openDuel(runId);
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    const { state } = opened.body;
    const round = await showdown({
        action: 'turn', sessionId: state.sessionId, expectedRound: state.round,
        commands: state.player.map((fighter: { id: string }) => ({ kind: 'guard', petId: fighter.id })),
    });
    assert.equal(round.status, 200, JSON.stringify(round.body));
    assert.equal(round.body.state.round, state.round + 1);

    // The browser reloads: the shrine resumes the encounter, and the duel with it.
    setFieldSizeRoll(() => 1);
    const resumedEncounter = await gate('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pet' });
    assert.equal(resumedEncounter.body.resumed, true);
    assert.equal(resumedEncounter.body.runId, runId);
    const resumed = await openDuel(runId);
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.resumed, true);
    assert.equal(resumed.body.state.sessionId, state.sessionId);
    assert.equal(resumed.body.state.format, '3v3', 'a resume never re-rolls the format');
    assert.equal(resumed.body.state.round, state.round + 1);
    assert.deepEqual(resumed.body.petIds, opened.body.petIds);
    assert.deepEqual(resumed.body.state.enemy.map((hound: { id: string }) => hound.id), state.enemy.map((hound: { id: string }) => hound.id));
    assert.equal((await kv.keys(`pet:showdown:${PLAYER}:*`)).length, 1, 'one encounter, one duel');
});

test('a won 3v3 duel resolves the encounter and pays its Hollow Gate reward exactly once', async () => {
    const run = await seed();
    setFieldSizeRoll(() => 3);
    const { runId } = await sendPet();
    const { state, petIds } = (await openDuel(runId)).body;
    assert.equal(petIds.length, 3);
    await decide(state.sessionId, 'win');
    const finished = await showdown({ action: 'turn', sessionId: state.sessionId, commands: [] });
    assert.equal(finished.status, 200, JSON.stringify(finished.body));
    assert.equal(finished.body.reward, 0, 'the arena faucet never pays a Gate duel');
    assert.deepEqual(finished.body.hollowGate, { runId, petReceipt: state.sessionId });
    const receipt = await kv.get<Record<string, unknown>>(`hg-pet-result:${PLAYER}:${state.sessionId}`);
    assert.equal(receipt?.engine, 'showdown');
    assert.equal(receipt?.outcome, 'win');
    assert.deepEqual(receipt?.playerPetIds, petIds);
    assert.equal(await ryo(), 400);

    // A forged receipt for another proof cannot stand in for the fought duel.
    assert.equal((await gate('combatSettle', { runId, petReceipt: 'forgedproofreceipt01' })).status, 409);

    const [first, second] = await Promise.all([
        gate('combatSettle', { runId, petReceipt: state.sessionId }),
        gate('combatSettle', { runId, petReceipt: state.sessionId }),
    ]);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.deepEqual([first.body.won, second.body.won], [true, true]);
    assert.equal([first.body.alreadyReported, second.body.alreadyReported].filter(Boolean).length, 1, 'one of the two settles is the replay');
    const reward = Math.floor(hollowGateCombatReward(1, 'battle').ryo * rewardMultiplierForToken(run));
    assert.ok(reward > 0);
    assert.equal(await ryo(), 400 + reward);

    const replay = await gate('combatSettle', { runId, petReceipt: state.sessionId });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.alreadyReported, true);
    assert.equal(await ryo(), 400 + reward, 'a settled duel never pays twice');
    const after = (await kv.get<HollowGateRunToken>(runKey))!;
    assert.equal(after.activeEncounter, null);
    assert.ok(after.resolvedEncounterIds?.includes(ENCOUNTER_KEY));
    assert.equal((await kv.get<HollowGateCombatBinding>(hollowGateCombatBindingKey(runId)))?.status, 'won');

    assert.equal((await openDuel(runId)).status, 409, 'a settled encounter opens no second duel');
    assert.equal((await gate('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pet' })).status, 409,
        'a cleared Hound cannot be farmed');
    assert.equal((await step([HOUND.x, HOUND.y], [HOUND.x - 1, HOUND.y])).status, 200);
});

test('only the pet the player sent spends its battle consumable; the drawn partners keep theirs', async () => {
    const carrying = (owned: Record<string, unknown>) => ({ ...owned, loadout: { consumable: 'consum-second-wind' } });
    await seed([carrying(LEAD), ...PARTNERS.map(carrying)]);
    setFieldSizeRoll(() => 3);
    const { runId } = await sendPet();
    const { state, petIds } = (await openDuel(runId)).body;
    assert.equal(petIds.length, 3);
    await decide(state.sessionId, 'win');
    assert.equal((await showdown({ action: 'turn', sessionId: state.sessionId, commands: [] })).status, 200);
    const settled = await gate('combatSettle', { runId, petReceipt: state.sessionId });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    type Carried = { id: string; loadout?: { consumable?: string } };
    const pets = (await kv.get<{ character: { pets: Carried[] } }>(saveKey))!.character.pets;
    const consumableOf = (id: string) => pets.find((owned) => owned.id === id)?.loadout?.consumable;
    assert.equal(consumableOf(LEAD.id), undefined, 'the lead spends its consumable, as the 1v1 duel always did');
    for (const partner of petIds.slice(1)) {
        assert.equal(consumableOf(partner), 'consum-second-wind', `drawn partner ${partner} keeps its consumable, as on the road`);
    }
    const benched = PARTNERS.find((owned) => !petIds.includes(owned.id))!;
    assert.equal(consumableOf(benched.id), 'consum-second-wind', 'a pet that never took the field keeps its consumable');
});

test('a lost duel withdraws the encounter unpaid, and the Hound can be raised again and won once', async () => {
    const run = await seed();
    setFieldSizeRoll(() => 1);
    const { runId } = await sendPet();
    const { state } = (await openDuel(runId)).body;
    const conceded = await showdown({ action: 'forfeit', sessionId: state.sessionId });
    assert.equal(conceded.status, 200, JSON.stringify(conceded.body));
    assert.deepEqual(conceded.body.hollowGate, { runId, petReceipt: state.sessionId });

    const lost = await gate('combatSettle', { runId, petReceipt: state.sessionId });
    assert.equal(lost.status, 200, JSON.stringify(lost.body));
    assert.equal(lost.body.won, false);
    assert.equal(lost.body.petDefeat, true);
    assert.equal(await ryo(), 400, 'a pet defeat pays nothing');
    const save = (await kv.get<{ character: { hp: number; hollowGateRun: unknown } }>(saveKey))!.character;
    assert.equal(save.hp, 400, 'the seal recoils 20% of max HP');
    assert.ok(save.hollowGateRun, 'a pet defeat never ends the run');
    const withdrawn = (await kv.get<HollowGateRunToken>(runKey))!;
    assert.equal(withdrawn.activeEncounter, null);
    assert.ok(withdrawn.withdrawnEncounterIds?.includes(ENCOUNTER_KEY));
    assert.equal(withdrawn.resolvedEncounterIds?.includes(ENCOUNTER_KEY) ?? false, false);
    assert.equal((await gate('combatSettle', { runId, petReceipt: state.sessionId })).body.alreadyReported, true);
    assert.equal(await ryo(), 400);

    // The player can walk off, and stepping back on raises the Hound again.
    assert.equal((await step([HOUND.x, HOUND.y], [HOUND.x - 1, HOUND.y])).status, 200);
    assert.equal((await step([HOUND.x - 1, HOUND.y], [HOUND.x, HOUND.y])).status, 200);
    setFieldSizeRoll(() => 2);
    const again = await sendPet();
    assert.notEqual(again.runId, runId);
    const rematch = await openDuel(again.runId);
    assert.equal(rematch.status, 200, JSON.stringify(rematch.body));
    assert.notEqual(rematch.body.state.sessionId, state.sessionId);
    assert.equal(rematch.body.state.format, '2v2', 'a rematch is a fresh draw');
    await decide(rematch.body.state.sessionId, 'win');
    assert.equal((await showdown({ action: 'turn', sessionId: rematch.body.state.sessionId, commands: [] })).status, 200);
    const won = await gate('combatSettle', { runId: again.runId, petReceipt: rematch.body.state.sessionId });
    assert.equal(won.status, 200, JSON.stringify(won.body));
    assert.equal(won.body.won, true);
    const reward = Math.floor(hollowGateCombatReward(1, 'battle').ryo * rewardMultiplierForToken(run));
    assert.equal(await ryo(), 400 + reward);
});

test('a 3v3 fought out on the engine settles the result the server reached', async () => {
    const run = await seed();
    setFieldSizeRoll(() => 3);
    const { runId } = await sendPet();
    let { state } = (await openDuel(runId)).body;
    let finishing: Reply | null = null;
    for (let turn = 0; turn < 40 && !state.finished; turn += 1) {
        type Fighter = { id: string; ko: boolean; benched: boolean };
        const target = (state.enemy as Fighter[]).find((hound) => !hound.ko && !hound.benched);
        const commands = (state.player as Fighter[]).filter((mine) => !mine.ko && !mine.benched)
            .map((mine) => ({ kind: 'move', petId: mine.id, moveIndex: 0, targetId: target?.id ?? '' }));
        const round = await showdown({ action: 'turn', sessionId: state.sessionId, expectedRound: state.round, commands });
        assert.equal(round.status, 200, JSON.stringify(round.body));
        state = round.body.state;
        if (state.finished) finishing = round;
    }
    assert.equal(state.finished, true, 'the turn cap decides every duel');
    assert.deepEqual(finishing?.body.hollowGate, { runId, petReceipt: state.sessionId });
    const settled = await gate('combatSettle', { runId, petReceipt: state.sessionId });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.won, state.outcome === 'win');
    assert.equal(settled.body.petDefeat, state.outcome !== 'win');
    const reward = Math.floor(hollowGateCombatReward(1, 'battle').ryo * rewardMultiplierForToken(run));
    assert.equal(await ryo(), state.outcome === 'win' ? 400 + reward : 400);
});

test('a begun duel is never swapped for a shinobi fight; a lapsed, undecided one falls back', async () => {
    await seed();
    const { runId, binding } = await sendPet();
    const { state } = (await openDuel(runId)).body;
    const refused = await gate('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pve' });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.deepEqual(await kv.get(hollowGateCombatBindingKey(runId)), binding, 'the begun duel stays the only authority');

    // The session lease lapsed with no result: nothing can decide it now.
    await kv.del(sessionKey(state.sessionId), `sd-hg:${PLAYER}:${state.sessionId}`);
    const shinobi = await gate('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pve' });
    assert.equal(shinobi.status, 200, JSON.stringify(shinobi.body));
    assert.equal(shinobi.body.combatMode, 'solo-pve');
    assert.equal(await kv.get(hollowGateCombatBindingKey(runId)), null);
    assert.equal((await openDuel(runId)).status, 409, 'the retired duel can never reopen');
});

test('a decided duel still settles after a lost reply or a lapsed session', async () => {
    const run = await seed();
    const { runId } = await sendPet();
    const { state } = (await openDuel(runId)).body;
    // The finishing turn's reply was lost before its receipt landed. Reopening
    // the duel returns the decided state and re-seals the exact receipt.
    await decide(state.sessionId, 'win');
    const reopened = await openDuel(runId);
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body.state.finished, true);
    assert.equal(reopened.body.state.outcome, 'win');
    assert.equal((await kv.get<Record<string, unknown>>(`hg-pet-result:${PLAYER}:${state.sessionId}`))?.outcome, 'win');

    // The session then lapses before the Gate is asked. The receipt still names
    // the result, so the browser is told to settle rather than fight again.
    await kv.del(sessionKey(state.sessionId), `sd-hg:${PLAYER}:${state.sessionId}`);
    const decided = await openDuel(runId);
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.deepEqual(decided.body.decided, { petReceipt: state.sessionId, outcome: 'win' });
    assert.equal((await kv.keys(`pet:showdown:${PLAYER}:*`)).length, 0, 'a decided duel is never re-fought');
    assert.equal((await gate('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pve' })).status, 409,
        'a decided duel cannot be swapped for a shinobi fight either');
    const settled = await gate('combatSettle', { runId, petReceipt: state.sessionId });
    assert.equal(settled.status, 200, JSON.stringify(settled.body));
    assert.equal(settled.body.won, true);
    assert.equal(await ryo(), 400 + Math.floor(hollowGateCombatReward(1, 'battle').ryo * rewardMultiplierForToken(run)));
});

test('the duel takes only its run selector, and the arena door stays shut to the Gate', async () => {
    await seed();
    const { runId } = await sendPet();
    for (const steer of [{ format: '1v1' }, { petIds: [LEAD.id] }, { tier: 'scrapper' }, { rewardEligible: true }]) {
        const steered = await showdown({ action: 'hollow-gate', hollowGate: { token: TOKEN, runId }, ...steer });
        assert.equal(steered.status, 400, JSON.stringify(steer));
    }
    assert.equal((await showdown({ action: 'hollow-gate', hollowGate: { token: 'someoneelsestoken', runId } })).status, 409);
    assert.equal((await showdown({ action: 'hollow-gate', hollowGate: { runId } })).status, 400);
    const arena = await showdown({ action: 'arena', format: '1v1', petIds: [LEAD.id], hollowGate: { token: TOKEN, runId, houndId: 'hollow-hound-encounter-0000000001' } });
    assert.equal(arena.status, 409);
    assert.deepEqual(await kv.keys(`pet:showdown:${PLAYER}:*`), [], 'no refused request opened a duel');
});

test('an active pet that cannot fight, or a pre-cutover cinematic proof, is refused with the encounter untouched', async () => {
    await seed([{ ...LEAD, training: { endsAt: Date.now() + 60_000 } }, ...PARTNERS]);
    const busy = await sendPet();
    assert.equal((await openDuel(busy.runId)).status, 409);
    assert.deepEqual(await kv.get(hollowGateCombatBindingKey(busy.runId)), busy.binding);

    // With the lead ready again, a binding sealed before the Showdown cutover is
    // still refused: its cinematic proof is not this engine's to open.
    const bindingKey = hollowGateCombatBindingKey(busy.runId);
    const cinematic = { ...busy.binding, petAuthority: { ...busy.binding.petAuthority!, engine: 'cinematic' as const } };
    await kv.set(bindingKey, cinematic);
    const saved = (await kv.get<{ _saveVersion: number; character: Record<string, unknown> }>(saveKey))!;
    await kv.set(saveKey, { ...saved, character: { ...saved.character, pets: [LEAD, ...PARTNERS] } });
    assert.equal((await openDuel(busy.runId)).status, 409);
    assert.deepEqual(await kv.get(bindingKey), cinematic);
    assert.deepEqual(await kv.keys(`pet:showdown:${PLAYER}:*`), []);
    // Both refusals leave the shinobi fallback open.
    assert.equal((await gate('combatStart', { floor: 1, kind: 'battle', nodeId: HOUND.node, mode: 'pve' })).status, 200);
});

test('Emergency Forfeit retires a live duel together with its run', async () => {
    await seed();
    const { runId } = await sendPet();
    const { state } = (await openDuel(runId)).body;
    const forfeited = await gate('runSettle', { action: 'abandon' });
    assert.equal(forfeited.status, 200, JSON.stringify(forfeited.body));
    assert.equal(await kv.get(hollowGateCombatBindingKey(runId)), null);
    assert.equal(await readSession(state.sessionId), null, 'the child duel goes with its parent');
    assert.equal(await kv.get(`sd-hg:${PLAYER}:${state.sessionId}`), null);
    assert.equal((await showdown({ action: 'turn', sessionId: state.sessionId, commands: [] })).status, 404);
});

import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'crossing-war-test-secret-32-bytes!!';

import { INVENTORY_CAP } from '../_inventory-capacity.js';
import { coastSite } from '../../shared/coast-world.js';
import { coastAdmissionOf, coastEntryRefusal } from '../_coast-admission.js';
import { eligibleAchievementIds } from '../achievements/_catalog.js';
import { countOwned } from '../craft/_forge.js';
import { applyWorldAiDurableProgression, buildWorldAiFightSpec, cleanWorldAiFightRequest } from '../missions/_world-ai-fight.js';
import { questSiteRefusal } from './_sites.js';
import { coastCastPortrait } from '../../shared/coast-cast.js';
import { QUEST_LINE_CATALOGUE, QUEST_LINES } from './_catalog.js';
import { parseQuestLines } from './_record.js';
import { questStageFightId } from './_types.js';

/*
 * The Crossing War II and III, played through the real route against the
 * SHIPPED catalogue: a player who finished Bitter Tide takes the next quest at
 * its level, works its sites, makes its tool, breaks the Hold, is paid once,
 * and walks into the region it opens.
 *
 * Gathering itself is proven in _sites.test.ts and the Hold in _fight.test.ts.
 * Here the materials are put in the backpack as a finished harvest would leave
 * them, and the fight is won through the same settlement the report route runs.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

const PREFIX = 'crosswar';
let kv: typeof import('../_storage.js').kv;
let issuePlayerToken: typeof import('../_auth.js').issuePlayerToken;
let onlineStore: typeof import('../_realtime/online-store.js').onlineStore;
let lines: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken } = await import('../_auth.js'));
    ({ onlineStore } = await import('../_realtime/online-store.js'));
    lines = (await import('./lines.js')).default as unknown as Handler;
});

beforeEach(async () => {
    for (const pattern of [`save:${PREFIX}*`, `ratelimit:*${PREFIX}*`, 'lock:*', `ledger:currency:${PREFIX}*`]) {
        const keys = await kv.keys(pattern);
        if (keys.length) await kv.del(...keys);
    }
});

after(() => {
    delete process.env.SESSION_SECRET;
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

let ip = 0;
async function call(player: string, body: Json) {
    const out: { status: number; body: Json } = { status: 200, body: {} };
    const res = { setHeader: () => res, status(code: number) { out.status = code; return res; }, json(value: Json) { out.body = value; return res; }, end: () => res };
    await lines({
        method: 'POST', body: { playerName: player, ...body },
        headers: { 'content-type': 'application/json', 'x-player-token': issuePlayerToken(player) ?? '' },
        socket: { remoteAddress: `127.8.${Math.floor(++ip / 250)}.${ip % 250}` },
    } as never, res as never);
    return out;
}

/** What a claim leaves behind for each finished quest (api/quests/_engine.ts claimQuestLine). */
const DONE = {
    'shuttered-boat': { at: 1, marks: 1, opensRegion: 1, unlocks: ['boat'] },
    'first-footing': { at: 2, marks: 1 },
    'crossing-war-1': { at: 3, marks: 2, opensRegion: 2, unlocks: ['contest-land'] },
    'crossing-war-2': { at: 4, marks: 2, opensRegion: 3 },
    'crossing-war-3': { at: 5, marks: 3, opensRegion: 4 },
    'boatwright-tools-1': { at: 6, marks: 1 },
    'boatwright-tools-2': { at: 7, marks: 2 },
    'uncounted-1': { at: 8, marks: 2, unlocks: ['second-dock'] },
    'uncounted-2': { at: 9, marks: 3 },
    'untamed-coast-1': { at: 10, marks: 1 },
    'untamed-coast-2': { at: 11, marks: 2 },
    'crossing-war-4': { at: 12, marks: 3, opensRegion: 5 },
    'boatwright-tools-3': { at: 13, marks: 3 },
    'crossing-war-5': { at: 14, marks: 4, unlocks: ['last-garrison'] },
};
type DoneId = keyof typeof DONE;

async function seed(player: string, level: number, done: DoneId[], sector = 113) {
    await kv.set(`save:${player}`, {
        _saveVersion: 1, currentSector: sector,
        questLines: { v: 1, active: {}, done: Object.fromEntries(done.map(id => [id, DONE[id]])) },
        character: { name: player, village: 'Stormveil Village', level, ryo: 1_000, fateShards: 0, boneCharms: 0, auraStones: 0, inventory: [], itemStacks: [] },
    });
}
const stored = async (player: string) => (await kv.get<Json>(`save:${player}`))!;
const character = async (player: string) => (await stored(player)).character as Json;

/** Stand at a coast site's entrance. Presence only changes sector by a travel lease, so each move is a fresh session. */
function standAt(player: string, siteId: string) {
    const site = coastSite(siteId)!;
    onlineStore.remove(player);
    onlineStore.upsert({ name: player, sector: site.sector, tile: site.approach, character: null });
}
function standIn(player: string, sector: number) {
    onlineStore.remove(player);
    onlineStore.upsert({ name: player, sector, tile: 60, character: null });
}
/** Put gathered materials in the backpack, as successful attempts at the site leave them. */
async function gathered(player: string, itemId: string, count: number) {
    const save = await stored(player);
    const char = save.character as Json;
    const stacks = (char.itemStacks as Array<{ itemId: string; count: number }>).filter(stack => stack.itemId !== itemId);
    await kv.set(`save:${player}`, { ...save, character: { ...char, itemStacks: [...stacks, { itemId, count }] } });
}
/** Win the fight the quest is on, through the settlement the fight report runs, and store what it wrote. */
async function winFight(player: string, questId: string, sector: number) {
    const save: Json = { ...(await stored(player)), currentSector: sector };
    const request = cleanWorldAiFightRequest({ kind: 'quest-line', sourceId: questId, sector })!;
    const spec = await buildWorldAiFightSpec({ playerName: player, request, save });
    // Every quest fight built on the real path carries what the fight screen draws the foe from: the boss's
    // forms when it has them, and its cut-out portrait when it has one. Neither comes from the client.
    const stage = QUEST_LINE_CATALOGUE.lines[questId].stages[parseQuestLines(save.questLines).active[questId].stage];
    if (stage.kind === 'boss' || stage.kind === 'drop') {
        const fight = QUEST_LINE_CATALOGUE.fights[questStageFightId(stage, parseQuestLines(save.questLines).active[questId].choices)];
        const profile = spec.profile as Json;
        assert.equal(profile.bossTransformation, fight.forms, `${questId}: the fight carries ${fight.forms ? 'its forms' : 'no forms'}`);
        assert.equal(profile.avatarImage, coastCastPortrait(fight.castId), `${questId}: the fight shows ${fight.castId}`);
        if (fight.hold && stage.kind === 'boss' && Object.hasOwn(QUEST_LINES, questId)) assert.ok(fight.forms, `${questId}: a quest's own boss takes a form`);
    }
    const won = applyWorldAiDurableProgression(save, save.character as Json, spec.context, 'win', Date.now());
    await kv.set(`save:${player}`, { ...save, ...(won.recordPatch ?? {}), character: won.character, _saveVersion: Number(save._saveVersion) + 1 });
    return spec;
}
const advance = (player: string, questId: string) => call(player, { action: 'advance', questId });
const lineOf = async (player: string, questId: string) =>
    (((await call(player, { action: 'list' })).body.lines as Json[]).find(line => line.id === questId))!;

describe('The Crossing War II: Mirror Hold', () => {
    const QUEST = 'crossing-war-2';
    const INK = 'quest-clouding-ink';

    it('is offered at the Reed Relay to a level 80 player who finished Bitter Tide, and to no one sooner', async () => {
        const early = `${PREFIX}early`, unready = `${PREFIX}unready`, ready = `${PREFIX}ready`;
        await seed(early, 79, ['shuttered-boat', 'first-footing', 'crossing-war-1']);
        await seed(unready, 80, ['shuttered-boat', 'first-footing']);
        await seed(ready, 80, ['shuttered-boat', 'first-footing', 'crossing-war-1']);

        assert.deepEqual([(await lineOf(early, QUEST)).state, (await lineOf(early, QUEST)).reason, (await lineOf(early, QUEST)).needLevel], ['locked', 'level', 80]);
        assert.equal((await call(early, { action: 'accept', questId: QUEST })).body.reason, 'level');
        assert.equal((await lineOf(unready, QUEST)).state, 'locked', 'Bitter Tide comes first');
        assert.equal((await call(unready, { action: 'accept', questId: QUEST })).body.ok, false);

        const offered = await lineOf(ready, QUEST);
        assert.deepEqual([offered.state, offered.title, offered.giverName], ['open', 'The Crossing War: Mirror Hold', 'Hagino']);
        assert.equal((offered.offerAt as Json).sector, 113, 'the keeper of the Reed Relay offers it');
        assert.equal((await lineOf(ready, 'crossing-war-3')).state, 'locked', 'and the quest after it waits its turn');
    });

    it('is played from the Relay House to a broken Mirror Hold, paid once, and opens Briarwood Deep', async () => {
        const player = `${PREFIX}mirror`;
        await seed(player, 80, ['shuttered-boat', 'first-footing', 'crossing-war-1']);
        assert.equal(coastEntryRefusal(coastAdmissionOf(await stored(player)), 121)?.reason, 'region', 'Briarwood is shut before the quest');
        assert.equal(coastEntryRefusal(coastAdmissionOf(await stored(player)), 114), null, 'Brackwater is open');

        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);
        assert.match(String(questSiteRefusal(await stored(player), 'brackwater-harvest-112')), /nothing here you have a use for yet/, 'a site is shut until its stage');

        // Hear the keeper, then read the Tide-cut Steps. Both are decided by where the server holds the player.
        standAt(player, 'brackwater-landing-111');
        assert.equal((await advance(player, QUEST)).body.reason, 'wrong-place');
        standAt(player, 'brackwater-counter-113');
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        standAt(player, 'brackwater-landing-111');
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // Inkseed, then Mirror Silt: each site opens with its stage.
        assert.equal(questSiteRefusal(await stored(player), 'brackwater-harvest-112'), null);
        assert.notEqual(questSiteRefusal(await stored(player), 'brackwater-outcrop-114'), null, 'the pool waits for the next stage');
        assert.deepEqual([(await advance(player, QUEST)).body.reason, (await advance(player, QUEST)).body.target], ['incomplete', 8]);
        await gathered(player, 'quest-inkseed', 8);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        assert.equal(questSiteRefusal(await stored(player), 'brackwater-outcrop-114'), null);
        await gathered(player, 'quest-mirror-silt', 4);
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // The ink is ground at the Relay House and nowhere else.
        assert.equal((await advance(player, QUEST)).body.reason, 'make');
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.reason, 'wrong-place');
        standAt(player, 'brackwater-counter-113');
        const made = await call(player, { action: 'make', questId: QUEST });
        assert.equal(made.body.advanced, true, JSON.stringify(made.body));
        assert.deepEqual([countOwned(await character(player), INK), countOwned(await character(player), 'quest-inkseed'), countOwned(await character(player), 'quest-mirror-silt')], [3, 2, 2]);
        assert.equal((await call(player, { action: 'abandon', questId: QUEST })).body.reason, 'committed');

        standAt(player, 'brackwater-tracks-119');
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // The plan fails at the cache: the couriers were watching it. A plain fight, with no Hold, that cannot be
        // walked past and spends none of the ink. Its words are what the player sees, not a rule of the game.
        const caught = await lineOf(player, QUEST);
        assert.deepEqual([((caught.stage as Json).fight as Json).name, ((caught.stage as Json).fight as Json).sector, ((caught.stage as Json).fight as Json).hold], ['Unmoored Courier', 119, undefined]);
        assert.match(((caught.talk as Json[])[1]).text as string, /waiting to see who came to look at it/);
        assert.equal((await advance(player, QUEST)).body.reason, 'fight');
        const ambush = await winFight(player, QUEST, 119);
        assert.deepEqual([ambush.context.displayName, ambush.context.questHold], ['Unmoored Courier', undefined]);
        assert.equal(countOwned(await character(player), INK), 3, 'the couriers cost no ink');

        // The adept. She cannot be claimed past, fought elsewhere, or fought without the ink.
        assert.match(((await lineOf(player, QUEST)).talk as Json[])[0].text as string, /My couriers didn’t come back up/);
        assert.equal((await advance(player, QUEST)).body.reason, 'fight');
        assert.equal((await call(player, { action: 'claim', questId: QUEST })).body.reason, 'not-final');
        const spec = await winFight(player, QUEST, 114);
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Minawa', { breakerItemId: INK, name: 'Mirror Hold', charges: 3 }, 83]);

        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        // weight 14 at level 80 on the Quest Book curve.
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.boneCharms, paid.body.title, paid.body.marks, paid.body.opensRegion], [14 * (40 + 80 * 5), 25, 1, 'Unmirrored', 6, 3]);
        const after = await character(player);
        assert.deepEqual([after.ryo, after.boneCharms, after.serverTitles], [1_000 + 14 * (40 + 80 * 5), 1, ['Unmirrored']]);
        assert.deepEqual([countOwned(after, INK), countOwned(after, 'quest-inkseed'), countOwned(after, 'quest-mirror-silt')], [0, 0, 0], 'what the quest lent goes back');

        const again = await call(player, { action: 'claim', questId: QUEST });
        assert.deepEqual([again.body.replayed, (await character(player)).ryo, (await character(player)).boneCharms], [true, after.ryo, 1], 'a second claim pays nothing more');
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.reason, 'done');

        // Briarwood Deep is open, Whitecrown is not, and the next quest is offered at the Hollow Sentinel.
        const admission = coastAdmissionOf(await stored(player));
        assert.deepEqual([admission.region, coastEntryRefusal(admission, 121), coastEntryRefusal(admission, 130), coastEntryRefusal(admission, 131)?.reason], [3, null, null, 'region']);
        const next = await lineOf(player, 'crossing-war-3');
        assert.deepEqual([next.state, next.reason, next.needLevel], ['locked', 'level', 85], 'the next quest waits for level 85');
    });

    it('refuses the adept without Clouding Ink, and anywhere but Glasswake Shelf', async () => {
        const player = `${PREFIX}noink`;
        await seed(player, 80, ['shuttered-boat', 'first-footing', 'crossing-war-1']);
        const base = await stored(player);
        const save: Json = { ...base, currentSector: 114, questLines: { v: 1, done: (base.questLines as Json).done, active: { [QUEST]: { stage: 7, at: 9_000, took: true } } } };
        const request = (sector: number) => cleanWorldAiFightRequest({ kind: 'quest-line', sourceId: QUEST, sector })!;
        await assert.rejects(buildWorldAiFightSpec({ playerName: player, request: request(114), save }), /You need a Clouding Ink to break the Mirror Hold\. Make one first\./);
        const armed = { ...save, character: { ...(save.character as Json), itemStacks: [{ itemId: INK, count: 1 }] } };
        await assert.rejects(buildWorldAiFightSpec({ playerName: player, request: request(113), save: { ...armed, currentSector: 113 } }), /not here/);
        assert.equal((await buildWorldAiFightSpec({ playerName: player, request: request(114), save: armed })).context.questHold?.charges, 1);
    });
});

describe('The Crossing War III: Beast Bond', () => {
    const QUEST = 'crossing-war-3';
    const SNARE = 'quest-pact-cutter-snare';

    it('is played from the Hollow Sentinel to a broken Beast Bond, and opens Whitecrown Passes', async () => {
        const player = `${PREFIX}bond`;
        await seed(player, 85, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2'], 120);
        const offered = await lineOf(player, QUEST);
        assert.deepEqual([offered.state, offered.title, offered.giverName, (offered.offerAt as Json).sector], ['open', 'The Crossing War: Beast Bond', 'Kusabi', 120]);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        // The Hollow Sentinel: standing at the door is not enough. Three clues, one on each floor, found in order.
        const examine = (clueKey: string) => call(player, { action: 'examine', questId: QUEST, clueKey });
        standAt(player, 'brackwater-tree-120');
        assert.equal((await advance(player, QUEST)).body.reason, 'clues', 'the entrance alone does not pass the step');
        const listed = (await lineOf(player, QUEST)).stage as Json;
        assert.deepEqual((listed.clues as Json[]).map(clue => [clue.key, clue.floor, clue.found]), [['ward', 0, false], ['clappers', 1, false], ['crown', 2, false]]);
        assert.equal((await examine('crown')).body.reason, 'clue-order', 'the crown is fitted only with both halves');
        standIn(player, 119);
        assert.equal((await examine('ward')).body.reason, 'wrong-place', 'a clue is examined at the building');
        standAt(player, 'brackwater-tree-120');
        const ward = await examine('ward');
        assert.deepEqual([ward.body.ok, ward.body.advanced, ward.body.found, ward.body.of], [true, false, 1, 3]);
        assert.match(JSON.stringify(ward.body.talk), /Three notches/);
        // Examining it again reads it again and writes nothing.
        const versionBefore = (await stored(player))._saveVersion;
        const again = await examine('ward');
        assert.deepEqual([again.body.ok, again.body.again, (await stored(player))._saveVersion], [true, true, versionBefore]);
        // The player can leave between clues: what was found is on the save, not in the room.
        standIn(player, 119);
        standAt(player, 'brackwater-tree-120');
        assert.deepEqual(((await lineOf(player, QUEST)).stage as Json).clues && (((await lineOf(player, QUEST)).stage as Json).clues as Json[]).map(clue => clue.found), [true, false, false]);
        assert.match(JSON.stringify((await examine('clappers')).body.talk), /answers hollow/);
        const crown = await examine('crown');
        assert.deepEqual([crown.body.ok, crown.body.advanced], [true, true], 'the last clue passes the step');
        assert.match(JSON.stringify(crown.body.talk), /lets the ring go/);
        const collar = await lineOf(player, QUEST);
        assert.match(JSON.stringify(collar.talk), /You saw which strand moved/, 'Kusabi answers what the crown showed');
        assert.equal((await examine('crown')).body.reason, 'no-clue', 'a passed step has nothing left to examine');
        standAt(player, 'briarwood-outcrop-128');
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        assert.equal(questSiteRefusal(await stored(player), 'briarwood-harvest-125'), null);
        await gathered(player, 'quest-binding-thorn', 8);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        assert.equal(questSiteRefusal(await stored(player), 'briarwood-outcrop-128'), null);
        await gathered(player, 'quest-tether-link', 4);
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // The Leash Garrison pays the cedar off: the return strand in the hall, then the whole knot on the hoist.
        standAt(player, 'briarwood-fort-126');
        assert.equal((await advance(player, QUEST)).body.reason, 'clues');
        assert.equal((await examine('hoist')).body.reason, 'clue-order', 'the hoist makes sense only after the hall');
        assert.match(JSON.stringify((await examine('block')).body.talk), /return strand/);
        const hoist = await examine('hoist');
        assert.deepEqual([hoist.body.ok, hoist.body.advanced], [true, true]);
        assert.match(JSON.stringify(hoist.body.talk), /back through the first turn/, 'the knot is read on the hoist');

        // The knot is asked for outside. The step that asks does not show it again, a wrong knot sends the player
        // back up to the hoist, and nothing can be tied until it is right.
        const asked = await lineOf(player, QUEST);
        assert.deepEqual([(asked.stage as Json).kind, ((asked.stage as Json).choice as Json).prompt], ['choice', 'How was the braid on the hoist tied?']);
        assert.doesNotMatch(JSON.stringify(asked.talk), /back through the first turn/);
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.ok, false, 'no snare before the knot is known');
        const slipped = await call(player, { action: 'choose', questId: QUEST, optionKey: 'twice' });
        assert.deepEqual([slipped.body.ok, slipped.body.reason], [false, 'wrong-answer']);
        assert.match(String(slipped.body.error), /Go back up to the hoist and look again/);
        const back = await lineOf(player, QUEST);
        assert.deepEqual([(back.stage as Json).kind, ((back.stage as Json).place as Json).sector], ['enter', 126], 'sent back into the garrison');
        assert.deepEqual(((back.stage as Json).clues as Json[]).map(clue => [clue.key, clue.found]), [['block', true], ['hoist', false]], 'only the hoist is to be looked at again');
        assert.deepEqual((((await stored(player)).questLines as Json).active as Json)[QUEST] && ((((await stored(player)).questLines as Json).active as Json)[QUEST] as Json).found, ['ward', 'clappers', 'crown', 'block'], 'the cedar stays found');
        assert.equal((await advance(player, QUEST)).body.reason, 'clues', 'and the door alone still does not pass it');
        assert.equal((await examine('hoist')).body.advanced, true);
        assert.equal((await call(player, { action: 'choose', questId: QUEST, optionKey: 'through' })).body.ok, true);
        // The snare is tied on the old tether post.
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.reason, 'wrong-place');
        standAt(player, 'briarwood-outcrop-128');
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.advanced, true);
        assert.equal(countOwned(await character(player), SNARE), 3);

        standIn(player, 126);
        assert.equal((await advance(player, QUEST)).body.reason, 'wrong-place', 'the beast is shadowed to Stillfang Mere');
        standIn(player, 127);
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        const spec = await winFight(player, QUEST, 126);
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Tazuna', { breakerItemId: SNARE, name: 'Beast Bond', charges: 3 }, 88]);

        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.fateShards, paid.body.auraStones, paid.body.title, paid.body.marks, paid.body.opensRegion],
            [16 * (40 + 85 * 5), 30, 1, 1, 'Bondcutter', 9, 4]);
        assert.equal(countOwned(await character(player), SNARE), 0);
        assert.equal((await call(player, { action: 'claim', questId: QUEST })).body.replayed, true);

        const admission = coastAdmissionOf(await stored(player));
        assert.deepEqual([admission.region, coastEntryRefusal(admission, 131), coastEntryRefusal(admission, 140), coastEntryRefusal(admission, 141)?.reason], [4, null, null, 'region']);
    });

    it('carries on from where a save made before the clues stood: no step moves, and only what is ahead needs finding', async () => {
        // Saves from before the clues have no `found`. Their step numbers did not move: each keeps its step.
        const past = `${PREFIX}pastcedar`;
        await seed(past, 85, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2'], 128);
        const record = (stage: number) => ({ v: 1, active: { [QUEST]: { stage, at: 5 } }, done: Object.fromEntries((['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2'] as DoneId[]).map(id => [id, DONE[id]])) });
        await kv.set(`save:${past}`, { ...(await stored(past)), questLines: record(1) });
        const collar = await lineOf(past, QUEST);
        assert.deepEqual([(collar.stage as Json).index, (collar.stage as Json).kind, (collar.stage as Json).clues], [1, 'enter', undefined], 'a player past the cedar is at the collar, as before');
        standAt(past, 'briarwood-outcrop-128');
        assert.equal((await advance(past, QUEST)).body.advanced, true);
        // A save at the garrison step finds the garrison's two clues and nothing from the cedar.
        const atYard = `${PREFIX}atyard`;
        await seed(atYard, 85, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2'], 126);
        await kv.set(`save:${atYard}`, { ...(await stored(atYard)), questLines: record(4) });
        standAt(atYard, 'briarwood-fort-126');
        assert.equal((await advance(atYard, QUEST)).body.reason, 'clues');
        assert.equal((await call(atYard, { action: 'examine', questId: QUEST, clueKey: 'block' })).body.ok, true);
        assert.equal((await call(atYard, { action: 'examine', questId: QUEST, clueKey: 'hoist' })).body.advanced, true);
        // A save already at the knot is asked the knot, as before.
        const atKnot = `${PREFIX}atknot`;
        await seed(atKnot, 85, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2'], 126);
        await kv.set(`save:${atKnot}`, { ...(await stored(atKnot)), questLines: record(5) });
        assert.equal(((await lineOf(atKnot, QUEST)).stage as Json).kind, 'choice');
        assert.equal((await call(atKnot, { action: 'choose', questId: QUEST, optionKey: 'through' })).body.ok, true);
    });

    it('is not offered before Mirror Hold is finished, whatever the level', async () => {
        const player = `${PREFIX}skip`;
        await seed(player, 96, ['shuttered-boat', 'first-footing', 'crossing-war-1']);
        assert.equal((await lineOf(player, QUEST)).state, 'locked');
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, false);
    });
});

describe('The Boatwright’s Tools', () => {
    const SLIP = 'saltstair-dock-101';
    /** Pass a gather stage as a finished run of attempts would. */
    async function gather(player: string, questId: string, itemId: string, count: number) {
        await gathered(player, itemId, count);
        assert.equal((await advance(player, questId)).body.advanced, true, `${questId}: ${itemId}`);
    }

    it('I: the bench is rigged again, the wrecker falls to a remade vial, and two sites are kept', async () => {
        const QUEST = 'boatwright-tools-1', player = `${PREFIX}bench`;
        await seed(player, 75, ['shuttered-boat', 'first-footing'], 101);
        const offered = await lineOf(player, QUEST);
        assert.deepEqual([offered.state, offered.title, offered.giverName, (offered.offerAt as Json).sector], ['open', 'The Boatwright’s Tools I', 'Urabe', 101]);
        assert.notEqual(questSiteRefusal(await stored(player), 'saltstair-harvest-102'), null, 'Wrack Strand is shut between quests');
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        standAt(player, SLIP);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        await gather(player, QUEST, 'quest-wrack-cord', 8);
        await gather(player, QUEST, 'quest-splitstone-fittings', 6);
        // Both hand-ins are made at the slip, and what is handed in is gone.
        standAt(player, 'saltstair-counter-105');
        assert.equal((await advance(player, QUEST)).body.reason, 'wrong-place');
        standAt(player, SLIP);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        assert.deepEqual([countOwned(await character(player), 'quest-wrack-cord'), countOwned(await character(player), 'quest-splitstone-fittings')], [0, 2], 'two fittings are kept for the vial');

        await gather(player, QUEST, 'quest-woundroot', 6);
        standAt(player, 'saltstair-counter-105');
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.advanced, true);
        assert.equal(countOwned(await character(player), 'quest-woundroot-vial'), 3);

        const spec = await winFight(player, QUEST, 104);
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Sabiro', { breakerItemId: 'quest-woundroot-vial', name: 'Bitter Tide', charges: 3 }, 77]);

        // More cord cut before the claim is the player's own: its site is a kept one.
        await gathered(player, 'quest-wrack-cord', 3);
        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.marks, paid.body.opensRegion], [8 * (40 + 75 * 5), 10, 3, null]);
        const after = await character(player);
        assert.deepEqual([countOwned(after, 'quest-woundroot-vial'), countOwned(after, 'quest-wrack-cord')], [0, 3], 'the vials go back, the cord stays');
        assert.equal((await call(player, { action: 'claim', questId: QUEST })).body.replayed, true);

        const done = await stored(player);
        assert.deepEqual([questSiteRefusal(done, 'saltstair-harvest-102'), questSiteRefusal(done, 'saltstair-mine-103')], [null, null], 'both sites are open for good');
        assert.notEqual(questSiteRefusal(done, 'saltstair-harvest-106'), null, 'Woundroot Bank is not a kept site');
    });

    it('II: pitch and eel reach the slip, the drift burner falls to remade ink, and the coast gains a fishing site', async () => {
        const QUEST = 'boatwright-tools-2', player = `${PREFIX}pitch`;
        await seed(`${PREFIX}nobench`, 80, ['shuttered-boat', 'first-footing', 'crossing-war-1'], 101);
        assert.equal((await lineOf(`${PREFIX}nobench`, QUEST)).state, 'locked', 'the first of the series comes first');
        await seed(player, 80, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'boatwright-tools-1'], 101);
        assert.deepEqual([(await lineOf(player, QUEST)).state, (await lineOf(player, QUEST)).title], ['open', 'The Boatwright’s Tools II']);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        standAt(player, SLIP);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        await gather(player, QUEST, 'quest-pitchwood', 6);
        assert.equal(questSiteRefusal(await stored(player), 'brackwater-fish-117'), null, 'the Sounding Pool opens with its stage');
        await gather(player, QUEST, 'quest-caulk-eel', 4);
        standAt(player, SLIP);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        await gather(player, QUEST, 'quest-inkseed', 6);
        await gather(player, QUEST, 'quest-mirror-silt', 2);
        standAt(player, 'brackwater-counter-113');
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.advanced, true);

        const spec = await winFight(player, QUEST, 115);
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Yaniko', { breakerItemId: 'quest-clouding-ink', name: 'Mirror Hold', charges: 3 }, 82]);
        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.boneCharms, paid.body.marks], [12 * (40 + 80 * 5), 15, 1, 7]);
        assert.equal(countOwned(await character(player), 'quest-clouding-ink'), 0);

        const done = await stored(player);
        assert.deepEqual([questSiteRefusal(done, 'brackwater-harvest-115'), questSiteRefusal(done, 'brackwater-fish-117')], [null, null]);
        assert.notEqual(questSiteRefusal(done, 'brackwater-harvest-112'), null, 'the Inkseed Bed shuts again');
    });

    it('III: the keel timber is cut, hauled and won, for the last three of the series’ six marks', async () => {
        const QUEST = 'boatwright-tools-3', player = `${PREFIX}keel`;
        await seed(player, 85, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2', 'boatwright-tools-1', 'boatwright-tools-2'], 101);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        standAt(player, SLIP);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        await gather(player, QUEST, 'quest-keelroot', 8);
        standIn(player, 129);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        await gather(player, QUEST, 'quest-binding-thorn', 6);
        await gather(player, QUEST, 'quest-tether-link', 2);
        standAt(player, 'briarwood-outcrop-128');
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.advanced, true);
        standAt(player, SLIP);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        assert.equal(countOwned(await character(player), 'quest-keelroot'), 0);

        const spec = await winFight(player, QUEST, 123);
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Hazeru', { breakerItemId: 'quest-pact-cutter-snare', name: 'Beast Bond', charges: 3 }, 87]);
        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.fateShards, paid.body.title, paid.body.marks], [16 * (40 + 85 * 5), 25, 1, 'Keelwright', 12]);
        assert.equal(questSiteRefusal(await stored(player), 'briarwood-harvest-123'), null, 'Keelroot Fall is kept');
    });
});

describe('The Uncounted', () => {
    const QUAY = 'brackwater-dock-116', SEAL = 'quest-garrison-seal', ORDER = 'quest-stand-down-order';
    const choose = (player: string, questId: string, optionKey: string) => call(player, { action: 'choose', questId, optionKey });

    it('I: papers are forged under a lifted seal, the quay warden stands down, and the second dock opens', async () => {
        const QUEST = 'uncounted-1', player = `${PREFIX}quay`;
        await seed(player, 80, ['shuttered-boat', 'first-footing', 'crossing-war-1'], 116);
        const offered = await lineOf(player, QUEST);
        assert.deepEqual([offered.state, offered.title, offered.giverName, (offered.offerAt as Json).sector], ['open', 'The Uncounted I', 'Ukishi', 116]);
        assert.equal(coastAdmissionOf(await stored(player)).secondDock, false);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        standAt(player, QUAY);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        standAt(player, 'brackwater-counter-118');
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // Whose papers: the choice cannot be walked past, and only an offered answer is taken.
        assert.equal((await advance(player, QUEST)).body.reason, 'choose');
        assert.equal((await choose(player, QUEST, 'the-commander')).body.ok, false);
        assert.equal((await choose(player, QUEST, 'quay-master')).body.ok, true);

        // The couriers carry the seal; with no Hold, they are an ordinary fight.
        assert.equal((await advance(player, QUEST)).body.reason, 'fight');
        const couriers = await winFight(player, QUEST, 119);
        assert.deepEqual([couriers.context.displayName, couriers.context.questHold], ['Unmoored Courier', undefined]);
        assert.equal(countOwned(await character(player), SEAL), 1);

        await gathered(player, 'quest-inkseed', 4);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        standAt(player, 'brackwater-counter-113');
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.advanced, true);
        assert.deepEqual([countOwned(await character(player), ORDER), countOwned(await character(player), SEAL), countOwned(await character(player), 'quest-inkseed')], [2, 0, 0]);

        const spec = await winFight(player, QUEST, 116);
        // The quay master's pass was chosen: the watch looks twice, so the warden
        // is fought on his guard, three levels over the player and not two.
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Moyai', { breakerItemId: ORDER, name: 'Oath Guard', charges: 2 }, 83]);

        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        // weight 12 at level 80, and a quarter more for the slower papers.
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.fateShards, paid.body.marks, paid.body.unlocks], [Math.round(12 * (40 + 80 * 5) * 1.25), 15, 1, 6, ['second-dock']]);
        assert.equal(countOwned(await character(player), ORDER), 0, 'the forged order goes back');
        assert.equal((await call(player, { action: 'claim', questId: QUEST })).body.replayed, true);
        assert.equal(coastAdmissionOf(await stored(player)).secondDock, true, 'the boat can put in at the Low Water Quay');
    });

    it('II: a name is written into the witness register, and the roll keeper stands down', async () => {
        const QUEST = 'uncounted-2', player = `${PREFIX}roll`;
        await seed(`${PREFIX}noquay`, 86, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2'], 116);
        assert.equal((await lineOf(`${PREFIX}noquay`, QUEST)).state, 'locked', 'the first of the series comes first');
        await seed(player, 85, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2', 'uncounted-1'], 116);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        for (const site of [QUAY, 'briarwood-counter-122', 'briarwood-counter-124']) {
            standAt(player, site);
            assert.equal((await advance(player, QUEST)).body.advanced, true, site);
        }
        assert.equal((await choose(player, QUEST, 'witness')).body.ok, true);
        standIn(player, 129);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        await winFight(player, QUEST, 129);
        assert.equal(countOwned(await character(player), SEAL), 1);
        await gathered(player, 'quest-binding-thorn', 4);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        standAt(player, 'briarwood-counter-122');
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.advanced, true);

        const spec = await winFight(player, QUEST, 124);
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Kazoe', { breakerItemId: ORDER, name: 'Oath Guard', charges: 2 }, 87]);
        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.boneCharms, paid.body.marks], [16 * (40 + 85 * 5), 25, 1, 11]);
        assert.deepEqual((await character(player)).questStandings, ['uncounted-dead-witness'], 'the choice is remembered');
    });

    it('III: the uncounted are led over the pass, for the last of the series’ eight marks', async () => {
        const QUEST = 'uncounted-3', player = `${PREFIX}pass`;
        await seed(player, 90, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2', 'crossing-war-3', 'uncounted-1', 'uncounted-2'], 116);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        for (const site of [QUAY, 'whitecrown-tracks-132', 'whitecrown-counter-134']) {
            standAt(player, site);
            assert.equal((await advance(player, QUEST)).body.advanced, true, site);
        }
        // The half tally was described at the cleft, two steps ago. The journal now
        // shows the dockets and the question, and not what the half looked like.
        const asked = await lineOf(player, QUEST);
        assert.deepEqual([(asked.stage as Json).kind, ((asked.stage as Json).choice as Json).prompt], ['choice', 'Three dockets, each pinned to half a tally. Which one is yours?']);
        assert.doesNotMatch(JSON.stringify(asked.talk), /slant/, 'the clue is not repeated beside the question');
        // A wrong match is answered in the world and sends the player back to the cleft to look again.
        const wrong = (await choose(player, QUEST, 'third')).body;
        assert.deepEqual([wrong.ok, wrong.reason, /Go back to the cleft/.test(String(wrong.error))], [false, 'wrong-answer', true]);
        const back = await lineOf(player, QUEST);
        assert.deepEqual([(back.stage as Json).index, /three notches cut close together and one corner sliced off at a slant/.test(JSON.stringify(back.talk))], [1, true]);
        for (const site of ['whitecrown-tracks-132', 'whitecrown-counter-134']) {
            standAt(player, site);
            assert.equal((await advance(player, QUEST)).body.advanced, true, site);
        }
        assert.equal((await choose(player, QUEST, 'second')).body.advanced, true);
        assert.equal((await choose(player, QUEST, 'salt')).body.ok, true);
        await winFight(player, QUEST, 132);
        await gathered(player, 'quest-frost-splinter', 3);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        standAt(player, 'whitecrown-counter-134');
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.advanced, true);
        standAt(player, 'whitecrown-tracks-140');
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        const spec = await winFight(player, QUEST, 140);
        // A salt carrier's pass is searched at every gate: the toll captain is fought on his guard.
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Sekimori', { breakerItemId: ORDER, name: 'Oath Guard', charges: 2 }, 93]);
        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.fateShards, paid.body.title, paid.body.marks], [Math.round(18 * (40 + 90 * 5) * 1.25), 30, 1, 'Passwright', 17]);
    });
});

describe('Untamed Coast', () => {
    const TRACE = 'saltstair-tracks-109', LURE = 'quest-scent-lure';
    async function gather(player: string, questId: string, itemId: string, count: number) {
        await gathered(player, itemId, count);
        assert.equal((await advance(player, questId)).body.advanced, true, `${questId}: ${itemId}`);
    }
    const make = (player: string, questId: string) => call(player, { action: 'make', questId });

    it('I: a lure is made from Needle Shoal, set at the High Sill, and the hound falls to a Signal Shard', async () => {
        const QUEST = 'untamed-coast-1', player = `${PREFIX}hound`;
        await seed(player, 75, ['shuttered-boat', 'first-footing'], 109);
        const offered = await lineOf(player, QUEST);
        assert.deepEqual([offered.state, offered.title, offered.giverName, (offered.offerAt as Json).sector], ['open', 'Untamed Coast I', 'Ashigara', 109]);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        standAt(player, TRACE);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        assert.equal(questSiteRefusal(await stored(player), 'saltstair-fish-104'), null, 'Needle Shoal opens with its stage');
        await gather(player, QUEST, 'quest-needle-fish', 4);
        // The lure is worked at the Hound Trace and set at the High Sill.
        const lures = await make(player, QUEST);
        assert.equal(lures.body.advanced, true, JSON.stringify(lures.body));
        assert.deepEqual([countOwned(await character(player), LURE), countOwned(await character(player), 'quest-needle-fish')], [2, 0]);
        assert.equal((await advance(player, QUEST)).body.reason, 'wrong-place');
        standAt(player, 'saltstair-outcrop-110');
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        assert.equal(countOwned(await character(player), LURE), 0, 'a set lure is spent');
        assert.equal((await lineOf(player, QUEST)).remake, undefined, 'and is not offered to be made again');

        await gather(player, QUEST, 'quest-wrack-cord', 2);
        await gather(player, QUEST, 'quest-splitstone-fittings', 2);
        standAt(player, 'saltstair-counter-105');
        assert.equal((await make(player, QUEST)).body.advanced, true);
        assert.equal(countOwned(await character(player), 'quest-signal-shard'), 3);

        // A player who lost every shard is offered this quest's own shard recipe, not the lure or the first quest's.
        const save = await stored(player);
        const spent: Json = { ...save, currentSector: 110, character: { ...(save.character as Json), itemStacks: [] } };
        await kv.set(`save:${player}`, spent);
        const remake = (await lineOf(player, QUEST)).remake as Json;
        assert.deepEqual([(remake.output as Json).itemId, (remake.inputs as Json[]).map(input => input.itemId)], ['quest-signal-shard', ['quest-splitstone-fittings', 'quest-wrack-cord']]);
        await assert.rejects(buildWorldAiFightSpec({ playerName: player, request: cleanWorldAiFightRequest({ kind: 'quest-line', sourceId: QUEST, sector: 110 })!, save: spent }),
            /You need a Stormglass Signal Shard to break the Smoke Hold\. Make one first\./);
        await kv.set(`save:${player}`, save);

        const spec = await winFight(player, QUEST, 110);
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Old Brinejaw', { breakerItemId: 'quest-signal-shard', name: 'Smoke Hold', charges: 3 }, 77]);
        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.title, paid.body.marks], [8 * (40 + 75 * 5), 10, 'Houndcaller', 3]);
        assert.equal(countOwned(await character(player), 'quest-signal-shard'), 0);
        assert.equal((await call(player, { action: 'claim', questId: QUEST })).body.replayed, true);
    });

    it('II: Thornmother is drawn to the Scent Stone and her pack bond is cut', async () => {
        const QUEST = 'untamed-coast-2', player = `${PREFIX}pack`;
        await seed(player, 85, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2', 'untamed-coast-1'], 109);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        standAt(player, TRACE);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        standAt(player, 'briarwood-tracks-121');
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        await gather(player, QUEST, 'quest-scent-carp', 4);
        assert.equal((await make(player, QUEST)).body.advanced, true);
        standAt(player, 'briarwood-tracks-130');
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        await gather(player, QUEST, 'quest-binding-thorn', 6);
        await gather(player, QUEST, 'quest-tether-link', 2);
        standAt(player, 'briarwood-outcrop-128');
        assert.equal((await make(player, QUEST)).body.advanced, true);

        const spec = await winFight(player, QUEST, 130);
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Thornmother', { breakerItemId: 'quest-pact-cutter-snare', name: 'Beast Bond', charges: 3 }, 87]);
        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.boneCharms, paid.body.title, paid.body.marks], [14 * (40 + 85 * 5), 20, 1, 'Briarwood Stalker', 9]);
    });

    it('III: Whitemane comes to the Wind Collar and its Rime Lock is split, for the last of the series’ five marks', async () => {
        const QUEST = 'untamed-coast-3', player = `${PREFIX}fox`;
        await seed(`${PREFIX}nohound`, 92, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2', 'crossing-war-3'], 109);
        assert.equal((await lineOf(`${PREFIX}nohound`, QUEST)).state, 'locked', 'the series is taken in order');
        await seed(player, 90, ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2', 'crossing-war-3', 'untamed-coast-1', 'untamed-coast-2'], 109);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        standAt(player, TRACE);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        standAt(player, 'whitecrown-tracks-131');
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        await gather(player, QUEST, 'quest-icebell-smelt', 4);
        assert.equal((await make(player, QUEST)).body.advanced, true);
        standAt(player, 'whitecrown-tracks-137');
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        await gather(player, QUEST, 'quest-emberglass', 6);
        await gather(player, QUEST, 'quest-frost-splinter', 3);
        standAt(player, 'whitecrown-counter-136');
        assert.equal((await make(player, QUEST)).body.advanced, true);

        const spec = await winFight(player, QUEST, 137);
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Whitemane', { breakerItemId: 'quest-ember-senbon', name: 'Rime Lock', charges: 3 }, 92]);
        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.fateShards, paid.body.title, paid.body.marks], [16 * (40 + 90 * 5), 25, 1, 'Whitecrown Tracker', 14]);
    });
});

describe('The Crossing War V and The Unmoored: Holds in sequence', () => {
    const VIAL = 'quest-woundroot-vial', INK = 'quest-clouding-ink';
    const ORDER = 'quest-stand-down-order', SNARE = 'quest-pact-cutter-snare', SENBON = 'quest-ember-senbon';
    const WORKSHOP = 'hushcrown-counter-144';
    /** The main line through Rime Lock and The Boatwright's Tools: 18 marks. */
    const EIGHTEEN: DoneId[] = ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2', 'crossing-war-3', 'crossing-war-4', 'boatwright-tools-1', 'boatwright-tools-2', 'boatwright-tools-3'];
    const make = (player: string, questId: string) => call(player, { action: 'make', questId });
    async function gather(player: string, questId: string, itemId: string, count: number) {
        await gathered(player, itemId, count);
        assert.equal((await advance(player, questId)).body.advanced, true, `${questId}: ${itemId}`);
    }
    const without = async (player: string, itemId: string): Promise<Json> => {
        const save = await stored(player);
        const char = save.character as Json;
        return { ...save, character: { ...char, itemStacks: (char.itemStacks as Array<{ itemId: string }>).filter(stack => stack.itemId !== itemId) } };
    };

    it('The Crossing War V needs 16 marks, remakes two tools, and breaks the Twin Ward in order', async () => {
        const QUEST = 'crossing-war-5', player = `${PREFIX}twin`;
        await seed(`${PREFIX}fewmarks`, 96, EIGHTEEN.slice(0, 6), 105);
        const short = await lineOf(`${PREFIX}fewmarks`, QUEST);
        assert.deepEqual([short.state, short.reason], ['locked', 'marks'], 'the main line alone is twelve marks, and that is not enough: the side series must be walked');
        await seed(`${PREFIX}young`, 94, [...EIGHTEEN, 'uncounted-1'], 105);
        assert.equal((await lineOf(`${PREFIX}young`, QUEST)).reason, 'level');

        await seed(player, 95, [...EIGHTEEN, 'uncounted-1'], 105);
        const offered = await lineOf(player, QUEST);
        assert.deepEqual([offered.state, offered.title, offered.giverName, (offered.offerAt as Json).sector], ['open', 'The Crossing War: Twin Ward', 'Orito', 105]);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        // The offer is heard in the keeper's own words before the quest is taken.
        assert.deepEqual((offered.talk as Json[]).map(say => say.speaker), ['Orito', 'Orito']);
        for (const site of ['saltstair-counter-105', 'hushcrown-tracks-147', 'hushcrown-fort-148']) {
            standAt(player, site);
            assert.equal((await advance(player, QUEST)).body.advanced, true, site);
        }
        // Which ward rises first is read off the post. Naming the wrong disk sends the player back to it.
        const answer = (optionKey: string) => call(player, { action: 'choose', questId: QUEST, optionKey });
        assert.deepEqual([(await answer('bright')).body.reason, ((await lineOf(player, QUEST)).stage as Json).index], ['wrong-answer', 2]);
        standAt(player, 'hushcrown-fort-148');
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        assert.match(JSON.stringify((await lineOf(player, QUEST)).talk), /One is dark and one is bright/);
        assert.equal((await answer('dark')).body.advanced, true);
        await gather(player, QUEST, 'quest-windroot', 6);
        await gather(player, QUEST, 'quest-silver-grit', 4);
        await gather(player, QUEST, 'quest-ink-loach', 4);
        standAt(player, WORKSHOP);
        assert.equal((await make(player, QUEST)).body.advanced, true);
        assert.equal((await make(player, QUEST)).body.advanced, true);
        const held = await character(player);
        assert.deepEqual([countOwned(held, VIAL), countOwned(held, INK), countOwned(held, 'quest-windroot'), countOwned(held, 'quest-silver-grit'), countOwned(held, 'quest-ink-loach')], [3, 3, 0, 0, 0]);
        standAt(player, 'hushcrown-shrine-141');
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // The journal names both Holds and what breaks each.
        const stage = (await lineOf(player, QUEST)).stage as Json;
        const fight = stage.fight as Json;
        assert.deepEqual([(fight.hold as Json).name, (fight.hold as Json).toolItemId, (fight.thenHolds as Json[]).map(hold => [hold.name, hold.toolItemId, hold.have])],
            ['Bitter Tide', VIAL, [['Mirror Hold', INK, 3]]]);

        // Every tool of the chain must be in hand, and the one that ran out is the one offered again.
        const request = cleanWorldAiFightRequest({ kind: 'quest-line', sourceId: QUEST, sector: 148 })!;
        const noInk = { ...(await without(player, INK)), currentSector: 148 };
        await assert.rejects(buildWorldAiFightSpec({ playerName: player, request, save: noInk }), /You need a Clouding Ink to break the Mirror Hold\. Make one first\./);
        const noVial = { ...(await without(player, VIAL)), currentSector: 148 };
        await assert.rejects(buildWorldAiFightSpec({ playerName: player, request, save: noVial }), /You need a Woundroot Vial to break the Bitter Tide\. Make one first\./);
        const whole = await stored(player);
        await kv.set(`save:${player}`, await without(player, VIAL));
        assert.deepEqual([((await lineOf(player, QUEST)).remake as Json).stageKey, (((await lineOf(player, QUEST)).remake as Json).output as Json).itemId], ['vial', VIAL]);
        await kv.set(`save:${player}`, whole);
        assert.equal((await lineOf(player, QUEST)).remake, undefined);

        const spec = await winFight(player, QUEST, 148);
        assert.deepEqual([spec.context.displayName, spec.profile.level], ['Futae', 98]);
        assert.deepEqual(spec.context.questHold, { breakerItemId: VIAL, name: 'Bitter Tide', charges: 3, next: [{ breakerItemId: INK, name: 'Mirror Hold', charges: 3 }] });

        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.fateShards, paid.body.boneCharms, paid.body.title, paid.body.marks, paid.body.unlocks],
            [22 * (40 + 95 * 5), 55, 1, 1, 'Twofold', 24, ['last-garrison']]);
        assert.deepEqual([countOwned(await character(player), VIAL), countOwned(await character(player), INK)], [0, 0]);
        assert.equal((await call(player, { action: 'claim', questId: QUEST })).body.replayed, true);
        // That unlock is what opens the last Garrison's sector.
        assert.equal(coastEntryRefusal(coastAdmissionOf(await stored(player)), 150), null, 'The Last Crown is open now');
    });

    it('The Unmoored needs 22 marks, makes three tools, and breaks three Holds in order', async () => {
        const QUEST = 'the-unmoored', player = `${PREFIX}crown`;
        const TWENTY_SEVEN: DoneId[] = [...EIGHTEEN, 'uncounted-1', 'crossing-war-5', 'uncounted-2'];
        // One short: the main line through Twin Ward, two of the Boatwright's quests and one of The Uncounted is 21.
        await seed(`${PREFIX}almost`, 100, [...EIGHTEEN.slice(0, 8), 'crossing-war-5', 'uncounted-1'], 105);
        assert.deepEqual([(await lineOf(`${PREFIX}almost`, QUEST)).state, (await lineOf(`${PREFIX}almost`, QUEST)).reason], ['locked', 'marks']);

        await seed(player, 98, [...TWENTY_SEVEN, 'untamed-coast-1'], 105);
        const offered = await lineOf(player, QUEST);
        assert.deepEqual([offered.state, offered.title], ['open', 'The Unmoored']);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        standAt(player, 'saltstair-counter-105');
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        standAt(player, 'hushcrown-tracks-149');
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        const guards = await winFight(player, QUEST, 149);
        assert.deepEqual([guards.context.displayName, guards.context.questHold], ['Hushcrown Guard', undefined]);
        await gather(player, QUEST, 'quest-windroot', 12);
        await gather(player, QUEST, 'quest-silver-grit', 6);
        standAt(player, WORKSHOP);
        for (const tool of [ORDER, SNARE, SENBON]) assert.equal((await make(player, QUEST)).body.advanced, true, tool);
        const held = await character(player);
        assert.deepEqual([countOwned(held, ORDER), countOwned(held, SNARE), countOwned(held, SENBON), countOwned(held, 'quest-windroot'), countOwned(held, 'quest-silver-grit'), countOwned(held, 'quest-garrison-seal')], [2, 3, 3, 0, 0, 0]);

        assert.equal((await advance(player, QUEST)).body.reason, 'choose');
        assert.equal((await call(player, { action: 'choose', questId: QUEST, optionKey: 'closed' })).body.ok, true);
        standAt(player, 'hushcrown-fort-150');
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // Losing the last tool of the chain stops the fight, and names that tool.
        const request = cleanWorldAiFightRequest({ kind: 'quest-line', sourceId: QUEST, sector: 150 })!;
        await assert.rejects(buildWorldAiFightSpec({ playerName: player, request, save: { ...(await without(player, SENBON)), currentSector: 150 } }),
            /You need an? Ember Senbon to break the Rime Lock\. Make one first\./);

        const spec = await winFight(player, QUEST, 150);
        assert.deepEqual([spec.context.displayName, spec.profile.level], ['Nanashi', 100]);
        assert.deepEqual(spec.context.questHold, { breakerItemId: ORDER, name: 'Oath Guard', charges: 2, next: [
            { breakerItemId: SNARE, name: 'Beast Bond', charges: 3 }, { breakerItemId: SENBON, name: 'Rime Lock', charges: 3 },
        ] });

        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.fateShards, paid.body.boneCharms, paid.body.auraStones, paid.body.title, paid.body.marks],
            [30 * (40 + 98 * 5), 80, 1, 2, 2, 'Crownbreaker', 33]);
        const after = await character(player);
        assert.deepEqual(after.questStandings, ['coast-kept-closed'], 'what was asked of her is remembered');
        // She was asked to keep the coast closed, so her mantle is the relic given. The bracer never is.
        assert.deepEqual([paid.body.items, after.inventory, (await lineOf(player, QUEST)).rewardArtKeys], [['coast-quiet-crown-mantle'], ['coast-quiet-crown-mantle'], ['coast-finale-v1', 'gear-mantle']]);
        assert.deepEqual([countOwned(after, ORDER), countOwned(after, SNARE), countOwned(after, SENBON)], [0, 0, 0]);
        assert.equal((await call(player, { action: 'claim', questId: QUEST })).body.replayed, true);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.reason, 'done');
    });
});

describe('Raise the Clan Gate', () => {
    const HOUR = 60 * 60_000;
    const CLAN = 'Tidewatch';
    const PLOT = 'saltstair-plot-108', RECORD = 'saltstair-counter-105';
    const BASE: DoneId[] = ['shuttered-boat', 'first-footing', 'crossing-war-1'];
    let clanKey: string, clanSlug: string, landingKey: string;
    let foundedAt = 1_700_000_000_000;

    before(async () => {
        const utils = await import('../_utils.js');
        clanKey = utils.clanRecordKey(CLAN);
        clanSlug = utils.clanBareSlug(CLAN);
        landingKey = (await import('../coast/_landing-store.js')).coastLandingKey(clanSlug);
    });
    beforeEach(async () => {
        for (const key of [...await kv.keys('coast:*'), clanKey]) await kv.del(key);
        foundedAt = 1_700_000_000_000;
    });

    /** A clan on the server's own rows: the record, its members, and each member's save naming it. */
    async function clanOf(members: Array<{ name: string; joinedHoursAgo: number }>) {
        await kv.set(clanKey, { name: CLAN, founderName: members[0].name, createdAt: foundedAt, members: members.map(member => ({ name: member.name, joinedAt: Date.now() - member.joinedHoursAgo * HOUR })) });
        for (const member of members) {
            const save = await stored(member.name);
            await kv.set(`save:${member.name}`, { ...save, character: { ...(save.character as Json), clan: CLAN } });
        }
    }
    const generation = async () => (await kv.get<{ generation: string }>(`coast:clan:${clanSlug}`))!.generation;
    /** The clan's Landing, as founding and raising it leave the row. */
    async function landing(tier: number, status: 'active' | 'dormant' | 'destroyed' = 'active') {
        await kv.set(landingKey, { clan: CLAN, clanSlug, generation: await generation(), sector: 108, landingEpoch: 1, status, tier, stores: {}, foundedAt: Date.now(), foundedBy: 'someone', upkeepWeek: 0, dormantWeeks: 0, contributions: {} });
    }
    async function gather(player: string, questId: string, itemId: string, count: number) {
        await gathered(player, itemId, count);
        assert.equal((await advance(player, questId)).body.advanced, true, `${questId}: ${itemId}`);
    }
    const make = (player: string, questId: string) => call(player, { action: 'make', questId });

    it('is a clan quest: hidden from a player with no clan, and taken with the clan the server names', async () => {
        const loner = `${PREFIX}loner`, member = `${PREFIX}member`;
        await seed(loner, 80, BASE, 105);
        assert.deepEqual([(await lineOf(loner, 'clan-gate-1')).state, (await lineOf(loner, 'clan-gate-1')).reason], ['locked', 'clan']);
        assert.equal((await call(loner, { action: 'accept', questId: 'clan-gate-1' })).body.reason, 'clan');
        // A clan name written into the save is not a clan: the clan's own list must agree.
        const save = await stored(loner);
        await kv.set(`save:${loner}`, { ...save, character: { ...(save.character as Json), clan: CLAN } });
        assert.equal((await call(loner, { action: 'accept', questId: 'clan-gate-1' })).body.reason, 'clan');

        await seed(member, 77, BASE, 105);
        await clanOf([{ name: member, joinedHoursAgo: 72 }]);
        const offered = await lineOf(member, 'clan-gate-1');
        assert.deepEqual([offered.state, offered.title, offered.giverName], ['open', 'Raise the Clan Gate I', 'Orito']);
        assert.equal((await call(member, { action: 'accept', questId: 'clan-gate-1' })).body.ok, true);
        const active = ((await stored(member)).questLines as { active: Record<string, { clanGeneration?: string }> }).active['clan-gate-1'];
        assert.equal(active.clanGeneration, await generation(), 'the quest remembers which clan it was taken with');
    });

    it('I: waits for the clan to stake a Landing, then the founding ground is held against the reeve', async () => {
        const QUEST = 'clan-gate-1', player = `${PREFIX}stake`;
        await seed(player, 77, BASE, 105);
        await clanOf([{ name: player, joinedHoursAgo: 72 }]);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);
        standAt(player, RECORD);
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // The Landing is read from its own row: none, fallen, then standing.
        standAt(player, PLOT);
        const none = await advance(player, QUEST);
        assert.deepEqual([none.body.reason, none.body.error], ['landing', 'Your clan has not staked a Landing yet.']);
        await landing(0, 'destroyed');
        assert.equal((await advance(player, QUEST)).body.error, 'Your clan has not staked a Landing yet.', 'a fallen Landing is no Landing');
        await landing(0);
        standAt(player, RECORD);
        assert.equal((await advance(player, QUEST)).body.reason, 'wrong-place', 'and it is witnessed on the founding ground');
        standAt(player, PLOT);
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        await gather(player, QUEST, 'quest-wrack-cord', 4);
        const surveyors = await winFight(player, QUEST, 108);
        assert.deepEqual([surveyors.context.displayName, surveyors.context.questHold], ['Unmoored Patrol', undefined]);
        standAt(player, RECORD);
        assert.equal((await make(player, QUEST)).body.advanced, true);
        const spec = await winFight(player, QUEST, 108);
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Kuiuchi', { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard', charges: 2 }, 79]);

        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.marks], [8 * (40 + 77 * 5), 10, 5]);
        assert.equal((await call(player, { action: 'claim', questId: QUEST })).body.replayed, true);
    });

    it('pauses while the player is new to the clan, out of it, or in another clan of the same name', async () => {
        const QUEST = 'clan-gate-1', player = `${PREFIX}pause`;
        await seed(player, 77, BASE, 105);
        await clanOf([{ name: player, joinedHoursAgo: 1 }]);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true, 'a new member may take it');
        standAt(player, RECORD);
        const fresh = await advance(player, QUEST);
        assert.deepEqual([fresh.body.reason, fresh.body.error], ['clan-tenure', 'You must be in your clan for two days before its quests move.']);

        await clanOf([{ name: player, joinedHoursAgo: 49 }]);
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // Out of the clan: the quest stands where it stood, and nothing about it moves.
        const save = await stored(player);
        await kv.set(`save:${player}`, { ...save, character: { ...(save.character as Json), clan: '' } });
        await landing(0);
        standAt(player, PLOT);
        const left = await advance(player, QUEST);
        assert.deepEqual([left.body.reason, left.body.error], ['clan-left', 'This quest waits for the clan you took it with.']);
        assert.equal(((await stored(player)).questLines as { active: Record<string, { stage: number }> }).active[QUEST].stage, 1, 'nothing is lost while it waits');

        // Back in the clan it was taken with, it moves again.
        await clanOf([{ name: player, joinedHoursAgo: 72 }]);
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // A fight is held to the same standing.
        await gather(player, QUEST, 'quest-wrack-cord', 4);
        const away = await stored(player);
        const request = cleanWorldAiFightRequest({ kind: 'quest-line', sourceId: QUEST, sector: 108 })!;
        await kv.set(`save:${player}`, { ...away, character: { ...(away.character as Json), clan: '' } });
        await assert.rejects(buildWorldAiFightSpec({ playerName: player, request, save: { ...away, currentSector: 108 } }), /This quest waits for the clan you took it with\./);
        await kv.set(`save:${player}`, away);
        assert.equal((await buildWorldAiFightSpec({ playerName: player, request, save: { ...away, currentSector: 108 } })).context.displayName, 'Unmoored Patrol');

        // A full backpack does not stop a drop fight: quest items stack, and stacks take no slot.
        const full = { ...away, currentSector: 108, character: { ...(away.character as Json), inventory: Array.from({ length: INVENTORY_CAP }, () => 'junk'), itemStacks: [] } };
        assert.equal((await buildWorldAiFightSpec({ playerName: player, request, save: full })).context.displayName, 'Unmoored Patrol');

        // Once it has taken items it cannot be dropped, while its clan still stands.
        const lines = away.questLines as { active: Record<string, Json> };
        await kv.set(`save:${player}`, { ...away, questLines: { ...lines, active: { ...lines.active, [QUEST]: { ...lines.active[QUEST], took: true } } } });
        assert.equal((await call(player, { action: 'abandon', questId: QUEST })).body.reason, 'committed');

        // The same name founded again is another clan: the quest taken with the old one stays where it is.
        foundedAt += 1;
        await clanOf([{ name: player, joinedHoursAgo: 72 }]);
        await assert.rejects(buildWorldAiFightSpec({ playerName: player, request, save: { ...away, currentSector: 108 } }), /This quest waits for the clan you took it with\./);
        assert.equal((await call(player, { action: 'claim', questId: QUEST })).body.reason, 'clan-left');
        assert.equal(((await stored(player)).questLines as { active: Record<string, { stage: number }> }).active[QUEST].stage, 3);

        // That clan is gone for good, so the quest could never be finished. It may be dropped
        // even though it has taken items, or it would hold one of the three quest slots for ever.
        const dropped = await call(player, { action: 'abandon', questId: QUEST });
        assert.deepEqual([dropped.body.ok, dropped.body.cleared], [true, true]);
        assert.ok(!((await stored(player)).questLines as { active: Record<string, unknown> }).active[QUEST], 'the slot is free again');
        assert.equal(countOwned((await stored(player)).character as Json, 'quest-wrack-cord'), 4, 'a kept material stays the player\'s own');
    });

    it('II and III: the Landing must stand at its tier, and the gate is held against a chain of two Holds', async () => {
        const player = `${PREFIX}gate`;
        await seed(player, 80, BASE, 105);
        await kv.set(`save:${player}`, { ...(await stored(player)), questLines: { v: 1, active: {}, done: { ...Object.fromEntries(BASE.map(id => [id, DONE[id]])), 'clan-gate-1': { at: 20, marks: 1 } } } });
        await clanOf([{ name: player, joinedHoursAgo: 72 }]);

        // II: a Landing Hall.
        assert.equal((await call(player, { action: 'accept', questId: 'clan-gate-2' })).body.ok, true);
        standAt(player, RECORD);
        assert.equal((await advance(player, 'clan-gate-2')).body.advanced, true);
        standAt(player, PLOT);
        await landing(1);
        assert.equal((await advance(player, 'clan-gate-2')).body.error, 'Your clan’s Landing must be raised to a Landing Hall.');
        await landing(2, 'dormant');
        assert.equal((await advance(player, 'clan-gate-2')).body.error, 'Your clan’s Landing is dormant. Fill its stores first.');
        await landing(2);
        assert.equal((await advance(player, 'clan-gate-2')).body.advanced, true);
        await gather(player, 'clan-gate-2', 'quest-woundroot', 6);
        await gather(player, 'clan-gate-2', 'quest-splitstone-fittings', 2);
        standAt(player, RECORD);
        assert.equal((await make(player, 'clan-gate-2')).body.advanced, true);
        const burner = await winFight(player, 'clan-gate-2', 108);
        assert.deepEqual([burner.context.displayName, burner.context.questHold?.name], ['Tsuketa', 'Bitter Tide']);
        const second = await call(player, { action: 'claim', questId: 'clan-gate-2' });
        assert.deepEqual([second.body.ok, second.body.statPoints, second.body.boneCharms, second.body.marks], [true, 15, 1, 7]);

        // III: a Defended Landing, and the raid.
        assert.equal((await call(player, { action: 'accept', questId: 'clan-gate-3' })).body.ok, true);
        standAt(player, RECORD);
        assert.equal((await advance(player, 'clan-gate-3')).body.advanced, true);
        standAt(player, PLOT);
        assert.equal((await advance(player, 'clan-gate-3')).body.error, 'Your clan’s Landing must be raised to a Defended Landing.');
        await landing(3);
        assert.equal((await advance(player, 'clan-gate-3')).body.advanced, true);
        await winFight(player, 'clan-gate-3', 108);
        await gather(player, 'clan-gate-3', 'quest-wrack-cord', 4);
        standAt(player, RECORD);
        assert.equal((await make(player, 'clan-gate-3')).body.advanced, true);
        await gather(player, 'clan-gate-3', 'quest-woundroot', 6);
        await gather(player, 'clan-gate-3', 'quest-splitstone-fittings', 2);
        assert.equal((await make(player, 'clan-gate-3')).body.advanced, true);
        const captain = await winFight(player, 'clan-gate-3', 108);
        assert.deepEqual([captain.context.displayName, captain.profile.level], ['Semeguchi', 83]);
        assert.deepEqual(captain.context.questHold, { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard', charges: 2, next: [{ breakerItemId: 'quest-woundroot-vial', name: 'Bitter Tide', charges: 3 }] });
        const third = await call(player, { action: 'claim', questId: 'clan-gate-3' });
        assert.equal(third.body.ok, true, JSON.stringify(third.body));
        assert.deepEqual([third.body.ryo, third.body.statPoints, third.body.fateShards, third.body.title, third.body.marks], [16 * (40 + 80 * 5), 25, 1, 'Landing Warden', 10]);
    });
});

describe('The Crossing War IV: Rime Lock', () => {
    const QUEST = 'crossing-war-4';
    const SENBON = 'quest-ember-senbon';
    const WAR_SO_FAR: DoneId[] = ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2', 'crossing-war-3'];

    it('waits for level 90 and for Beast Bond', async () => {
        const early = `${PREFIX}rimeearly`, unready = `${PREFIX}rimeunready`;
        await seed(early, 89, WAR_SO_FAR, 136);
        await seed(unready, 92, WAR_SO_FAR.slice(0, 4), 136);
        assert.deepEqual([(await lineOf(early, QUEST)).state, (await lineOf(early, QUEST)).reason, (await lineOf(early, QUEST)).needLevel], ['locked', 'level', 90]);
        assert.equal((await lineOf(unready, QUEST)).state, 'locked');
        assert.equal((await call(unready, { action: 'accept', questId: QUEST })).body.ok, false);
    });

    it('is played from the Assay House to a broken Rime Lock, paid once, and opens Hushcrown Heights', async () => {
        const player = `${PREFIX}rime`;
        await seed(player, 90, WAR_SO_FAR, 136);
        assert.equal(coastEntryRefusal(coastAdmissionOf(await stored(player)), 141)?.reason, 'region', 'Hushcrown is shut before the quest');
        const offered = await lineOf(player, QUEST);
        assert.deepEqual([offered.state, offered.title, offered.giverName, (offered.offerAt as Json).sector], ['open', 'The Crossing War: Rime Lock', 'Haizumi', 136]);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        standAt(player, 'whitecrown-counter-136');
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        standAt(player, 'whitecrown-fort-138');
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        assert.equal(questSiteRefusal(await stored(player), 'whitecrown-outcrop-133'), null);
        assert.notEqual(questSiteRefusal(await stored(player), 'whitecrown-outcrop-139'), null, 'the Frost Witness waits for its stage');
        await gathered(player, 'quest-emberglass', 8);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        assert.equal(questSiteRefusal(await stored(player), 'whitecrown-outcrop-139'), null);
        await gathered(player, 'quest-frost-splinter', 6);
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // The senbon are tipped at the Assay House and nowhere else.
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.reason, 'wrong-place');
        standAt(player, 'whitecrown-counter-136');
        assert.equal((await call(player, { action: 'make', questId: QUEST })).body.advanced, true);
        assert.deepEqual([countOwned(await character(player), SENBON), countOwned(await character(player), 'quest-emberglass'), countOwned(await character(player), 'quest-frost-splinter')], [3, 2, 3]);

        standIn(player, 137);
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // On the saddle the watch has left a boy at the cairn. What to do about him is the player's to decide, the
        // quest does not move until they do, and the warden answers for it at the gate.
        assert.equal((await advance(player, QUEST)).body.reason, 'choose');
        assert.match(JSON.stringify((await lineOf(player, QUEST)).talk), /He is a boy, fourteen at most/);
        assert.equal((await call(player, { action: 'choose', questId: QUEST, optionKey: 'warm' })).body.ok, true);

        standAt(player, 'whitecrown-counter-136');
        assert.equal((await advance(player, QUEST)).body.reason, 'wrong-place', 'the last step is back at the gate');
        standAt(player, 'whitecrown-fort-138');
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        assert.equal((await advance(player, QUEST)).body.reason, 'fight');
        const atGate = ((await lineOf(player, QUEST)).talk as Json[]).map(say => say.text as string);
        assert.match(atGate[0], /came down an hour ago with warm hands/);
        assert.equal(atGate.some(text => /found the boy in the hollow, late/.test(text)), false, 'he speaks of what was done, not of what was not');
        const spec = await winFight(player, QUEST, 138);
        assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Kogarashi', { breakerItemId: SENBON, name: 'Rime Lock', charges: 3 }, 93]);

        const paid = await call(player, { action: 'claim', questId: QUEST });
        assert.equal(paid.body.ok, true, JSON.stringify(paid.body));
        assert.deepEqual([paid.body.ryo, paid.body.statPoints, paid.body.fateShards, paid.body.boneCharms, paid.body.title, paid.body.marks, paid.body.opensRegion],
            [18 * (40 + 90 * 5), 40, 1, 1, 'Rimesplitter', 12, 5]);
        const after = await character(player);
        assert.deepEqual([countOwned(after, SENBON), countOwned(after, 'quest-emberglass'), countOwned(after, 'quest-frost-splinter')], [0, 0, 0], 'what the quest lent goes back');
        const again = await call(player, { action: 'claim', questId: QUEST });
        assert.deepEqual([again.body.replayed, (await character(player)).ryo], [true, after.ryo], 'a second claim pays nothing more');
        // The decision is on the record now, and the keeper of the next quest has read it.
        assert.deepEqual(after.questStandings, ['rime-sentry-warmed']);
        const told = ((await call(player, { action: 'recall', questId: QUEST })).body.talk as Json[]).map(say => say.text as string);
        assert.ok(told.includes('You chose: Stop and lay him a fire in the hollow.'));
        assert.ok(told.some(text => /written down that he lived/.test(text)));

        const admission = coastAdmissionOf(await stored(player));
        assert.deepEqual([admission.region, coastEntryRefusal(admission, 141), coastEntryRefusal(admission, 149)], [5, null, null], 'every region of the coast is open');
        assert.equal(coastEntryRefusal(admission, 150)?.reason, 'sealed', 'but The Last Crown waits for The Crossing War V');
    });

    it('refuses the warden without an Ember Senbon', async () => {
        const player = `${PREFIX}nosenbon`;
        await seed(player, 92, WAR_SO_FAR, 138);
        const base = await stored(player);
        const save: Json = { ...base, currentSector: 138, questLines: { v: 1, done: (base.questLines as Json).done, active: { [QUEST]: { stage: 8, at: 9_000, took: true } } } };
        const request = cleanWorldAiFightRequest({ kind: 'quest-line', sourceId: QUEST, sector: 138 })!;
        await assert.rejects(buildWorldAiFightSpec({ playerName: player, request, save }), /You need an? Ember Senbon to break the Rime Lock\. Make one first\./);
    });
});

describe('Side tales', () => {
    const choose = (player: string, questId: string, optionKey: string) => call(player, { action: 'choose', questId, optionKey });

    it('The Unsent Letter: a keeper’s story, a sealed choice that is remembered, and ryo', async () => {
        const QUEST = 'tale-unsent-letter', player = `${PREFIX}tale-letter`;
        await seed(`${PREFIX}tale-early`, 80, ['shuttered-boat'], 105);
        assert.deepEqual([(await lineOf(`${PREFIX}tale-early`, QUEST)).state, (await lineOf(`${PREFIX}tale-early`, QUEST)).reason], ['locked', 'quests'], 'not before First Footing');

        await seed(player, 80, ['shuttered-boat', 'first-footing'], 105);
        const offered = await lineOf(player, QUEST);
        assert.deepEqual([offered.state, offered.title, offered.giverName, offered.marks, (offered.offerAt as Json).name], ['open', 'The Unsent Letter', 'Orito', 0, 'Record House']);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);

        standAt(player, 'saltstair-counter-105');
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        standIn(player, 104);
        assert.equal((await advance(player, QUEST)).body.advanced, true);
        standAt(player, 'saltstair-tracks-109');
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // The choice: what the journal is sent, and that it is sealed once made.
        const step = (await lineOf(player, QUEST)).stage as Json;
        assert.deepEqual([step.kind, ((step.choice as Json).options as Json[]).map(option => option.key)], ['choice', ['carry', 'keep']]);
        assert.equal((await advance(player, QUEST)).body.reason, 'choose');
        assert.equal((await choose(player, QUEST, 'burn')).body.reason, 'bad-option');
        assert.equal((await choose(player, QUEST, 'carry')).body.ok, true);
        assert.equal((await choose(player, QUEST, 'keep')).body.reason, 'no-choice', 'a choice is made once');

        standAt(player, 'saltstair-counter-105');
        assert.equal((await advance(player, QUEST)).body.readyToClaim, true);
        const before = Number((await character(player)).ryo);
        const paid = (await call(player, { action: 'claim', questId: QUEST })).body;
        assert.deepEqual([paid.ok, paid.ryo, paid.statPoints, paid.fateShards, paid.title, paid.items, paid.marks], [true, 3 * (40 + 80 * 5), 0, 0, null, [], 2]);
        const after = await character(player);
        assert.deepEqual([Number(after.ryo) - before, after.questStandings], [3 * (40 + 80 * 5), ['tale-letter-carried']]);
        assert.equal((await call(player, { action: 'claim', questId: QUEST })).body.replayed, true);
    });

    it('The Shoal Toll: a catch, a fight with no Hold, and the catch handed over', async () => {
        const QUEST = 'tale-shoal-toll', player = `${PREFIX}tale-toll`;
        await seed(player, 78, ['shuttered-boat', 'first-footing'], 101);
        assert.equal((await call(player, { action: 'accept', questId: QUEST })).body.ok, true);
        standAt(player, 'saltstair-dock-101');
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        // The shoal opens for this step, as a quest's site does.
        assert.equal(questSiteRefusal(await stored(player), 'saltstair-fish-104'), null);
        assert.deepEqual([(await advance(player, QUEST)).body.reason, (await advance(player, QUEST)).body.target], ['incomplete', 4]);
        await gathered(player, 'quest-needle-fish', 4);
        assert.equal((await advance(player, QUEST)).body.advanced, true);

        const toll = await winFight(player, QUEST, 104);
        assert.deepEqual([toll.context.displayName, toll.context.questHold, toll.profile.level], ['Unmoored Patrol', undefined, 79]);
        // The fish must reach the slip: handing them over is the last step.
        standAt(player, 'saltstair-dock-101');
        assert.equal((await advance(player, QUEST)).body.readyToClaim, true);
        assert.equal(countOwned(await character(player), 'quest-needle-fish'), 0);
        const paid = (await call(player, { action: 'claim', questId: QUEST })).body;
        assert.deepEqual([paid.ok, paid.ryo, paid.marks], [true, 4 * (40 + 78 * 5), 2]);
    });
});

describe('The Rounds: a region’s four tiers', () => {
    const RECORD_HOUSE = 'saltstair-counter-105';
    const tier = (n: number) => `saltstair-rounds-${n}`;
    const accept = async (player: string, questId: string) => (await call(player, { action: 'accept', questId })).body;
    const claim = async (player: string, questId: string) => (await call(player, { action: 'claim', questId })).body;

    it('are offered by the region’s keeper once the region is open, one tier after another', async () => {
        const player = `${PREFIX}rounds-gate`;
        await seed(player, 80, ['shuttered-boat'], 105);
        const first = await lineOf(player, tier(1));
        assert.deepEqual([first.state, first.title, first.giverName, first.marks, first.rewardArtKeys, (first.offerAt as Json).name],
            ['open', 'Saltstair Rounds I', 'Orito', 0, ['badge-saltstair-tier-1'], 'Record House']);
        assert.deepEqual([(await lineOf(player, tier(2))).state, (await lineOf(player, tier(2))).reason], ['locked', 'quests']);
        // Another region's Rounds wait for that region to be opened.
        assert.deepEqual([(await lineOf(player, 'brackwater-rounds-1')).state, (await lineOf(player, 'brackwater-rounds-1')).reason], ['locked', 'region']);
        await seed(`${PREFIX}rounds-home`, 80, [], 105);
        assert.equal((await lineOf(`${PREFIX}rounds-home`, tier(1))).state, 'locked', 'not before the crossing');
    });

    it('I and II: walk the region, then gather for the counter and hand it in', async () => {
        const player = `${PREFIX}rounds-walk`;
        await seed(player, 80, ['shuttered-boat'], 105);
        assert.equal((await accept(player, tier(1))).ok, true);
        standAt(player, RECORD_HOUSE);
        assert.equal((await advance(player, tier(1))).body.advanced, true);
        // A walk step is passed in its own sector and nowhere else.
        assert.equal((await advance(player, tier(1))).body.reason, 'wrong-place');
        for (const sector of [102, 104, 109]) {
            standIn(player, sector);
            assert.equal((await advance(player, tier(1))).body.advanced, true, String(sector));
        }
        assert.equal((await claim(player, tier(1))).reason, 'not-final');
        standAt(player, RECORD_HOUSE);
        assert.equal((await advance(player, tier(1))).body.readyToClaim, true);
        const paid = await claim(player, tier(1));
        assert.deepEqual([paid.ok, paid.ryo, paid.statPoints, paid.marks, paid.fateShards, paid.title, paid.items], [true, 3 * (40 + 80 * 5), 0, 1, 0, null, []], 'ryo and the badge, and nothing else');
        assert.deepEqual([(await lineOf(player, tier(1))).state, (await lineOf(player, tier(1))).rewardArtKeys], ['done', ['badge-saltstair-tier-1']]);
        // The tier is an achievement too, proven by a list only this claim writes.
        assert.deepEqual((await character(player)).coastBadges, ['coast-saltstair-tier-1-v1']);
        assert.ok(eligibleAchievementIds(await character(player)).includes('coast-saltstair-tier-1-v1'));
        // A second claim finds the quest done and writes nothing more.
        const ryoBefore = (await character(player)).ryo;
        await claim(player, tier(1));
        assert.deepEqual([(await character(player)).coastBadges, (await character(player)).ryo], [['coast-saltstair-tier-1-v1'], ryoBefore]);

        // Tier II: the sites open for it like any quest's, and what is handed in leaves the backpack.
        assert.equal((await accept(player, tier(2))).ok, true);
        assert.match(String(questSiteRefusal(await stored(player), 'saltstair-harvest-102')), /./, 'the site waits for the step that sends the player there');
        standAt(player, RECORD_HOUSE);
        assert.equal((await advance(player, tier(2))).body.advanced, true);
        assert.equal(questSiteRefusal(await stored(player), 'saltstair-harvest-102'), null);
        const step = await lineOf(player, tier(2));
        assert.match(String((step.stage as Json).text), /^Harvest 6 Wrack Cord in Wrack Strand\. You need a kama\.$/);
        await gathered(player, 'quest-wrack-cord', 6);
        assert.equal((await advance(player, tier(2))).body.advanced, true);
        await gathered(player, 'quest-splitstone-fittings', 4);
        assert.equal((await advance(player, tier(2))).body.advanced, true);
        for (const itemId of ['quest-wrack-cord', 'quest-splitstone-fittings']) {
            assert.equal((await advance(player, tier(2))).body.advanced, true, itemId);
            assert.equal(countOwned(await character(player), itemId), 0, itemId);
        }
        assert.equal((await claim(player, tier(2))).ok, true);
    });

    it('a hand-in never takes what another quest under way still needs', async () => {
        // The Boatwright's Tools I is waiting for 8 Wrack Cord at the slip. Saltstair
        // Rounds II wants 6 of the same cord at the Record House. Before 2026-11-20
        // the Rounds took 6 of the 8 and left the main quest stuck at 2 of 8.
        const player = `${PREFIX}rounds-share`, MAIN = 'boatwright-tools-1', CORD = 'quest-wrack-cord';
        await seed(player, 80, ['shuttered-boat', 'first-footing'], 105);
        const save = await stored(player);
        await kv.set(`save:${player}`, { ...save, questLines: { v: 1,
            done: { ...(save.questLines as Json).done as Json, [tier(1)]: { at: 20, marks: 0 } },
            active: { [MAIN]: { stage: 3, at: 30 }, [tier(2)]: { stage: 3, at: 31 } } } });
        assert.deepEqual([(await lineOf(player, MAIN)).stage, (await lineOf(player, tier(2))).stage].map(stage => [(stage as Json).kind, ((stage as Json).need as Json).itemId, ((stage as Json).need as Json).count]),
            [['deliver', CORD, 8], ['deliver', CORD, 6]], 'both quests are on a hand-in of the same cord');

        await gathered(player, CORD, 8);
        standAt(player, RECORD_HOUSE);
        const refused = (await advance(player, tier(2))).body;
        assert.deepEqual([refused.ok, refused.reason, refused.error], [false, 'reserved', 'The Boatwright’s Tools I still needs 8 of these. Gather 6 more before you hand any in.']);
        assert.equal(countOwned(await character(player), CORD), 8, 'nothing was taken');

        // With enough for both, the Rounds take their six and leave the eight.
        await gathered(player, CORD, 14);
        assert.equal((await advance(player, tier(2))).body.advanced, true);
        assert.equal(countOwned(await character(player), CORD), 8);
        // And the main quest hands in its own without being held up by the Rounds, which have moved on.
        standAt(player, 'saltstair-dock-101');
        assert.equal((await advance(player, MAIN)).body.advanced, true);
        assert.equal(countOwned(await character(player), CORD), 0);
    });

    it('III and IV: the trails are cleared without a tool, and the last tier waits for the region’s Crossing War quest', async () => {
        const player = `${PREFIX}rounds-fight`;
        await seed(player, 80, ['shuttered-boat'], 105);
        const save = await stored(player);
        const done = (n: number) => ({ at: n, marks: 0 });
        await kv.set(`save:${player}`, { ...save, questLines: { v: 1, active: {}, done: { ...(save.questLines as Json).done as Json, [tier(1)]: done(20), [tier(2)]: done(21) } } });

        assert.equal((await accept(player, tier(3))).ok, true);
        standAt(player, RECORD_HOUSE);
        assert.equal((await advance(player, tier(3))).body.advanced, true);
        for (const sector of [103, 106, 110]) {
            const refused = await advance(player, tier(3));
            assert.deepEqual([refused.body.reason, typeof refused.body.fightId], ['fight', 'string']);
            const spec = await winFight(player, tier(3), sector);
            // An ordinary patrol, one level over the player, with no Hold to break.
            assert.deepEqual([spec.context.displayName, spec.context.questHold, spec.profile.level], ['Unmoored Patrol', undefined, 81], String(sector));
        }
        standAt(player, RECORD_HOUSE);
        assert.equal((await advance(player, tier(3))).body.readyToClaim, true);
        assert.equal((await claim(player, tier(3))).ok, true);

        assert.deepEqual([(await lineOf(player, tier(4))).state, (await lineOf(player, tier(4))).reason], ['locked', 'quests'], 'Bitter Tide is not finished');
        const now = await stored(player);
        await kv.set(`save:${player}`, { ...now, questLines: { ...(now.questLines as Json), done: { ...(now.questLines as Json).done as Json, 'first-footing': DONE['first-footing'], 'crossing-war-1': DONE['crossing-war-1'] } } });
        assert.equal((await accept(player, tier(4))).ok, true);
        standAt(player, RECORD_HOUSE);
        assert.equal((await advance(player, tier(4))).body.advanced, true);
        standIn(player, 101);
        assert.equal((await advance(player, tier(4))).body.advanced, true);
        const stand = await winFight(player, tier(4), 107);
        assert.deepEqual([stand.context.questHold, stand.profile.level], [undefined, 82]);
        standIn(player, 108);
        assert.equal((await advance(player, tier(4))).body.advanced, true);
        standAt(player, RECORD_HOUSE);
        assert.equal((await advance(player, tier(4))).body.readyToClaim, true);
        const paid = await claim(player, tier(4));
        assert.deepEqual([paid.ok, paid.statPoints, paid.ryo], [true, 8, 10 * (40 + 80 * 5)]);
    });
});

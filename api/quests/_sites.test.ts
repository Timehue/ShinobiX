import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { before, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';
process.env.SESSION_SECRET = 'quest-sites-test-secret';

import { QUEST_SITES, QUEST_SITE_ATTEMPTS, QUEST_SITE_REFILL_MS, isKeptQuestMaterial } from '../../shared/quest-sites.js';
import { readResourceGathering, resourceAttemptsToday, RESOURCE_NODE_ATTEMPTS, RESOURCE_REFILL_MS, RESOURCE_SUCCESS_XP } from '../../shared/resource-gathering.js';
import { resourceNode } from '../../shared/resource-nodes.js';
import { gatheringToolRemaining } from '../../shared/gathering-tools.js';
import { coastLayout } from '../../shared/coast-world.js';
import { coastTileWalkable } from '../../shared/coast-world-rules.js';
import { countOwned } from '../craft/_forge.js';
import { serverWalkTile, serverWalkableTile } from '../_sector-obstacles.js';
import { resourceAdmissionError } from '../world/_resource-gathering.js';
import { cleanSectorPoolRow, sectorPoolKey } from '../world/_sector-pool.js';
import { sharedResourceNodeKey } from '../world/_shared-resource-nodes.js';
import { gatherNode, questSiteNode, questSiteRefusal, questSiteViews, questSiteWorkable } from './_sites.js';

/*
 * Quest sites, worked through the REAL gathering route against the SHIPPED
 * catalogue. Wrack Strand (sector 102) is harvested for First Footing's fourth
 * stage; Splitstone Seam (sector 103) is mined for The Crossing War.
 */

type Json = Record<string, unknown>;
type Handler = (req: never, res: never) => Promise<unknown>;

const STRAND = 'saltstair-harvest-102', SEAM = 'saltstair-mine-103';
const CORD = 'quest-wrack-cord', FITTINGS = 'quest-splitstone-fittings';
const KAMA = 'tool-basic-harvest-kama';
// Stage indexes in First Footing: 2 is the patrol, 3 is the cord, 5 is the gate captain.
const BEFORE_CORD = 2, ON_CORD = 3, ON_CAPTAIN = 5;

let kv: typeof import('../_storage.js').kv;
let token: typeof import('../_auth.js').issuePlayerToken;
let online: typeof import('../_realtime/online-store.js').onlineStore;
let handler: Handler;

before(async () => {
    ({ kv } = await import('../_storage.js'));
    ({ issuePlayerToken: token } = await import('../_auth.js'));
    ({ onlineStore: online } = await import('../_realtime/online-store.js'));
    handler = (await import('../world/resource.js')).default as unknown as Handler;
});

async function post(name: string, body: Json) {
    const out = { status: 200, body: {} as Json };
    const res = { setHeader() { return res; }, status(value: number) { out.status = value; return res; }, json(value: Json) { out.body = value; return res; }, end() { return res; } };
    await handler({ method: 'POST', body, query: {}, headers: { 'x-player-token': token(name) }, socket: { remoteAddress: '127.4.8.21' } } as never, res as never);
    return out;
}

/** A level 50 player standing at a site, part-way through a quest. */
async function seed(name: string, options: { site?: string; quest?: string | null; stage?: number; equipment?: Json; tile?: number } = {}) {
    const node = questSiteNode(options.site ?? STRAND)!;
    const quest = options.quest === undefined ? 'first-footing' : options.quest;
    const character = { name, level: 50, hp: 100, maxHp: 100, chakra: 100, maxChakra: 100, stamina: 100, maxStamina: 100,
        inventory: [], itemStacks: [], ryo: 0, village: 'Stormveil Village', equipment: options.equipment ?? { kama: KAMA },
        // A basic tool's wear is tracked from the day the shop sold it.
        gatheringToolUses: { [KAMA]: 0 } };
    await kv.set(`save:${name}`, { _saveVersion: 1, _saveAt: Date.now(), currentSector: node.sector, character,
        questLines: { v: 1, done: {}, active: quest ? { [quest]: { stage: options.stage ?? ON_CORD, at: 1_000 } } : {} } });
    online.upsert({ name, sector: node.sector, tile: options.tile ?? node.approach, character: { level: 50 } });
    return node;
}

const journalKey = (name: string, id: string) => `economy-tx:resource-gathering:${createHash('sha256').update(`${name}:${id}`).digest('hex')}`;
const saved = async (name: string) => (await kv.get<Json>(`save:${name}`))!.character as Json;
const start = (name: string, requestId: string, nodeId = STRAND) => post(name, { action: 'start', nodeId, mode: 'relaxed', requestId });

/** Start a relaxed attempt and make the server's own sealed draw a success or a failure. */
async function attempt(t: { mock: { timers: { tick(ms: number): void } } }, name: string, requestId: string, nodeId: string, succeed: boolean) {
    const started = await start(name, requestId, nodeId);
    assert.equal(started.status, 200, JSON.stringify(started.body));
    const journal = (await kv.get<{ meta: Json }>(journalKey(name, requestId)))!;
    await kv.set(journalKey(name, requestId), { ...journal, meta: { ...journal.meta, seal: { ...(journal.meta.seal as Json), successDraw: succeed ? 0 : 0.999999 } } });
    t.mock.timers.tick(4_000);
    const resolved = await post(name, { action: 'resolve', requestId });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    return { started, journal, receipt: resolved.body.receipt as Json };
}

test('every quest site is a real place on the coast, and none shares an id with a home node', () => {
    for (const site of Object.values(QUEST_SITES)) {
        const node = questSiteNode(site.id);
        assert.ok(node, `${site.id} is not placed on the coast`);
        assert.equal(resourceNode(site.id), undefined, `${site.id} collides with a home node`);
        assert.equal(gatherNode(site.id), node);
        assert.equal(questSiteWorkable(node), true, `${site.id}: its approach tile cannot be stood on`);
        assert.deepEqual([node.activity, node.difficulty, node.family], [site.activity, site.level, site.itemId]);
        assert.notEqual(node.target, node.approach, `${site.id}: the gatherer stands beside the site, not on it`);
    }
    assert.equal(questSiteNode('resource-17'), undefined);
    assert.equal(gatherNode('resource-17'), resourceNode('resource-17'), 'home nodes are found as before');
    // The save keeps a player's own attempts in the same shape for both, so the two must agree.
    assert.deepEqual([QUEST_SITE_ATTEMPTS, QUEST_SITE_REFILL_MS], [RESOURCE_NODE_ATTEMPTS, RESOURCE_REFILL_MS]);
});

test('the server walks the coast by the coast\'s own floors', () => {
    const strand = questSiteNode(STRAND)!, mask = coastLayout(strand.sector)!.mask;
    assert.equal(serverWalkableTile(strand.sector, strand.approach), true);
    const blocked = Array.from({ length: 144 }, (_, tile) => tile).find(tile => !coastTileWalkable(mask, tile))!;
    assert.equal(serverWalkableTile(strand.sector, blocked), false, 'a painted cliff or building is not open ground');
    assert.equal(coastTileWalkable(mask, serverWalkTile(strand.sector, blocked)!), true, 'a blocked tile is moved to ground that can be stood on');
    assert.equal(serverWalkTile(strand.sector, strand.approach), strand.approach);
    const crownMask = coastLayout(150)!.mask;
    for (let tile = 0; tile < 144; tile++) {
        assert.equal(serverWalkableTile(150, tile), coastTileWalkable(crownMask, tile), 'Hushcrown tile ' + tile);
    }

    // A step the client asks for is held to the same floor.
    online.upsert({ name: 'coastwalker', sector: strand.sector, tile: strand.approach, character: { level: 50 } });
    const open = Array.from({ length: 144 }, (_, tile) => tile).find(tile => tile !== strand.approach && coastTileWalkable(mask, tile))!;
    assert.equal(online.moveToTile('coastwalker', blocked), null);
    assert.equal(online.get('coastwalker')?.tile, strand.approach);
    assert.equal(online.moveToTile('coastwalker', open)?.tile, open);
});

test('a site is shut until a quest sends the player there, and stays open for the rest of that quest', async () => {
    await seed('sitestranger', { quest: null });
    const stranger = await start('sitestranger', 'site-stranger-attempt-01');
    assert.equal(stranger.status, 409);
    assert.match(String(stranger.body.error), /nothing here you have a use for yet/);
    assert.equal(resourceAttemptsToday(await saved('sitestranger'), 'harvesting', Date.now()), 0, 'nothing was spent');
    assert.equal(await kv.get(journalKey('sitestranger', 'site-stranger-attempt-01')), null, 'nothing was reserved');

    await seed('siteearly', { stage: BEFORE_CORD });
    assert.match(String((await start('siteearly', 'site-early-attempt-0001')).body.error), /nothing here you have a use for yet/);

    // On the boss stage the cord is still needed to forge a lost order again.
    await seed('sitelate', { stage: ON_CAPTAIN });
    assert.equal((await start('sitelate', 'site-late-attempt-00001')).status, 200);

    const stored = { questLines: { v: 1, done: {}, active: { 'crossing-war-1': { stage: 1, at: 1 } } } };
    assert.equal(questSiteRefusal(stored, 'saltstair-harvest-106'), null);
    assert.match(String(questSiteRefusal(stored, SEAM)), /nothing here/, 'the seam belongs to the next stage');
    assert.match(String(questSiteRefusal(stored, STRAND)), /nothing here/, 'another quest\'s site');
});

test('a site needs the real tool, the real skill and the right spot', async () => {
    await seed('sitenotool', { equipment: {} });
    assert.match(String((await start('sitenotool', 'site-no-tool-attempt-01')).body.error), /Equip a harvest kama in Inventory first\./);
    await seed('sitewrongtool', { equipment: { pickaxe: 'tool-golden-pickaxe' } });
    assert.match(String((await start('sitewrongtool', 'site-wrong-tool-try-01')).body.error), /Equip a harvest kama/);

    const node = await seed('sitefar');
    online.upsert({ name: 'sitefar', sector: node.sector, tile: serverWalkTile(node.sector, node.approach + 2)!, character: { level: 50 } });
    assert.match(String((await start('sitefar', 'site-far-away-attempt-1')).body.error), /Walk to the marked/);
    assert.equal(resourceAttemptsToday(await saved('sitefar'), 'harvesting', Date.now()), 0);

    // A later region's site asks for a trained gatherer, and says which level.
    const novice = { level: 50, equipment: { kama: KAMA }, gatheringToolUses: { [KAMA]: 0 } };
    assert.match(String(resourceAdmissionError(novice, { ...node, difficulty: 4 }, Date.now(), false)), /Requires Harvesting skill 4\./);
    assert.equal(resourceAdmissionError(novice, node, Date.now(), false), null);
});

test('working a site is real gathering: it wears the tool, spends the day\'s allowance, pays skill XP and can fail', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const name = 'siteworker';
    const node = await seed(name);
    const before = await saved(name);
    assert.equal(gatheringToolRemaining(before, KAMA), 125);

    const won = await attempt(t, name, 'site-worker-attempt-001', STRAND, true);
    const seal = won.journal.meta.seal as Json;
    assert.equal(seal.sharedNode, undefined, 'a quest site is never a shared claim');
    assert.deepEqual([(seal.rules as Json).family, (seal.rules as Json).difficulty], [CORD, 1]);
    assert.deepEqual([won.receipt.outcome, won.receipt.itemId, won.receipt.count, won.receipt.grade, won.receipt.traceId], ['success', CORD, 1, undefined, undefined]);

    const after = await saved(name);
    assert.equal(countOwned(after, CORD), 1);
    assert.equal(gatheringToolRemaining(after, KAMA), 124, 'the kama wore by one use');
    assert.equal(resourceAttemptsToday(after, 'harvesting', Date.now()), 1);
    assert.equal(readResourceGathering(after.resourceGathering).harvestingXp, RESOURCE_SUCCESS_XP);

    const lost = await attempt(t, name, 'site-worker-attempt-002', STRAND, false);
    assert.deepEqual([lost.receipt.outcome, lost.receipt.itemId], ['failed', undefined]);
    const failed = await saved(name);
    assert.equal(countOwned(failed, CORD), 1, 'a failed attempt yields nothing');
    assert.equal(gatheringToolRemaining(failed, KAMA), 123, 'and still wore the tool');
    assert.equal(resourceAttemptsToday(failed, 'harvesting', Date.now()), 2);

    // Nothing shared was touched: no world claim, and no slot from a sector's daily pool.
    assert.equal(await kv.get(sharedResourceNodeKey(STRAND)), null);
    assert.equal(cleanSectorPoolRow(await kv.get(sectorPoolKey(node.sector, Date.now()))).explores, 0);

    // What the quest tab and the map are told.
    const stored = (await kv.get<Json>(`save:${name}`))!;
    assert.deepEqual(questSiteViews(stored, failed, Date.now()), [{
        id: STRAND, name: node.name, questId: 'first-footing', sector: 102, approach: node.approach, target: node.target,
        activity: 'harvesting', level: 1, itemId: CORD, need: 6, have: 1, remaining: 1, refillAt: 0,
    }]);
});

test('attempts are each player\'s own: one player never blocks or empties a site for the next', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    await seed('sitefirst'); await seed('sitesecond');
    // Both stand on the same tile and work the same site at the same moment.
    assert.equal((await start('sitefirst', 'site-first-attempt-0001')).status, 200);
    assert.equal((await start('sitesecond', 'site-second-attempt-001')).status, 200);
    assert.equal((await post('sitefirst', { action: 'cancel', requestId: 'site-first-attempt-0001' })).status, 200);

    for (const id of ['site-first-attempt-0002', 'site-first-attempt-0003']) {
        assert.equal((await start('sitefirst', id)).status, 200);
        assert.equal((await post('sitefirst', { action: 'cancel', requestId: id })).status, 200);
    }
    const empty = await start('sitefirst', 'site-first-attempt-0004');
    assert.equal(empty.status, 409);
    assert.match(String(empty.body.error), /This node is empty\. Return after it replenishes\./);
    assert.equal(questSiteViews((await kv.get<Json>('save:sitefirst'))!, await saved('sitefirst'), Date.now())[0].remaining, 0);

    // The second player has used one of their own three, whatever the first did.
    assert.equal((await post('sitesecond', { action: 'cancel', requestId: 'site-second-attempt-001' })).status, 200);
    assert.equal((await start('sitesecond', 'site-second-attempt-002')).status, 200);

    t.mock.timers.tick(QUEST_SITE_REFILL_MS + 1);
    online.upsert({ name: 'sitefirst', sector: 102, tile: questSiteNode(STRAND)!.approach, character: { level: 50 } });
    assert.equal((await start('sitefirst', 'site-first-attempt-0005')).status, 200, 'the site refills for the player who emptied it');
});

test('a site a finished quest earned stays open for good, and its material is kept', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const name = 'sitekeeper';
    const node = await seed(name, { quest: null });
    assert.match(String((await start(name, 'site-keeper-attempt-001')).body.error), /nothing here you have a use for yet/);

    // The Boatwright's Tools I keeps Wrack Strand and Splitstone Seam.
    assert.deepEqual([QUEST_SITES[STRAND].keptBy, QUEST_SITES[SEAM].keptBy], ['boatwright-tools-1', 'boatwright-tools-1']);
    assert.deepEqual([isKeptQuestMaterial(CORD), isKeptQuestMaterial(FITTINGS), isKeptQuestMaterial('quest-woundroot'), isKeptQuestMaterial('quest-inkseed')], [true, true, false, false]);
    const save = (await kv.get<Json>(`save:${name}`))!;
    await kv.set(`save:${name}`, { ...save, questLines: { v: 1, active: {}, done: { 'boatwright-tools-1': { at: 5, marks: 1 } } } });
    const stored = (await kv.get<Json>(`save:${name}`))!;
    assert.equal(questSiteRefusal(stored, STRAND), null);
    assert.equal(questSiteRefusal(stored, SEAM), null);
    assert.match(String(questSiteRefusal(stored, 'saltstair-harvest-106')), /nothing here/, 'only the sites the quest names are kept');

    // It is worked by the same rules as ever, and pays the same material.
    const won = await attempt(t, name, 'site-keeper-attempt-002', STRAND, true);
    assert.deepEqual([won.receipt.outcome, won.receipt.itemId, won.receipt.count], ['success', CORD, 1]);
    const after = await saved(name);
    assert.equal(resourceAttemptsToday(after, 'harvesting', Date.now()), 1, 'it still spends the day\'s allowance');
    assert.equal(gatheringToolRemaining(after, KAMA), 124, 'and still wears the tool');

    // The map is told about both kept sites, with nothing asked for.
    const views = questSiteViews((await kv.get<Json>(`save:${name}`))!, after, Date.now());
    assert.deepEqual(views.map(view => [view.id, view.questId, view.need, view.have, view.kept]), [
        [STRAND, 'boatwright-tools-1', 0, 1, true],
        [SEAM, 'boatwright-tools-1', 0, 0, true],
    ]);
    assert.equal(views[0].sector, node.sector);
});

test('the coast\'s fishing site pays its quest material to a player with the fishing tool', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const POOL = 'brackwater-fish-117', EEL = 'quest-caulk-eel', POLE = 'tool-basic-fishing-pole';
    // Stage 2 of The Boatwright's Tools II is the Sounding Pool.
    await seed('sitenopole', { site: POOL, quest: 'boatwright-tools-2', stage: 2 });
    assert.match(String((await start('sitenopole', 'site-no-pole-attempt-01', POOL)).body.error), /Equip a fishing kunai in Inventory first\./);

    const name = 'siteangler';
    await seed(name, { site: POOL, quest: 'boatwright-tools-2', stage: 2, equipment: { fishingPole: POLE } });
    const save = (await kv.get<Json>(`save:${name}`))!;
    await kv.set(`save:${name}`, { ...save, character: { ...(save.character as Json), gatheringToolUses: { [POLE]: 0 } } });
    const fished = await attempt(t, name, 'site-angler-attempt-001', POOL, true);
    assert.deepEqual([fished.receipt.outcome, fished.receipt.itemId, fished.receipt.count, fished.receipt.grade], ['success', EEL, 1, undefined]);
    const after = await saved(name);
    assert.equal(countOwned(after, EEL), 1);
    assert.equal(readResourceGathering(after.resourceGathering).fishingXp, RESOURCE_SUCCESS_XP);
    assert.equal(resourceAttemptsToday(after, 'fishing', Date.now()), 1);
});

test('a mined site pays its quest material, ungraded, and draws no ore on the map', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const name = 'siteminer';
    await seed(name, { site: SEAM, quest: 'crossing-war-1', stage: 2, equipment: { pickaxe: 'tool-golden-pickaxe' } });
    const mined = await attempt(t, name, 'site-miner-attempt-0001', SEAM, true);
    const active = readResourceGathering(((mined.started.body.character as Json).resourceGathering)).active;
    assert.equal(active?.nodeId, SEAM);
    assert.equal(active?.deposit, undefined);
    assert.deepEqual([mined.receipt.outcome, mined.receipt.itemId, mined.receipt.count, mined.receipt.grade], ['success', FITTINGS, 1, undefined]);
    const after = await saved(name);
    assert.equal(countOwned(after, FITTINGS), 1);
    assert.equal(readResourceGathering(after.resourceGathering).miningXp, RESOURCE_SUCCESS_XP);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { sectorBuilding } from '../../shared/sector-buildings.js';
import { coastSite } from '../../shared/coast-world.js';
import { questBuildingPlace } from './lines.js';
import { QUEST_ITEMS, questItem } from '../../shared/quest-items.js';
import { questSite } from '../../shared/quest-sites.js';
import { COAST_MIN_LEVEL, COAST_REGION_LEVELS, coastRegionOf, sectorMapOf } from '../../shared/world-maps.js';
import { isKnownEarnedTitle, isServerCreditedTitle } from '../_titles-registry.js';
import { QUEST_LINE_CATALOGUE, QUEST_LINES, questLineRyo } from './_catalog.js';
import { questLineCatalogueProblems, reachableQuestLines } from './_catalog-rules.js';
import { questFightHolds, questStageFightId, questStageFightIds, type BossStage } from './_types.js';
import { COAST_LAST_GARRISON } from '../_coast-admission.js';
import { chooseQuestLineOption, claimQuestLine, questLineViews, questSaysHeard, type QuestEngineDeps } from './_engine.js';
import { COAST_SCRIPT } from './_coast-script.js';
import { coastCastMember } from '../../shared/coast-cast.js';
import type { QuestLine, QuestSay } from './_types.js';
import { parseQuestLines } from './_record.js';
import { countOwned } from '../craft/_forge.js';
import { RELICS_BY_ID } from '../../shared/relics.js';
import { COAST_ROUND_REGIONS } from './_coast-rounds.js';
import { questBookRyo } from '../sector/_questbook.js';

/*
 * The shipped catalogue against the world it points at. The rules themselves
 * are tested in _core.test.ts; this file is what stops a quest shipping that
 * names a building, item or recipe the game does not have.
 */

test('the shipped catalogue passes every catalogue rule', () => {
    assert.deepEqual(questLineCatalogueProblems(QUEST_LINE_CATALOGUE), []);
});

test('every building a quest stage names exists', () => {
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        for (const stage of line.stages) {
            if (stage.kind === 'enter' || stage.kind === 'make' || stage.kind === 'deliver') {
                assert.ok(sectorBuilding(stage.buildingId) ?? coastSite(stage.buildingId), `${line.id}/${stage.key}: unknown building ${stage.buildingId}`);
            }
        }
    }
});

test('every clue is a station on the floor it names, inside the building its step names, in the room\'s own order', () => {
    let clues = 0;
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        for (const stage of line.stages) {
            if (stage.kind !== 'enter' || !stage.clues?.length) continue;
            const site = coastSite(stage.buildingId);
            assert.ok(site?.floors?.length, `${line.id}/${stage.key}: clues need a building with rooms`);
            let lastRoomOrder = 0;
            for (const clue of stage.clues) {
                clues++;
                const station: { clue?: number } | undefined = site!.floors![clue.floor]?.stations.find(entry => entry.name === clue.station);
                assert.ok(station, `${line.id}/${stage.key}/${clue.key}: no station "${clue.station}" on floor ${clue.floor} of ${stage.buildingId}`);
                // The room unlocks its own stations by their `clue` number. The quest asks for them in that order too,
                // so the room never says "an earlier clue is missing" about a clue the quest has already accepted.
                if (station!.clue !== undefined) {
                    assert.ok(station!.clue > lastRoomOrder, `${line.id}/${stage.key}/${clue.key}: out of the room's order`);
                    lastRoomOrder = station!.clue;
                }
            }
        }
    }
    assert.ok(clues >= 5, 'the Hollow Sentinel and the Leash Garrison carry their clues');
});

test('every item a quest gathers, makes, drops, hands in or rewards is a real item', () => {
    const referenced = new Map<string, string>();
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        for (const stage of line.stages) {
            if (stage.kind === 'gather' || stage.kind === 'deliver' || stage.kind === 'drop') referenced.set(stage.itemId, `${line.id}/${stage.key}`);
        }
        for (const itemId of line.rewards.items ?? []) referenced.set(itemId, `${line.id}/rewards`);
    }
    for (const recipe of Object.values(QUEST_LINE_CATALOGUE.recipes)) {
        for (const input of recipe.inputs) referenced.set(input.itemId, `recipe ${recipe.id}`);
        referenced.set(recipe.output.itemId, `recipe ${recipe.id}`);
    }
    for (const fight of Object.values(QUEST_LINE_CATALOGUE.fights)) {
        for (const hold of questFightHolds(fight)) referenced.set(hold.breakerItemId, `fight ${fight.id}`);
    }
    for (const [itemId, where] of referenced) {
        assert.ok(Object.hasOwn(ITEM_CATALOG, itemId), `${where}: unknown item ${itemId}`);
    }
});

test('every gather stage names quest sites that exist and yield what the stage asks for', () => {
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        for (const stage of line.stages) {
            if (stage.kind !== 'gather') continue;
            for (const siteId of stage.siteIds) {
                const site = questSite(siteId);
                assert.ok(site, `${line.id}/${stage.key}: unknown quest site ${siteId}`);
                assert.equal(site.itemId, stage.itemId, `${line.id}/${stage.key}: ${siteId} yields ${site.itemId}`);
            }
        }
    }
});

test('a quest keeps to its own map', () => {
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        for (const stage of line.stages) {
            const sector = stage.kind === 'enter' || stage.kind === 'make' || stage.kind === 'deliver'
                ? questBuildingPlace(stage.buildingId)?.sector
                : stage.kind === 'speak' || stage.kind === 'reach' ? stage.place.sector : undefined;
            if (sector === undefined) continue;
            assert.equal(sectorMapOf(sector), line.world, `${line.id}/${stage.key}: sector ${sector} is not on the ${line.world} map`);
        }
    }
});

test('every fight happens on its quest\'s own map', () => {
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        for (const stage of line.stages) {
            if (stage.kind !== 'drop' && stage.kind !== 'boss') continue;
            const fight = QUEST_LINE_CATALOGUE.fights[stage.fightId];
            assert.equal(sectorMapOf(fight.sector), line.world, `${line.id}/${stage.key}: fight ${fight.id} is in sector ${fight.sector}`);
            assert.ok(fight.statBonus >= 0 && fight.statBonus <= 8, `fight ${fight.id}: stat bonus is on the Quest Book boss scale`);
        }
    }
});

test('every reward title can be worn, and only through the server-owned vault', () => {
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        const titles = [line.rewards.title, ...line.stages.flatMap(stage => (stage.kind === 'choice' ? stage.choice.options.map(option => option.title) : []))];
        for (const title of titles) {
            if (!title) continue;
            assert.equal(isKnownEarnedTitle(title), true, `${line.id}: "${title}" is not in the titles registry`);
            assert.equal(isServerCreditedTitle(title), true, `${line.id}: "${title}" must be server-credited`);
        }
    }
});

test('every quest item is used by a quest, and every fight uses a known loadout', () => {
    const used = new Set<string>();
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        for (const stage of line.stages) if (stage.kind === 'gather' || stage.kind === 'drop' || stage.kind === 'deliver') used.add(stage.itemId);
    }
    for (const recipe of Object.values(QUEST_LINE_CATALOGUE.recipes)) {
        used.add(recipe.output.itemId);
        for (const input of recipe.inputs) used.add(input.itemId);
    }
    for (const item of QUEST_ITEMS) assert.ok(used.has(item.id), `${item.id} belongs to no quest`);
    // The loadouts the world AI fights already build (api/missions/_world-ai-fight.ts).
    const loadouts = new Set(['bruiser', 'boss', 'burst', 'defender']);
    for (const fight of Object.values(QUEST_LINE_CATALOGUE.fights)) {
        assert.ok(loadouts.has(fight.loadoutId), `fight ${fight.id}: unknown loadout ${fight.loadoutId}`);
    }
    // A stage's own fight and every variant a choice can swap in.
    const fought = new Set(Object.values(QUEST_LINE_CATALOGUE.lines).flatMap(line => line.stages.flatMap(stage => (stage.kind === 'drop' || stage.kind === 'boss' ? questStageFightIds(stage) : []))));
    for (const fightId of Object.keys(QUEST_LINE_CATALOGUE.fights)) assert.ok(fought.has(fightId), `fight ${fightId} is used by no quest`);
});

test('the first quest opens the boat and the landing region, and the third opens the next region', () => {
    const lines = QUEST_LINE_CATALOGUE.lines;
    assert.deepEqual([lines['shuttered-boat'].world, lines['shuttered-boat'].gate.level, lines['shuttered-boat'].rewards.unlocks, lines['shuttered-boat'].rewards.opensRegion], ['home', 75, ['boat'], 1]);
    assert.deepEqual(lines['first-footing'].gate.quests, ['shuttered-boat']);
    assert.deepEqual([lines['crossing-war-1'].rewards.opensRegion, lines['crossing-war-1'].rewards.unlocks], [2, ['contest-land']]);
});

test('the catalogue holds the plan\'s twenty quests, and the finale can be reached without a clan', () => {
    const everything = Object.values(QUEST_LINE_CATALOGUE.lines);
    // Twenty quests. Beside them, each region's four Rounds (api/quests/_coast-rounds.ts)
    // and the ten side tales (api/quests/_coast-tales.ts), none worth a mark.
    const lines = everything.filter(line => line.kind === 'quest');
    const series = (name: string) => everything.filter(line => line.series === name).length;
    assert.deepEqual([lines.length, series('coast-rounds'), series('coast-tales'), everything.length], [20, 20, 10, 50]);
    assert.deepEqual(lines.map(line => line.id), Object.keys(QUEST_LINES));
    const marks = (series: string) => lines.filter(line => line.series === series).reduce((sum, line) => sum + line.marks, 0);
    // Main line 21 (The Shuttered Boat and First Footing are in the `crossing` series), and the four side series.
    assert.deepEqual([marks('crossing') + marks('crossing-war'), marks('boatwright'), marks('uncounted'), marks('untamed'), marks('clan-gate')], [21, 6, 8, 5, 6]);
    // Only Raise the Clan Gate needs a clan, and nothing else waits on it.
    assert.deepEqual(lines.filter(line => line.gate.clan).map(line => line.id).sort(), ['clan-gate-1', 'clan-gate-2', 'clan-gate-3']);
    const solo = reachableQuestLines(QUEST_LINES, { withClan: false });
    assert.deepEqual([solo.ids.size, solo.marks, solo.ids.has('the-unmoored')], [17, 40, true]);
    // The Rounds and the tales add no marks and need no clan, so they change neither number.
    const soloAll = reachableQuestLines(QUEST_LINE_CATALOGUE.lines, { withClan: false });
    assert.deepEqual([soloAll.ids.size, soloAll.marks], [47, 40]);
    assert.deepEqual([QUEST_LINE_CATALOGUE.lines['crossing-war-5'].gate.marks, QUEST_LINE_CATALOGUE.lines['the-unmoored'].gate.marks], [16, 22]);
    // A Landing condition is only ever asked of a clan quest, at the Clan Landing Plot.
    for (const line of lines) {
        for (const stage of line.stages) {
            if (stage.kind === 'enter' && stage.landing) assert.deepEqual([line.gate.clan, stage.buildingId], [true, 'saltstair-plot-108'], `${line.id}/${stage.key}`);
        }
    }
});

test('stat points are a settled total, rise along each series, and peak at the finale', () => {
    const lines = QUEST_LINES;
    const points = (ids: Iterable<string>) => [...ids].reduce((sum, id) => sum + (lines[id].rewards.statPoints ?? 0), 0);
    // One-time grants outside the daily budget, so the totals are deliberate (see questLineRyo's note).
    assert.equal(points(Object.keys(lines)), 505);
    // The Rounds pay 8 on each region's last tier and nothing before it: 40 in all.
    const rounds = Object.values(QUEST_LINE_CATALOGUE.lines).filter(line => line.series === 'coast-rounds');
    assert.deepEqual(rounds.map(line => line.rewards.statPoints ?? 0).filter(Boolean), [8, 8, 8, 8, 8]);
    assert.equal(points(reachableQuestLines(lines, { withClan: false }).ids), 455);
    const series = (prefix: string) => Object.keys(lines).filter(id => id.startsWith(prefix)).sort().map(id => lines[id].rewards.statPoints ?? 0);
    for (const prefix of ['crossing-war-', 'boatwright-tools-', 'uncounted-', 'untamed-coast-', 'clan-gate-']) {
        const paid = series(prefix);
        assert.deepEqual(paid, [...paid].sort((a, b) => a - b), `${prefix} pays more as it goes on`);
    }
    const most = Math.max(...Object.values(lines).map(line => line.rewards.statPoints ?? 0));
    assert.deepEqual([lines['the-unmoored'].rewards.statPoints, most], [80, 80]);
    // The small currencies stay small: a Fate Shard is 0 or 1 a quest, and Aura Stones are 3 across the whole coast.
    for (const line of Object.values(lines)) assert.ok((line.rewards.fateShards ?? 0) <= 1, line.id);
    assert.equal(Object.values(lines).reduce((sum, line) => sum + (line.rewards.auraStones ?? 0), 0), 3);
});

test('a gather stage that names a skill level names the level its site really needs', () => {
    // The site refuses below its own level (api/world/_resource-gathering.ts), so a
    // stage that names a lower one sends a player there to be turned away.
    let named = 0;
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        for (const stage of line.stages) {
            if (stage.kind !== 'gather') continue;
            const need = Math.max(...stage.siteIds.map(id => questSite(id)?.level ?? 1));
            const said = /skill (\d+)/.exec(stage.text);
            if (said) { named++; assert.equal(Number(said[1]), need, `${line.id}/${stage.key}: "${stage.text}"`); }
            // The first quest to send a player to a site above level 1 says so.
        }
    }
    assert.ok(named >= 10, 'the check still finds the stages that name a skill');
    const firstAsk = (siteId: string) => Object.values(QUEST_LINE_CATALOGUE.lines).flatMap(line => line.stages)
        .find(stage => stage.kind === 'gather' && stage.siteIds.includes(siteId))!;
    for (const siteId of ['hushcrown-harvest-142', 'hushcrown-mine-143', 'hushcrown-fish-145']) {
        assert.deepEqual([questSite(siteId)?.level, /skill 7/.test(firstAsk(siteId).text)], [7, true], siteId);
    }
});

test('each quest names the tool and the skill the first time it sends a player to gather that way', () => {
    // A player can take a side quest without the one that first taught the tool,
    // and the journal shows only the stage text. So every quest says it for itself,
    // once per kind of work and skill level; later steps are free to say why instead.
    const tool = { harvesting: 'kama', mining: 'pickaxe', fishing: 'fishing kunai' } as const;
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        const said = new Set<string>();
        for (const stage of line.stages) {
            if (stage.kind !== 'gather') continue;
            for (const site of stage.siteIds.map(id => questSite(id)!)) {
                const work = `${site.activity}:${site.level}`;
                if (said.has(work)) continue;
                said.add(work);
                const at: string = `${line.id}/${stage.key}: "${stage.text}"`;
                assert.ok(stage.text.includes(tool[site.activity]), `${at} does not name the ${tool[site.activity]}`);
                if (site.level > 1) assert.ok(stage.text.includes(`${site.activity} skill ${site.level}`), `${at} does not name ${site.activity} skill ${site.level}`);
            }
        }
    }
    // The first quest's stormglass is an ordinary seam, not a quest site, so no
    // gather stage speaks for it: the step that needs it has to.
    const shards = QUEST_LINE_CATALOGUE.lines['shuttered-boat'].stages.find(stage => stage.key === 'shards')!;
    assert.match(shards.text, /stormglass seams, with a pickaxe and mining skill 4/);
});

test('nothing happens in the last Garrison\'s sector before the quest that opens it', () => {
    // Sector 150 is shut until `last-garrison` is granted (api/_coast-admission.ts).
    // A stage there in any quest that can be reached without it would be a dead end.
    const { lines, fights } = QUEST_LINE_CATALOGUE;
    const opener = Object.values(lines).filter(line => line.rewards.unlocks?.includes(COAST_LAST_GARRISON.unlock)).map(line => line.id);
    assert.deepEqual(opener, ['crossing-war-5']);
    const sectorOf = (stage: (typeof lines)[string]['stages'][number]): number | undefined => {
        if (stage.kind === 'speak' || stage.kind === 'reach') return stage.place.sector;
        if (stage.kind === 'enter' || stage.kind === 'make' || stage.kind === 'deliver') return questBuildingPlace(stage.buildingId)?.sector;
        if (stage.kind === 'drop' || stage.kind === 'boss') return fights[stage.fightId]?.sector;
        if (stage.kind === 'gather') return coastSite(stage.siteIds[0])?.sector;
        return undefined;
    };
    const there = Object.values(lines).filter(line => line.stages.some(stage => sectorOf(stage) === COAST_LAST_GARRISON.sector));
    assert.deepEqual(there.map(line => line.id), ['the-unmoored'], 'the check still finds the quest that ends there');
    for (const line of there) assert.ok(line.gate.quests?.includes(opener[0]), `${line.id} must come after ${opener[0]}`);
});

test('ten quests carry a 20 percent chance of gear: the Crossing War and each side series\' last quest', () => {
    const lines = Object.values(QUEST_LINE_CATALOGUE.lines);
    const withChance = lines.filter(line => line.rewards.gearChanceBp !== undefined);
    assert.deepEqual(withChance.map(line => line.id).sort(), [
        'boatwright-tools-3', 'clan-gate-3', 'crossing-war-1', 'crossing-war-2', 'crossing-war-3', 'crossing-war-4', 'crossing-war-5',
        'the-unmoored', 'uncounted-3', 'untamed-coast-3',
    ]);
    for (const line of withChance) assert.equal(line.rewards.gearChanceBp, 2_000, line.id);
    // The view tells the journal the chance as a whole percent, and says nothing for a quest without one.
    const views = questLineViews({ catalogue: QUEST_LINE_CATALOGUE }, parseQuestLines({}), { level: 100, inClan: true }).lines;
    assert.equal(views.find(view => view.id === 'the-unmoored')?.gearChance, 20);
    assert.equal(Object.hasOwn(views.find(view => view.id === 'first-footing')!, 'gearChance'), false);
});

test('each Uncounted choice has a slower paper that pays more and is the harder fight', () => {
    const { lines, fights } = QUEST_LINE_CATALOGUE;
    // Before 2026-11-20 the slower paper paid a quarter more ryo for the same
    // fight, so it was simply the right answer. Now it is earned.
    for (const [questId, stageKey, slower, quicker] of [
        ['uncounted-1', 'papers', 'quay-master', 'watch-captain'],
        ['uncounted-2', 'name', 'runner', 'witness'],
        ['uncounted-3', 'pass', 'salt', 'dispatch'],
    ] as const) {
        const line = lines[questId];
        const choice = line.stages.find(stage => stage.key === stageKey);
        assert.ok(choice?.kind === 'choice', questId);
        assert.deepEqual(choice.choice.options.map(option => [option.key, option.bonusRyoPct ?? 0]), [[slower, 25], [quicker, 0]], questId);
        const boss = line.stages.at(-1) as BossStage;
        const base = fights[questStageFightId(boss, { [stageKey]: quicker })];
        const hard = fights[questStageFightId(boss, { [stageKey]: slower })];
        assert.equal(base.id, boss.fightId, questId);
        // A record with no choice sealed, as an older save could have, fights the ordinary one.
        assert.equal(questStageFightId(boss, undefined), boss.fightId, questId);
        assert.deepEqual([hard.levelOffset - base.levelOffset, hard.statBonus - base.statBonus], [1, 3], questId);
        assert.deepEqual([hard.castId, hard.sector, hard.loadoutId, questFightHolds(hard)], [base.castId, base.sector, base.loadoutId, questFightHolds(base)], questId);
    }
});

test('the finale’s sealed choice picks which of the two equal capstone relics is given', () => {
    const line = QUEST_LINE_CATALOGUE.lines['the-unmoored'];
    const deps: QuestEngineDeps = {
        catalogue: QUEST_LINE_CATALOGUE, buildingPlace: () => null, ryo: questLineRyo, tileDistance: () => 0,
        grantStatPoints: (character, points) => ({ ...character, unspentStatPoints: Number(character.unspentStatPoints ?? 0) + points }),
    };
    const view = (record: Parameters<typeof questLineViews>[1]) => questLineViews(deps, record, { level: 100, inClan: false }).lines.find(entry => entry.id === line.id)!;
    // Before the choice the journal shows both; nothing is given yet.
    assert.deepEqual(view(parseQuestLines({})).rewardArtKeys, ['coast-finale-v1', 'gear-bracer', 'gear-mantle']);
    for (const [option, relic, art] of [['open', 'coast-ridgewarden-bracer', 'gear-bracer'], ['closed', 'coast-quiet-crown-mantle', 'gear-mantle']] as const) {
        assert.ok(RELICS_BY_ID.get(relic), relic);
        const record = parseQuestLines({ v: 1, active: { [line.id]: { stage: line.stages.length, at: 1, choices: { ask: option }, took: true } }, done: {} });
        assert.deepEqual(view(record).rewardArtKeys, ['coast-finale-v1', art]);
        const paid = claimQuestLine(deps, record, { level: 95, inventory: [], itemStacks: [] }, line.id, { now: 2 });
        assert.equal(paid.ok, true, JSON.stringify(paid.body));
        assert.deepEqual(paid.body?.items, [relic]);
        assert.deepEqual([countOwned(paid.character!, 'coast-ridgewarden-bracer') + countOwned(paid.character!, 'coast-quiet-crown-mantle'), countOwned(paid.character!, relic)], [1, 1]);
        // Done: the journal keeps showing the one that was taken, and a second claim gives nothing.
        assert.deepEqual(view(paid.record!).rewardArtKeys, ['coast-finale-v1', art]);
        assert.equal(claimQuestLine(deps, paid.record!, paid.character!, line.id, { now: 3 }).body?.replayed, true);
    }
    // A full backpack refuses the claim: the relic is promised, so it is never dropped on the floor.
    const full = parseQuestLines({ v: 1, active: { [line.id]: { stage: line.stages.length, at: 1, choices: { ask: 'open' }, took: true } }, done: {} });
    assert.equal(claimQuestLine(deps, full, { level: 95, inventory: Array.from({ length: 500 }, (_, at) => `filler-${at}`) }, line.id, { now: 2 }).reason, 'inventory-full');
});

test('every region has four Rounds: no marks, a badge each, and the last waits for the region’s Crossing War quest', () => {
    const { lines, fights } = QUEST_LINE_CATALOGUE;
    assert.deepEqual(COAST_ROUND_REGIONS.map(region => region.number), [1, 2, 3, 4, 5]);
    for (const region of COAST_ROUND_REGIONS) {
        const tiers = [1, 2, 3, 4].map(tier => lines[`${region.key}-rounds-${tier}`]);
        for (const [at, line] of tiers.entries()) {
            const tier = at + 1;
            assert.deepEqual([line.kind, line.marks, line.series, line.gate.region, line.gate.clan ?? false], ['tale', 0, 'coast-rounds', region.number, false], line.id);
            assert.deepEqual(line.rewards.artKeys, [`badge-${region.key}-tier-${tier}`], line.id);
            assert.deepEqual(line.rewards.badges, [`coast-${region.key}-tier-${tier}-v1`], line.id);
            // Ryo, the badge and its achievement and, on the last tier, ten stat points. Nothing else.
            assert.deepEqual(Object.keys(line.rewards).sort(), tier === 4 ? ['artKeys', 'badges', 'statPoints', 'weight'] : ['artKeys', 'badges', 'weight'], line.id);
            if (tier > 1) assert.ok(line.gate.quests?.includes(`${region.key}-rounds-${tier - 1}`), line.id);
            // Every step is in the region itself, or at the keeper's counter the tier is taken from.
            const counter = line.stages[0].kind === 'enter' ? coastSite(line.stages[0].buildingId)?.sector : undefined;
            for (const stage of line.stages) {
                const sector = stage.kind === 'reach' ? stage.place.sector
                    : stage.kind === 'boss' ? fights[stage.fightId].sector
                        : stage.kind === 'gather' ? coastSite(stage.siteIds[0])?.sector
                            : stage.kind === 'enter' || stage.kind === 'deliver' ? coastSite(stage.buildingId)?.sector : undefined;
                assert.ok(sector !== undefined && (sector === counter || coastRegionOf(sector) === region.number), `${line.id}/${stage.key} is in sector ${sector}`);
                // No tier ever needs a tool: none of its fights carries a Hold.
                if (stage.kind === 'boss') assert.equal(fights[stage.fightId].hold, undefined, `${line.id}/${stage.key}`);
            }
        }
        assert.equal(tiers[3].gate.quests?.includes(`crossing-war-${region.number}`), true, tiers[3].id);
        // The Last Crown stays shut until the Twin Ward is broken; no tier sends a player to it.
        assert.ok(tiers.every(line => line.stages.every(stage => !(stage.kind === 'reach' && stage.place.sector === COAST_LAST_GARRISON.sector))));
    }
});

test('the side tales: two a region, short, with no tool, no marks and no right answer', () => {
    const { lines, fights } = QUEST_LINE_CATALOGUE;
    const tales = Object.values(lines).filter(line => line.series === 'coast-tales');
    assert.deepEqual([1, 2, 3, 4, 5].map(region => tales.filter(line => line.gate.region === region).length), [2, 2, 2, 2, 2]);
    const titles = new Set(Object.values(lines).map(line => line.title));
    assert.equal(titles.size, Object.keys(lines).length, 'no two lines share a title');
    for (const line of tales) {
        assert.deepEqual([line.kind, line.marks, line.gate.clan ?? false, Object.keys(line.rewards)], ['tale', 0, false, ['weight']], line.id);
        assert.ok(line.rewards.weight >= 3 && line.rewards.weight <= 5, `${line.id}: a tale pays what a Rounds tier pays`);
        assert.ok(line.stages.length >= 4 && line.stages.length <= 7, `${line.id}: ${line.stages.length} steps`);
        // It is told by a keeper, at the keeper's own place, and ends back there or with something handed over.
        const first = line.stages[0], last = line.stages.at(-1)!;
        assert.equal(first.kind, 'enter', line.id);
        assert.ok(last.kind === 'enter' || last.kind === 'deliver', `${line.id} ends at a counter`);
        for (const stage of line.stages) {
            // At most two sentences to a step.
            assert.ok((stage.text.match(/[.!?](\s|$)/g) ?? []).length <= 2, `${line.id}/${stage.key}: "${stage.text}"`);
            assert.ok(stage.kind !== 'make' && stage.kind !== 'drop', `${line.id}/${stage.key}: a tale makes no tool`);
            if (stage.kind === 'boss') assert.equal(fights[stage.fightId].hold, undefined, `${line.id}/${stage.key}`);
            if (stage.kind !== 'choice') continue;
            // Neither answer pays more or fights harder: the choice is remembered, and that is all.
            assert.equal(stage.choice.options.length, 2, `${line.id}/${stage.key}`);
            for (const option of stage.choice.options) {
                assert.deepEqual(Object.keys(option).sort(), ['blurb', 'key', 'label', 'standing'], `${line.id}/${stage.key}/${option.key}`);
                assert.match(String(option.standing), /^tale-[a-z-]+$/);
                assert.ok((option.blurb.match(/[.!?](\s|$)/g) ?? []).length <= 2, `${line.id}/${option.key}: "${option.blurb}"`);
                assert.doesNotMatch(`${option.label} ${option.blurb}`, /\b(good|evil|right|wrong|kind|cruel|mercy|merciful|honou?r)\b/i, `${line.id}/${option.key}`);
            }
        }
        // A choice is never the last step: the keeper is told what was chosen.
        assert.notEqual(last.kind, 'choice', line.id);
        // Whoever must be known first is: a tale told by a side series' keeper waits for that series.
        const giverSeries: Record<string, string> = { 'quay-defector': 'uncounted-', 'trace-keeper': 'untamed-coast-' };
        const need = giverSeries[line.giver];
        if (need) assert.ok(line.gate.quests?.some(id => id.startsWith(need)), `${line.id}: ${line.giver} has not been met yet`);
    }
    const standings = tales.flatMap(line => line.stages.flatMap(stage => (stage.kind === 'choice' ? stage.choice.options.map(option => option.standing) : [])));
    assert.equal(new Set(standings).size, standings.length, 'every answer leaves its own mark on the record');
    // Seven of the ten end in a choice; three are simply work done for a keeper.
    assert.equal(standings.length, 14);
});

// ── The script ───────────────────────────────────────────────────────────────

const allSays = (line: QuestLine): Array<{ at: string; say: QuestSay }> => [
    ...(line.scenes?.offer ?? []).map(say => ({ at: `${line.id}/offer`, say })),
    ...line.stages.flatMap(stage => (stage.say ?? []).map(say => ({ at: `${line.id}/${stage.key}`, say }))),
    ...(line.scenes?.done ?? []).map(say => ({ at: `${line.id}/done`, say })),
];

test('every quest, Round and tale is told: an offer in its keeper’s own words, and a closing scene', () => {
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        assert.ok(line.scenes?.offer.length && line.scenes.done.length, `${line.id} has no scenes`);
        // The one who offers it is the first to speak, so the goal is heard from them and not from a journal.
        assert.equal(line.scenes.offer.find(say => !say.when)?.speaker, line.giver, `${line.id}: the offer is made by its giver`);
        // A hand-written quest speaks at most of its steps; the Rounds are a list and speak only at each end.
        if (line.series === 'coast-rounds') continue;
        const spoken = line.stages.filter(stage => stage.say?.length).length;
        assert.ok(spoken >= line.stages.length - 1, `${line.id}: ${spoken} of ${line.stages.length} steps say anything`);
    }
    // The script names only quests and steps that exist, so a renamed step cannot leave its lines behind.
    for (const [id, script] of Object.entries(COAST_SCRIPT)) {
        const line = QUEST_LINE_CATALOGUE.lines[id];
        assert.ok(line, `the script has lines for ${id}, which is not a quest`);
        const keys = new Set(line.stages.map(stage => stage.key));
        for (const key of Object.keys(script.stages ?? {})) assert.ok(keys.has(key), `${id}: the script speaks at ${key}, which is not one of its steps`);
    }
});

test('every spoken line is said by someone real, and reads as speech', () => {
    let lines = 0;
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        for (const { at, say } of allSays(line)) {
            lines++;
            assert.ok(say.speaker === 'narrator' || say.speaker === 'you' || coastCastMember(say.speaker), `${at}: nobody is called ${say.speaker}`);
            assert.doesNotMatch(say.text, /quest giver|pilgrim|adventurer|chosen one|destiny|ancient evil/i, `${at}: "${say.text}"`);
            // Speech, not a rule of the game: no numbers of levels, percentages or button names.
            assert.doesNotMatch(say.text, /\blevel \d|\d+%|\bstat points?\b|\bryo\b|\bmarks?\b on your|\btap\b|\bclick\b/i, `${at}: "${say.text}"`);
            // Short sentences are still sentences. Three clipped beats in a row is the rhythm the owner rejected.
            const beats = say.text.split(/(?<=[.!?])\s+/).map(sentence => sentence.split(/\s+/).filter(Boolean).length);
            for (let i = 0; i + 2 < beats.length; i++) {
                assert.ok(!(beats[i] <= 3 && beats[i + 1] <= 3 && beats[i + 2] <= 3), `${at}: three clipped beats in a row: "${say.text}"`);
            }
            // No invented hyphenated compounds: the only hyphen a line may carry is in a real, established name.
            for (const compound of say.text.match(/\b[a-z]+-[a-z]+\b/g) ?? []) assert.fail(`${at}: "${compound}" is a hyphenated compound; say it in plain words`);
        }
    }
    assert.ok(lines > 400, `the check read ${lines} lines`);
});

test('what a player chose is said back to them, by a line that points at a real choice', () => {
    const { lines } = QUEST_LINE_CATALOGUE;
    const standings = new Set(Object.values(lines).flatMap(line => line.stages.flatMap(stage => (stage.kind === 'choice' ? stage.choice.options.map(option => option.standing) : []))).filter(Boolean));
    const answered = new Set<string>();
    for (const line of Object.values(lines)) {
        for (const { at, say } of allSays(line)) {
            for (const standing of [say.when?.standing, say.when?.without]) {
                if (standing === undefined) continue;
                assert.ok(standings.has(standing), `${at}: no choice anywhere leaves the standing ${standing}`);
                answered.add(standing);
            }
            for (const id of [say.when?.finished, say.when?.unfinished]) if (id !== undefined) assert.ok(lines[id], `${at}: ${id} is not a quest`);
        }
    }
    // Every choice that is remembered is heard again somewhere: in the same quest's
    // last lines, in a later quest, or read aloud from the record before the finale.
    for (const line of Object.values(lines)) {
        for (const stage of line.stages) {
            if (stage.kind !== 'choice' || stage.choice.answer !== undefined) continue;
            for (const option of stage.choice.options) {
                const inQuest = allSays(line).some(({ say }) => say.when?.chose?.[0] === stage.key && say.when.chose[1] === option.key);
                const later = option.standing !== undefined && answered.has(option.standing);
                assert.ok(inQuest || later, `${line.id}/${stage.key}: nobody ever speaks of choosing ${option.key}`);
            }
        }
    }
    // Before the finale the Record House keeper reads the player's record aloud:
    // one line for whichever way each of these went, never both.
    const read = lines['the-unmoored'].stages.find(stage => stage.key === 'record')!.say!;
    for (const [one, other] of [
        ['tale-letter-carried', 'tale-letter-kept'], ['tale-ledge-marked', 'tale-ledge-unmarked'], ['tale-runner-witnessed', 'tale-runner-unwritten'],
        ['tale-docket-brought', 'tale-docket-returned'], ['tale-bell-answered', 'tale-bell-silent'],
        // The two decisions made on the way up the coast (The Crossing War I and IV).
        ['tide-tallies-carried', 'tide-tallies-left'], ['rime-sentry-warmed', 'rime-sentry-passed'],
    ]) {
        for (const standing of [one, other]) assert.equal(read.filter(say => say.when?.standing === standing).length, 1, standing);
        const heard = (mine: string[]) => questSaysHeard(read, { standings: new Set(mine), done: {} }).length;
        assert.deepEqual([heard([one]) - heard([]), heard([other]) - heard([]), heard([])], [1, 1, 2], `${one} or ${other}`);
    }
});

test('a question has one right answer, a wrong one is answered in the world, and nothing is remembered', () => {
    const deps = { catalogue: QUEST_LINE_CATALOGUE } as QuestEngineDeps;
    const questions = Object.values(QUEST_LINE_CATALOGUE.lines).flatMap(line => line.stages.flatMap((stage, index) => (stage.kind === 'choice' && stage.choice.answer !== undefined ? [{ line, stage, index }] : [])));
    assert.deepEqual(questions.map(({ line, stage }) => `${line.id}/${stage.key}`), ['shuttered-boat/knots', 'crossing-war-3/knot', 'crossing-war-5/order', 'uncounted-3/match']);
    for (const { line, stage, index } of questions) {
        const at = `${line.id}/${stage.key}`;
        const record = parseQuestLines({ v: 1, active: { [line.id]: { stage: index, at: 5 } }, done: {} });
        const wrongKey = stage.choice.options.find(option => option.key !== stage.choice.answer)!.key;
        const wrong = chooseQuestLineOption(deps, record, line.id, wrongKey, { now: 9 });
        assert.deepEqual([wrong.ok, wrong.reason, wrong.body?.error], [false, 'wrong-answer', stage.choice.wrong], at);
        const back = stage.choice.backTo === undefined ? index : line.stages.findIndex(candidate => candidate.key === stage.choice.backTo);
        // Sent back to read the clue again where the quest says so; otherwise the step simply stands.
        assert.equal(wrong.record?.active[line.id].stage ?? index, back, at);
        const right = chooseQuestLineOption(deps, record, line.id, stage.choice.answer!, { now: 9 });
        assert.deepEqual([right.ok, right.record?.active[line.id].stage, right.record?.active[line.id].choices], [true, index + 1, undefined], `${at}: a right answer is not a choice to remember`);
        // The clue is said at the step, or the step it sends back to says it; the options never mark the right one.
        const clueAt = stage.choice.backTo === undefined ? stage : line.stages[back];
        assert.ok(clueAt.say?.length, `${at}: the clue is said nowhere`);
        assert.doesNotMatch(JSON.stringify(stage.choice.options), /\b(right|correct|answer)\b/i, at);
    }
});

test('the Crossing War walks the coast one region at a time, each Hold broken by its own tool', () => {
    const { lines, fights, recipes } = QUEST_LINE_CATALOGUE;
    const war = ['crossing-war-1', 'crossing-war-2', 'crossing-war-3', 'crossing-war-4'].map(id => lines[id]);
    assert.deepEqual(war.map(line => [line.gate.level, line.gate.region, line.marks, line.rewards.opensRegion]), [[77, 1, 2, 2], [80, 2, 2, 3], [85, 3, 3, 4], [90, 4, 3, 5]]);
    assert.deepEqual(war.slice(1).map(line => line.gate.quests), [['crossing-war-1'], ['crossing-war-2'], ['crossing-war-3']], 'each needs the one before it');
    const holdOf = (line: typeof war[number]) => {
        const last = line.stages[line.stages.length - 1];
        return last.kind === 'boss' ? fights[last.fightId].hold : undefined;
    };
    assert.deepEqual(war.map(holdOf), [
        { breakerItemId: 'quest-woundroot-vial', name: 'Bitter Tide' },
        { breakerItemId: 'quest-clouding-ink', name: 'Mirror Hold' },
        { breakerItemId: 'quest-pact-cutter-snare', name: 'Beast Bond' },
        { breakerItemId: 'quest-ember-senbon', name: 'Rime Lock' },
    ]);
    // Every tool is made from coast materials only, so none can be made from home stock.
    for (const recipe of [recipes['clouding-ink'], recipes['pact-cutter-snare'], recipes['ember-senbon']]) {
        assert.ok(recipe.inputs.every(input => questItem(input.itemId)?.kind === 'material'), recipe.id);
        assert.equal(questItem(recipe.output.itemId)?.kind, 'tool');
    }
    // A quest's steps stay inside the regions its gate has opened.
    for (const line of war) {
        for (const stage of line.stages) {
            if (stage.kind === 'choice') continue; // decided in the player's head, wherever they stand
            const sector = stage.kind === 'enter' || stage.kind === 'make' || stage.kind === 'deliver' ? questBuildingPlace(stage.buildingId)?.sector
                : stage.kind === 'reach' || stage.kind === 'speak' ? stage.place.sector
                : stage.kind === 'gather' ? coastSite(stage.siteIds[0])?.sector
                : fights[stage.kind === 'drop' || stage.kind === 'boss' ? stage.fightId : '']?.sector;
            assert.ok(sector !== undefined && coastRegionOf(sector) >= 1 && coastRegionOf(sector) <= (line.gate.region ?? 0), `${line.id}/${stage.key} is in sector ${sector}`);
        }
    }
});

test('the coast opens at level 75, and every quest’s gate sits inside the level band of the region it opens in', () => {
    // Owner, 2026-11-21: "increase the level to come to this map from 50 to 75 and rescale everything accordingly".
    assert.equal(COAST_MIN_LEVEL, 75);
    assert.deepEqual(COAST_REGION_LEVELS, [[75, 80], [80, 85], [85, 90], [90, 95], [95, 100]]);
    assert.equal(COAST_REGION_LEVELS[0][0], COAST_MIN_LEVEL, 'the first region begins where the coast opens');
    COAST_REGION_LEVELS.forEach((band, index) => {
        assert.equal(band[1] > band[0], true);
        if (index > 0) assert.equal(band[0], COAST_REGION_LEVELS[index - 1][1], 'each band begins where the last one ends');
    });
    for (const line of Object.values(QUEST_LINE_CATALOGUE.lines)) {
        assert.ok(line.gate.level >= COAST_MIN_LEVEL, `${line.id}: no quest of the coast is offered below level ${COAST_MIN_LEVEL}`);
        if (line.gate.region === undefined) { assert.equal(line.world, 'home', line.id); continue; }
        const [low, high]: readonly [number, number] = COAST_REGION_LEVELS[line.gate.region - 1];
        assert.ok(line.gate.level >= low && line.gate.level <= high, `${line.id}: gate ${line.gate.level} is outside region ${line.gate.region}'s band ${low} to ${high}`);
    }
    // The main line climbs: each quest asks for at least the level of the one before it.
    const main = ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2', 'crossing-war-3', 'crossing-war-4', 'crossing-war-5', 'the-unmoored'].map(id => QUEST_LINE_CATALOGUE.lines[id].gate.level);
    assert.deepEqual(main, [75, 75, 77, 80, 85, 90, 95, 98]);
    // The two gates on the Coast Record moved with the levels (owner: "rescale the marks too"): 20 and 28 became 16 and 22.
    // The main line alone reaches neither, so the side series still have to be walked, and both are reachable without a clan.
    const lines = QUEST_LINE_CATALOGUE.lines;
    assert.deepEqual([lines['crossing-war-5'].gate.marks, lines['the-unmoored'].gate.marks], [16, 22]);
    const mainMarks = (through: number) => ['shuttered-boat', 'first-footing', 'crossing-war-1', 'crossing-war-2', 'crossing-war-3', 'crossing-war-4', 'crossing-war-5'].slice(0, through).reduce((sum, id) => sum + lines[id].marks, 0);
    assert.deepEqual([mainMarks(6), mainMarks(7)], [12, 16]);
    assert.ok(mainMarks(6) < 16 && mainMarks(7) < 22);
    assert.ok(reachableQuestLines(lines, { withClan: false }).ids.has('the-unmoored'));
});

test('each of the first four Crossing War quests turns partway through, and no two turn the same way', () => {
    const { lines, fights } = QUEST_LINE_CATALOGUE;
    const stagesOf = (id: string) => lines[id].stages;
    const at = (id: string, key: string) => stagesOf(id).findIndex(stage => stage.key === key);
    const heard = (id: string, where: 'done' | string, choices: Record<string, string>) =>
        questSaysHeard(where === 'done' ? lines[id].scenes!.done : stagesOf(id)[at(id, where)].say, { standings: new Set(), choices, done: {} }).map(say => say.text);
    const kinds = (id: string) => stagesOf(id).map(stage => stage.kind);
    const middle = (id: string) => kinds(id).slice(1, -1);

    // I. A decision, and an errand it sends the player on: back to the keeper before the commander.
    assert.deepEqual(stagesOf('crossing-war-1').slice(-4).map(stage => stage.key), ['yard', 'tallies', 'count', 'commander']);
    // II. A plan that fails: a plain fight at the cache, with no Hold, before the adept is reached.
    const couriers = stagesOf('crossing-war-2')[at('crossing-war-2', 'couriers')];
    assert.ok(couriers.kind === 'boss' && at('crossing-war-2', 'couriers') === at('crossing-war-2', 'cache') + 1);
    if (couriers.kind === 'boss') assert.deepEqual([fights[couriers.fightId].hold, fights[couriers.fightId].sector, fights[couriers.fightId].forms], [undefined, 119, undefined]);
    assert.equal(middle('crossing-war-2').includes('choice'), false);
    // III. A question with a way back: the knot is read on the hoist, the last clue in the garrison, and asked
    // for outside it. A wrong answer sends the player back up to the hoist only.
    const knot = stagesOf('crossing-war-3')[at('crossing-war-3', 'knot')];
    assert.ok(knot.kind === 'choice' && knot.choice.answer === 'through' && knot.choice.backTo === 'yard');
    assert.deepEqual(knot.kind === 'choice' ? knot.choice.forget : null, ['hoist']);
    assert.equal(at('crossing-war-3', 'snare'), at('crossing-war-3', 'knot') + 1, 'the knot is settled before the snare is tied');
    const yard = stagesOf('crossing-war-3')[at('crossing-war-3', 'yard')];
    const hoistClue = yard.kind === 'enter' ? yard.clues?.find(clue => clue.key === 'hoist') : undefined;
    assert.match(hoistClue?.say?.[0].text ?? '', /back through the first turn/, 'the hoist is where the knot is read');
    assert.doesNotMatch(JSON.stringify(yard.say), /back through|over the ring/, 'arriving at the garrison does not give it away');
    assert.doesNotMatch(JSON.stringify(knot.say), /back through|over the ring/, 'the step that asks does not say the knot again');
    // IV. A decision with nothing to carry: made on the saddle, between the watch and the gate.
    assert.deepEqual(stagesOf('crossing-war-4').slice(-4).map(stage => stage.key), ['saddle', 'sentry', 'chain', 'warden']);
    assert.equal(middle('crossing-war-1').includes('boss') || middle('crossing-war-3').includes('boss') || middle('crossing-war-4').includes('boss'), false);

    // The two decisions pay nothing and change no fight. They are remembered, and that is all.
    for (const [id, key, one, other] of [['crossing-war-1', 'tallies', 'carry', 'leave'], ['crossing-war-4', 'sentry', 'warm', 'pass']] as const) {
        const stage = stagesOf(id)[at(id, key)];
        assert.ok(stage.kind === 'choice' && stage.choice.answer === undefined);
        if (stage.kind !== 'choice') continue;
        for (const option of stage.choice.options) assert.deepEqual(Object.keys(option).sort(), ['blurb', 'key', 'label', 'standing'], `${id}/${option.key}`);
        const boss = stagesOf(id).at(-1)!;
        assert.ok(boss.kind === 'boss' && boss.fightByChoice === undefined, `${id}: the same fight either way`);
        // The foe says which way it went before the fight, and the keeper after it: one line each, never the other's.
        for (const where of [boss.key, 'done']) {
            const [mine, theirs, neither] = [heard(id, where, { [key]: one }), heard(id, where, { [key]: other }), heard(id, where, {})];
            assert.equal(mine.length, neither.length + 1, `${id}/${where}/${one}`);
            assert.equal(theirs.length, neither.length + 1, `${id}/${where}/${other}`);
            assert.equal(mine.some(text => theirs.includes(text) && !neither.includes(text)), false, `${id}/${where}: each answer has its own line`);
        }
    }
    // The errand in Bitter Tide is where the keeper answers the decision: two lines for either way, none without one.
    assert.deepEqual([heard('crossing-war-1', 'count', { tallies: 'carry' }).length, heard('crossing-war-1', 'count', { tallies: 'leave' }).length, heard('crossing-war-1', 'count', {}).length], [2, 2, 0]);
    // And each is heard again in the quest that follows: one line in its offer for whichever way it went.
    for (const [next, one, other] of [['crossing-war-2', 'tide-tallies-carried', 'tide-tallies-left'], ['crossing-war-5', 'rime-sentry-warmed', 'rime-sentry-passed']] as const) {
        const offer = (mine: string[]) => questSaysHeard(lines[next].scenes!.offer, { standings: new Set(mine), done: {} }).length;
        assert.deepEqual([offer([one]) - offer([]), offer([other]) - offer([])], [1, 1], next);
    }
});

test('a quest stage can name a building on either map and gets its entrance', () => {
    // North Docks duty house on the home map; the Record House on the coast.
    assert.deepEqual(questBuildingPlace('stronghold-2'), { sector: 2, tile: 100, radius: 1 });
    assert.deepEqual(questBuildingPlace('saltstair-counter-105'), { sector: 105, tile: 56, radius: 1 });
    assert.equal(questBuildingPlace('no-such-place'), null);
});

test('quest-line ryo follows the Quest Book curve, with a higher weight ceiling', () => {
    for (const level of [1, 50, 100]) {
        for (const weight of [1, 8, 20]) assert.equal(questLineRyo(level, weight), questBookRyo(level, weight));
    }
    assert.equal(questLineRyo(50, 40), 40 * (40 + 50 * 5));
    assert.equal(questLineRyo(50, 400), questLineRyo(50, 40), 'weight is capped');
    assert.equal(questLineRyo(999, 10), questLineRyo(100, 10), 'level is capped');
});

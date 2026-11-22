/*
 * The quest-line catalogue: every quest, its recipes and its fights.
 *
 * Server-only and free of side effects. The client is sent a projection
 * (questLineViews in _engine.ts), so there is no hand-kept copy to drift, and
 * the narrative audit and the story PDF can import this file directly.
 *
 * Rules every entry must pass live in _catalog-rules.ts and run in
 * _catalog.test.ts: stage counts, a gather and a make-or-drop stage for coast
 * quests, a Hold on the final boss that names a tool the quest produces, and
 * no quest stranded behind a clan.
 *
 * Every coast stage names a place the coast's art painted, by the site id in
 * shared/coast-world.json. Home-map stages name buildings from
 * shared/sector-buildings.ts.
 *
 * Names, weights and reward amounts were settled 2026-11-20 (see the note on
 * questLineRyo below). Player-facing text follows the story's rules: whole
 * short sentences, no dash pauses, "level 75 or higher".
 */
import { isQuestOnlyItem } from '../../shared/quest-items.js';
import { isKeptQuestMaterial } from '../../shared/quest-sites.js';
import { QUEST_LINE_TITLES } from '../../shared/quest-line-titles.js';
import type { QuestLineCatalogue } from './_catalog-rules.js';
import { COAST_ROUND_FIGHTS, COAST_ROUND_LINES } from './_coast-rounds.js';
import { COAST_TALE_FIGHTS, COAST_TALE_LINES } from './_coast-tales.js';
import { COAST_SCRIPT } from './_coast-script.js';
import { withCoastBossForms } from './_coast-boss-forms.js';
import { QUEST_GEAR_CHANCE_BP } from './_gear.js';
import type { QuestLine, QuestLineFight, QuestLineRecipe } from './_types.js';

/** Western Piers duty house on the home map: the boatwright works from its counter. */
const BOATWRIGHT_HOUSE = 'stronghold-7';
/** Coast sites, as the art pack named them. */
const SLIP = 'saltstair-dock-101';
const RECORD_HOUSE = 'saltstair-counter-105';
const GARRISON = 'saltstair-fort-107';
const CLAN_PLOT = 'saltstair-plot-108';
const TIDE_STEPS = 'brackwater-landing-111';
const INKSEED_BED = 'brackwater-harvest-112';
const RELAY_HOUSE = 'brackwater-counter-113';
const MIRROR_POOL = 'brackwater-outcrop-114';
const COURIER_CACHE = 'brackwater-tracks-119';
const HOLLOW_SENTINEL = 'brackwater-tree-120';
const BINDING_THORN = 'briarwood-harvest-125';
const LEASH_GARRISON = 'briarwood-fort-126';
const SUNDERED_TETHER = 'briarwood-outcrop-128';
const EMBERGLASS_SEAM = 'whitecrown-outcrop-133';
const ASSAY_HOUSE = 'whitecrown-counter-136';
const RIME_GATEHOUSE = 'whitecrown-fort-138';
const FROST_WITNESS = 'whitecrown-outcrop-139';
const DEFECTOR_QUAY = 'brackwater-dock-116';
const WATCH_POST = 'brackwater-counter-118';
const WITNESS_SHRINE = 'briarwood-counter-122';
const CHRONICLE_RUIN = 'briarwood-counter-124';
const COURIER_CLEFT = 'whitecrown-tracks-132';
const PASS_RECORD_HOUSE = 'whitecrown-counter-134';
const DISPATCH_CAIRN = 'whitecrown-tracks-140';
const WITNESS_BELL = 'hushcrown-shrine-141';
const WINDROOT_BED = 'hushcrown-harvest-142';
const SILVER_SEAM = 'hushcrown-mine-143';
const REMAKERS_WORKSHOP = 'hushcrown-counter-144';
const STILLWATER_SHELF = 'hushcrown-fish-145';
const KEELROOT_MARKER = 'hushcrown-tracks-147';
const TWIN_WARD_POST = 'hushcrown-fort-148';
const THREEFOLD_TRACE = 'hushcrown-tracks-149';
const HUSHCROWN_GARRISON = 'hushcrown-fort-150';
const HOUND_TRACE = 'saltstair-tracks-109';
const HIGH_SILL = 'saltstair-outcrop-110';
const ANTLERWASH_FORD = 'briarwood-tracks-121';
const SCENT_STONE = 'briarwood-tracks-130';
const IBEX_SCRAPE = 'whitecrown-tracks-131';
const WIND_COLLAR = 'whitecrown-tracks-137';

export const QUEST_LINES: Readonly<Record<string, QuestLine>> = {
    // 1. The way in. Home map, level 75. Finishing it makes the boat sail.
    'shuttered-boat': {
        id: 'shuttered-boat', series: 'crossing', kind: 'quest', world: 'home', tier: 2,
        title: 'The Shuttered Boat', marks: 1, giver: 'wandering-sage',
        gate: { level: 75 },
        stages: [
            { key: 'find', kind: 'enter', buildingId: BOATWRIGHT_HOUSE, text: 'Find the boatwright at the Western Piers duty house.' },
            { key: 'cord', kind: 'deliver', buildingId: BOATWRIGHT_HOUSE, itemId: 'gather-binding-fiber', count: 8, text: 'Bring the boatwright 8 Binding Fiber for the rigging.' },
            { key: 'fittings', kind: 'deliver', buildingId: BOATWRIGHT_HOUSE, itemId: 'gather-iron-sand', count: 8, text: 'Bring the boatwright 8 Iron Sand for the fittings.' },
            { key: 'shadow', kind: 'reach', place: { sector: 5 }, text: 'Shadow the chart runner to Reedmarsh Boardwalk.' },
            { key: 'tally', kind: 'drop', fightId: 'runner-lookouts', itemId: 'quest-runner-tally', count: 1, text: "Defeat the runner's lookouts and take his tally." },
            { key: 'shards', kind: 'make', buildingId: BOATWRIGHT_HOUSE, recipeId: 'signal-shard', text: 'Make Signal Shards at the boatwright’s counter from 2 Stormglass Shard and 2 Binding Fiber. Stormglass is mined from stormglass seams, with a pickaxe and mining skill 4.' },
            // A question, not a decision: the knots say where he is going, and the
            // journal does not. A wrong reading costs nothing but the next guess.
            { key: 'knots', kind: 'choice', text: 'Read the runner’s tally and say where he stops next.', choice: {
                prompt: 'Three knots, tied in the order he walks. Where is he going?',
                answer: 'terraces', wrong: 'Funade shakes his head. “He has been there already. Look at the knots again.”',
                options: [
                    { key: 'boardwalk', label: 'Tell him the Reedmarsh Boardwalk', blurb: 'The knot wound with reed.' },
                    { key: 'piers', label: 'Tell him the Western Piers', blurb: 'The knot stiff with tar.' },
                    { key: 'terraces', label: 'Tell him the Upper Terraces', blurb: 'The knot with clay in it.' },
                ] } },
            { key: 'follow', kind: 'reach', place: { sector: 3 }, text: 'Follow the tally to the place its last knot names.' },
            { key: 'runner', kind: 'boss', fightId: 'chart-runner', text: 'Throw a Signal Shard to break the runner’s Smoke Hold, then take the charts.' },
            { key: 'return', kind: 'enter', buildingId: BOATWRIGHT_HOUSE, text: 'Bring the charts back to the boatwright.' },
        ],
        rewards: { badges: ['coast-crossing-v1'], weight: 10, statPoints: 20, title: QUEST_LINE_TITLES.shutteredBoat, opensRegion: 1, unlocks: ['boat'] },
    },

    // 2. Saltstair Landing. The first Hold on the coast.
    'first-footing': {
        id: 'first-footing', series: 'crossing', kind: 'quest', world: 'coast', tier: 1,
        title: 'First Footing', marks: 1, giver: 'slip-boatwright',
        gate: { level: 75, quests: ['shuttered-boat'], region: 1 },
        stages: [
            { key: 'slip', kind: 'enter', buildingId: SLIP, text: 'Hear the boatwright out at the Saltstair slip.' },
            { key: 'mark', kind: 'enter', buildingId: GARRISON, text: 'Plant your mark on the garrison gate.' },
            { key: 'seal', kind: 'drop', fightId: 'garrison-patrol', itemId: 'quest-garrison-seal', count: 1, text: 'Defeat an Unmoored patrol and lift its seal.' },
            { key: 'cord', kind: 'gather', itemId: 'quest-wrack-cord', count: 6, siteIds: ['saltstair-harvest-102'], text: 'Harvest 6 Wrack Cord at Wrack Strand. You need a kama.' },
            { key: 'order', kind: 'make', buildingId: RECORD_HOUSE, recipeId: 'stand-down-order', text: 'Forge a Stand-Down Order at the Record House.' },
            { key: 'captain', kind: 'boss', fightId: 'gate-captain', text: 'Show the order to break the gate captain’s Oath Guard.' },
        ],
        rewards: { weight: 8, statPoints: 10, title: QUEST_LINE_TITLES.firstFooting },
    },

    // 3. The Crossing War I. Opens Brackwater Fields and the right to contest land.
    'crossing-war-1': {
        id: 'crossing-war-1', series: 'crossing-war', kind: 'quest', world: 'coast', tier: 2,
        title: 'The Crossing War: Bitter Tide', marks: 2, giver: 'record-keeper',
        gate: { level: 77, quests: ['first-footing'], region: 1 },
        stages: [
            { key: 'ask', kind: 'enter', buildingId: RECORD_HOUSE, text: 'Ask the Record House keeper what the garrison commander drinks.' },
            { key: 'roots', kind: 'gather', itemId: 'quest-woundroot', count: 8, siteIds: ['saltstair-harvest-106'], text: 'Harvest 8 Woundroot at Woundroot Bank. You need a kama.' },
            { key: 'caps', kind: 'gather', itemId: 'quest-splitstone-fittings', count: 4, siteIds: ['saltstair-mine-103'], text: 'Mine 4 Splitstone Fittings at Splitstone Seam. You need a pickaxe.' },
            { key: 'vial', kind: 'make', buildingId: RECORD_HOUSE, recipeId: 'woundroot-vial', text: 'Boil the roots down into Woundroot Vials at the Record House.' },
            { key: 'yard', kind: 'enter', buildingId: GARRISON, text: 'Slip into the garrison yard and study the command table.' },
            // The quest's turn: what is on the table is not what the player came for, and
            // it is theirs to carry out or leave. Neither way pays more or fights harder.
            // The commander, the keeper and the finale's record each say which it was.
            { key: 'tallies', kind: 'choice', text: 'Decide what to do with the cut tally bundles on the command table.', choice: { prompt: 'The cut bundles lie on his table. What do you do with them?', options: [
                { key: 'carry', label: 'Carry the cut bundles out to the Record House', blurb: 'He will know his table was read. The record will know who was cut.', standing: 'tide-tallies-carried' },
                { key: 'leave', label: 'Leave the bundles where they lie', blurb: 'He will not know you were here. Neither will anyone else.', standing: 'tide-tallies-left' },
            ] } },
            { key: 'count', kind: 'enter', buildingId: RECORD_HOUSE, text: 'Tell the Record House keeper what is on the commander’s table.' },
            { key: 'commander', kind: 'boss', fightId: 'garrison-commander', text: 'Throw a Woundroot Vial to break the commander’s Bitter Tide.' },
        ],
        rewards: { weight: 12, statPoints: 20, gearChanceBp: QUEST_GEAR_CHANCE_BP, fateShards: 1, title: QUEST_LINE_TITLES.crossingWar1, opensRegion: 2, unlocks: ['contest-land'] },
    },

    // 4. The Crossing War II. Brackwater Fields, level 80. Opens Briarwood Deep.
    'crossing-war-2': {
        id: 'crossing-war-2', series: 'crossing-war', kind: 'quest', world: 'coast', tier: 2,
        title: 'The Crossing War: Mirror Hold', marks: 2, giver: 'relay-keeper',
        gate: { level: 80, quests: ['crossing-war-1'], region: 2 },
        stages: [
            { key: 'relay', kind: 'enter', buildingId: RELAY_HOUSE, text: 'Ask the Relay House keeper why no jutsu lands on the adept at Glasswake Shelf.' },
            { key: 'steps', kind: 'enter', buildingId: TIDE_STEPS, text: 'Read the scorch marks at the Tide-cut Steps, where a patrol’s own jutsu came back at it.' },
            { key: 'seed', kind: 'gather', itemId: 'quest-inkseed', count: 8, siteIds: [INKSEED_BED], text: 'Harvest 8 Inkseed at the Inkseed Bed. You need a kama.' },
            { key: 'silt', kind: 'gather', itemId: 'quest-mirror-silt', count: 4, siteIds: [MIRROR_POOL], text: 'Mine 4 Mirror Silt at the rim of the Mirror Pool. You need a pickaxe.' },
            { key: 'ink', kind: 'make', buildingId: RELAY_HOUSE, recipeId: 'clouding-ink', text: 'Grind Clouding Ink at the Relay House ink basin.' },
            { key: 'cache', kind: 'enter', buildingId: COURIER_CACHE, text: 'Shadow the adept’s courier to the Courier’s Cache and learn when she stands alone.' },
            // The quest's turn: the plan fails. The packet was bait, and the player has to
            // fight their way out of the cache before the adept is ever reached. A plain
            // fight with no Hold, so it needs no tool and spends none.
            { key: 'couriers', kind: 'boss', fightId: 'shelf-couriers', text: 'You were seen. Defeat the couriers at the cache before they carry word of you up to the shelf.' },
            { key: 'adept', kind: 'boss', fightId: 'glasswake-adept', text: 'Throw Clouding Ink to break the adept’s Mirror Hold.' },
        ],
        rewards: { weight: 14, statPoints: 25, gearChanceBp: QUEST_GEAR_CHANCE_BP, boneCharms: 1, title: QUEST_LINE_TITLES.crossingWar2, opensRegion: 3 },
    },

    // 5. The Crossing War III. Briarwood Deep, level 85. Opens Whitecrown Passes.
    'crossing-war-3': {
        id: 'crossing-war-3', series: 'crossing-war', kind: 'quest', world: 'coast', tier: 3,
        title: 'The Crossing War: Beast Bond', marks: 3, giver: 'sentinel-warden',
        gate: { level: 85, quests: ['crossing-war-2'], region: 3 },
        stages: [
            // Three floors of the cedar, one clue on each, found in order. The crown shows which strand of a
            // living knot lets the ring go. That is what the player watches for at the garrison.
            { key: 'sentinel', kind: 'enter', buildingId: HOLLOW_SENTINEL, text: 'Climb the Hollow Sentinel. Read the split ward, find its missing half and fit the two together in the crown.', clues: [
                { key: 'ward', floor: 0, station: 'Read the split ward' },
                { key: 'clappers', floor: 1, station: 'Sound the hanging clappers' },
                { key: 'crown', floor: 2, station: 'Fit the ward into the living knot' },
            ] },
            { key: 'collar', kind: 'enter', buildingId: SUNDERED_TETHER, text: 'Study the sundered tether at the Broken Collar. Something cut a tamer’s bond here once.' },
            { key: 'thorn', kind: 'gather', itemId: 'quest-binding-thorn', count: 8, siteIds: [BINDING_THORN], text: 'Harvest 8 Binding Thorn at Briar Spindle. You need a kama and harvesting skill 4.' },
            { key: 'links', kind: 'gather', itemId: 'quest-tether-link', count: 4, siteIds: [SUNDERED_TETHER], text: 'Mine 4 Tether Links from the sundered tether. You need a pickaxe and mining skill 4.' },
            { key: 'yard', kind: 'enter', buildingId: LEASH_GARRISON, text: 'Slip into the Leash Garrison. Find the strand that returns in the feeding hall and follow it up to the hoist.', clues: [
                { key: 'block', floor: 0, station: 'Study the tether block' },
                { key: 'hoist', floor: 1, station: 'Trace the tamer’s knot' },
            ] },
            // The quest's turn: the braid is seen once, on the hoist, and has to be carried out in the player's
            // head. A wrong knot sends them back up to the hoist to look again. What they found in the hall, and
            // in the cedar, stays found.
            { key: 'knot', kind: 'choice', text: 'Fix the tamer’s knot in your mind before you tie it yourself.', choice: {
                prompt: 'How was the braid on the hoist tied?',
                answer: 'through', backTo: 'yard', forget: ['hoist'], wrong: 'You try it on a scrap of cord and it slips. That is not his knot. Go back up to the hoist and look again.',
                options: [
                    { key: 'twice', label: 'Tie it twice over the ring and drawn tight', blurb: 'The tail cut short.' },
                    { key: 'through', label: 'Tie it over the ring, under itself and back through', blurb: 'The tail left long.' },
                    { key: 'open', label: 'Tie it under the ring and leave the turn open', blurb: 'The tail tucked in.' },
                ] } },
            { key: 'snare', kind: 'make', buildingId: SUNDERED_TETHER, recipeId: 'pact-cutter-snare', text: 'Tie Pact-Cutter Snares on the old tether post, in the tamer’s own knot.' },
            { key: 'mere', kind: 'reach', place: { sector: 127 }, text: 'Shadow the tamer’s beast to Stillfang Mere and learn how far it strays from him.' },
            { key: 'tamer', kind: 'boss', fightId: 'leash-tamer', text: 'Throw a Pact-Cutter Snare to break the tamer’s Beast Bond.' },
        ],
        rewards: { weight: 16, statPoints: 30, gearChanceBp: QUEST_GEAR_CHANCE_BP, fateShards: 1, auraStones: 1, title: QUEST_LINE_TITLES.crossingWar3, opensRegion: 4 },
    },

    // 6. The Crossing War IV. Whitecrown Passes, level 90. Opens Hushcrown Heights.
    'crossing-war-4': {
        id: 'crossing-war-4', series: 'crossing-war', kind: 'quest', world: 'coast', tier: 3,
        title: 'The Crossing War: Rime Lock', marks: 3, giver: 'assay-keeper',
        gate: { level: 90, quests: ['crossing-war-3'], region: 4 },
        stages: [
            { key: 'assay', kind: 'enter', buildingId: ASSAY_HOUSE, text: 'Ask the assayer at the Ember Assay House what keeps the Rime Gate shut.' },
            { key: 'gate', kind: 'enter', buildingId: RIME_GATEHOUSE, text: 'Scout the Rime Gatehouse and mark the seams in the warden’s frost plates.' },
            { key: 'glass', kind: 'gather', itemId: 'quest-emberglass', count: 8, siteIds: [EMBERGLASS_SEAM], text: 'Mine 8 Emberglass at the Emberglass Seam. You need a pickaxe and mining skill 4.' },
            { key: 'splinter', kind: 'gather', itemId: 'quest-frost-splinter', count: 6, siteIds: [FROST_WITNESS], text: 'Mine 6 Frost Splinters from the Frost Witness. You need a pickaxe and mining skill 4.' },
            { key: 'senbon', kind: 'make', buildingId: ASSAY_HOUSE, recipeId: 'ember-senbon', text: 'Tip Ember Senbon at the Assay House, under the assay cap.' },
            { key: 'saddle', kind: 'reach', place: { sector: 137 }, text: 'Shadow the relief watch across the Listening Saddle and learn when the gate stands thin.' },
            // The quest's turn: the watch has left one of its own behind, and the player is
            // the only one who knows. Neither way pays more or fights harder. The warden,
            // the assayer, the next quest's keeper and the finale's record each say which it was.
            { key: 'sentry', kind: 'choice', text: 'Decide what to do about the boy the watch left in the rock hollow.', choice: { prompt: 'He has not seen you. What do you do?', options: [
                { key: 'warm', label: 'Stop and lay him a fire in the hollow', blurb: 'He will live to say a stranger passed. The watch will see the smoke.', standing: 'rime-sentry-warmed' },
                { key: 'pass', label: 'Go by him while his head is down', blurb: 'Nobody will know you crossed. The relief is an hour behind.', standing: 'rime-sentry-passed' },
            ] } },
            { key: 'chain', kind: 'enter', buildingId: RIME_GATEHOUSE, text: 'Slip back to the Rime Gatehouse while the watch changes.' },
            { key: 'warden', kind: 'boss', fightId: 'rime-warden', text: 'Throw an Ember Senbon to break the warden’s Rime Lock.' },
        ],
        rewards: { weight: 18, statPoints: 40, gearChanceBp: QUEST_GEAR_CHANCE_BP, fateShards: 1, boneCharms: 1, title: QUEST_LINE_TITLES.crossingWar4, opensRegion: 5 },
    },

    // 7. The Crossing War V. Hushcrown Heights, level 95, and 16 marks on the
    // Coast Record: the side series must be walked first. Two Holds in sequence
    // (owner ruling 2026-11-19): the Twin Ward is a Bitter Tide over a Mirror
    // Hold, and both tools are remade at the Remakers' workshop.
    'crossing-war-5': {
        id: 'crossing-war-5', series: 'crossing-war', kind: 'quest', world: 'coast', tier: 4,
        title: 'The Crossing War: Twin Ward', marks: 4, giver: 'record-keeper',
        gate: { level: 95, quests: ['crossing-war-4'], marks: 16, region: 5 },
        stages: [
            { key: 'record', kind: 'enter', buildingId: RECORD_HOUSE, text: 'Bring the Record House keeper word that the Rime Gate is open, and ask for the pattern of the last ward.' },
            { key: 'marker', kind: 'enter', buildingId: KEELROOT_MARKER, text: 'Scout from the Keelroot Marker and count the watch on the Double Watch.' },
            { key: 'disks', kind: 'enter', buildingId: TWIN_WARD_POST, text: 'Read the two ward disks at the Twin-Ward Post, in the order they are hung.' },
            // The order decides which tool is thrown first. It is read off the post,
            // and a wrong reading sends the player back to the post to read it again.
            { key: 'order', kind: 'choice', text: 'Say which ward the Double Watch raises first.', choice: {
                prompt: 'Two disks hang on the post. Which ward rises first?',
                answer: 'dark', backTo: 'disks', wrong: 'That is not how the watch touched them. Go back to the post and look again.',
                options: [
                    { key: 'dark', label: 'Name the dark glazed disk', blurb: 'The color of a medicine bottle.' },
                    { key: 'bright', label: 'Name the polished disk', blurb: 'It shows your own face.' },
                ] } },
            { key: 'root', kind: 'gather', itemId: 'quest-windroot', count: 6, siteIds: [WINDROOT_BED], text: 'Harvest 6 Windroot at the Windroot Bed. You need a kama and harvesting skill 7.' },
            { key: 'grit', kind: 'gather', itemId: 'quest-silver-grit', count: 4, siteIds: [SILVER_SEAM], text: 'Mine 4 Silver Grit at the Silver Seam. You need a pickaxe and mining skill 7.' },
            { key: 'loach', kind: 'gather', itemId: 'quest-ink-loach', count: 4, siteIds: [STILLWATER_SHELF], text: 'Fish 4 Ink Loach at the Stillwater Shelf. You need a fishing kunai and fishing skill 7.' },
            { key: 'vial', kind: 'make', buildingId: REMAKERS_WORKSHOP, recipeId: 'remade-vial', text: 'Remake Woundroot Vials in the provision room of the Remakers’ workshop.' },
            { key: 'ink', kind: 'make', buildingId: REMAKERS_WORKSHOP, recipeId: 'remade-ink', text: 'Remake Clouding Ink in the pattern loft of the Remakers’ workshop.' },
            { key: 'bell', kind: 'enter', buildingId: WITNESS_BELL, text: 'Wait at the Witness Bell until the watch on the post changes.' },
            { key: 'warden', kind: 'boss', fightId: 'twin-warden', text: 'Break the Twin Ward in order. Throw a Woundroot Vial for the Bitter Tide, then Clouding Ink for the Mirror Hold.' },
        ],
        rewards: { badges: ['coast-crossing-war-v1'], weight: 22, statPoints: 55, gearChanceBp: QUEST_GEAR_CHANCE_BP, fateShards: 1, boneCharms: 1, title: QUEST_LINE_TITLES.crossingWar5, unlocks: ['last-garrison'] },
    },

    // 8. The Unmoored. The finale: level 98 and 22 marks. Three Holds in
    // sequence against the one the Unmoored answer to.
    'the-unmoored': {
        id: 'the-unmoored', series: 'crossing-war', kind: 'quest', world: 'coast', tier: 4,
        title: 'The Unmoored', marks: 5, giver: 'record-keeper',
        gate: { level: 98, quests: ['crossing-war-5'], marks: 22, region: 5 },
        stages: [
            { key: 'record', kind: 'enter', buildingId: RECORD_HOUSE, text: 'Hear the Record House keeper name the one who was never written down.' },
            { key: 'trace', kind: 'enter', buildingId: THREEFOLD_TRACE, text: 'Follow the Threefold Trace along the Unheard March.' },
            { key: 'seal', kind: 'drop', fightId: 'crown-guards', itemId: 'quest-garrison-seal', count: 1, text: 'Defeat the guards on the Unheard March and lift a seal.' },
            { key: 'root', kind: 'gather', itemId: 'quest-windroot', count: 12, siteIds: [WINDROOT_BED], text: 'Harvest 12 Windroot at the Windroot Bed for three tools. You need a kama and harvesting skill 7.' },
            { key: 'grit', kind: 'gather', itemId: 'quest-silver-grit', count: 6, siteIds: [SILVER_SEAM], text: 'Mine 6 Silver Grit at the Silver Seam. You need a pickaxe and mining skill 7.' },
            { key: 'order', kind: 'make', buildingId: REMAKERS_WORKSHOP, recipeId: 'crown-order', text: 'Forge a Stand-Down Order at the Remakers’ workshop, under the lifted seal.' },
            { key: 'snare', kind: 'make', buildingId: REMAKERS_WORKSHOP, recipeId: 'crown-snare', text: 'Tie Pact-Cutter Snares at the Remakers’ workshop.' },
            { key: 'senbon', kind: 'make', buildingId: REMAKERS_WORKSHOP, recipeId: 'crown-senbon', text: 'Tip Ember Senbon at the Remakers’ workshop.' },
            { key: 'ask', kind: 'choice', text: 'Decide what you will ask of her when she falls.', choice: { prompt: 'What do you ask of the one who holds the coast?', options: [
                // The choice also picks the capstone relic. One relic is worn at a
                // time, so nothing a player could have used is lost (shared/relics.ts).
                { key: 'open', label: 'Ask her to open the coast', blurb: 'The villages will come. So will their wars. Her ridge wardens’ bracer is yours.', standing: 'coast-opened', items: ['coast-ridgewarden-bracer'], artKey: 'gear-bracer' },
                { key: 'closed', label: 'Ask her to keep the coast closed', blurb: 'Nobody here is put on a roll. Neither are you. Her mantle is yours.', standing: 'coast-kept-closed', items: ['coast-quiet-crown-mantle'], artKey: 'gear-mantle' },
            ] } },
            { key: 'garrison', kind: 'enter', buildingId: HUSHCROWN_GARRISON, text: 'Climb the Hushcrown Garrison to the door of the quiet crown.' },
            { key: 'crown', kind: 'boss', fightId: 'unmoored-leader', text: 'Break her three Holds in order. The order for the Oath Guard, a snare for the Beast Bond, a senbon for the Rime Lock.' },
        ],
        rewards: { badges: ['coast-finale-v1'], weight: 30, statPoints: 80, gearChanceBp: QUEST_GEAR_CHANCE_BP, fateShards: 1, boneCharms: 2, auraStones: 2, title: QUEST_LINE_TITLES.theUnmoored },
    },

    // 9 to 11. The Boatwright's Tools. A side series, one quest a region. Each
    // has the player remake an earlier tool from that region's own sites, and
    // each leaves the sites it names in shared/quest-sites.ts (`keptBy`) open
    // for good: new gathering nodes are the reward.
    'boatwright-tools-1': {
        id: 'boatwright-tools-1', series: 'boatwright', kind: 'quest', world: 'coast', tier: 1,
        title: 'The Boatwright’s Tools I', marks: 1, giver: 'slip-boatwright',
        gate: { level: 75, quests: ['first-footing'], region: 1 },
        stages: [
            { key: 'slip', kind: 'enter', buildingId: SLIP, text: 'Hear what was stripped from the boatwright’s bench at the Saltstair slip.' },
            { key: 'cord', kind: 'gather', itemId: 'quest-wrack-cord', count: 8, siteIds: ['saltstair-harvest-102'], text: 'Harvest 8 Wrack Cord at Wrack Strand to rig the bench again. You need a kama.' },
            { key: 'fittings', kind: 'gather', itemId: 'quest-splitstone-fittings', count: 6, siteIds: ['saltstair-mine-103'], text: 'Mine 6 Splitstone Fittings at Splitstone Seam. You need a pickaxe.' },
            { key: 'rig', kind: 'deliver', buildingId: SLIP, itemId: 'quest-wrack-cord', count: 8, text: 'Bring the boatwright 8 Wrack Cord.' },
            { key: 'fit', kind: 'deliver', buildingId: SLIP, itemId: 'quest-splitstone-fittings', count: 4, text: 'Bring the boatwright 4 Splitstone Fittings. Keep the rest.' },
            { key: 'roots', kind: 'gather', itemId: 'quest-woundroot', count: 6, siteIds: ['saltstair-harvest-106'], text: 'Harvest 6 Woundroot at Woundroot Bank. The wrecker drinks what the garrison drinks.' },
            { key: 'vial', kind: 'make', buildingId: RECORD_HOUSE, recipeId: 'woundroot-vial', text: 'Boil the roots down into Woundroot Vials at the Record House.' },
            { key: 'wrecker', kind: 'boss', fightId: 'slip-wrecker', text: 'Throw a Woundroot Vial to break the wrecker’s Bitter Tide and take back the bench irons.' },
        ],
        rewards: { weight: 8, statPoints: 10, title: QUEST_LINE_TITLES.boatwrightTools1 },
    },
    'boatwright-tools-2': {
        id: 'boatwright-tools-2', series: 'boatwright', kind: 'quest', world: 'coast', tier: 2,
        title: 'The Boatwright’s Tools II', marks: 2, giver: 'slip-boatwright',
        gate: { level: 80, quests: ['boatwright-tools-1', 'crossing-war-1'], region: 2 },
        stages: [
            { key: 'slip', kind: 'enter', buildingId: SLIP, text: 'Ask the boatwright what a hull needs before it will hold on this coast.' },
            { key: 'pitch', kind: 'gather', itemId: 'quest-pitchwood', count: 6, siteIds: ['brackwater-harvest-115'], text: 'Harvest 6 Pitchwood from the drift at Pitchwrack Strand. You need a kama.' },
            { key: 'eel', kind: 'gather', itemId: 'quest-caulk-eel', count: 4, siteIds: ['brackwater-fish-117'], text: 'Fish 4 Caulk Eel at the Sounding Pool. You need a fishing kunai.' },
            { key: 'haul', kind: 'deliver', buildingId: SLIP, itemId: 'quest-pitchwood', count: 6, text: 'Bring the boatwright 6 Pitchwood.' },
            { key: 'glue', kind: 'deliver', buildingId: SLIP, itemId: 'quest-caulk-eel', count: 4, text: 'Bring the boatwright 4 Caulk Eel.' },
            { key: 'seed', kind: 'gather', itemId: 'quest-inkseed', count: 6, siteIds: [INKSEED_BED], text: 'Harvest 6 Inkseed at the Inkseed Bed. The drift burner works behind mirrors.' },
            { key: 'silt', kind: 'gather', itemId: 'quest-mirror-silt', count: 2, siteIds: [MIRROR_POOL], text: 'Mine 2 Mirror Silt at the rim of the Mirror Pool. You need a pickaxe.' },
            { key: 'ink', kind: 'make', buildingId: RELAY_HOUSE, recipeId: 'clouding-ink', text: 'Grind Clouding Ink at the Relay House ink basin.' },
            { key: 'burner', kind: 'boss', fightId: 'pitch-warden', text: 'Throw Clouding Ink to break the drift burner’s Mirror Hold.' },
        ],
        rewards: { weight: 12, statPoints: 15, boneCharms: 1, title: QUEST_LINE_TITLES.boatwrightTools2 },
    },
    'boatwright-tools-3': {
        id: 'boatwright-tools-3', series: 'boatwright', kind: 'quest', world: 'coast', tier: 3,
        title: 'The Boatwright’s Tools III', marks: 3, giver: 'slip-boatwright',
        gate: { level: 85, quests: ['boatwright-tools-2', 'crossing-war-2'], region: 3 },
        stages: [
            { key: 'slip', kind: 'enter', buildingId: SLIP, text: 'Hear the boatwright on the one timber he cannot cut on this shore.' },
            { key: 'root', kind: 'gather', itemId: 'quest-keelroot', count: 8, siteIds: ['briarwood-harvest-123'], text: 'Harvest 8 Keelroot at Keelroot Fall. You need a kama and harvesting skill 4.' },
            { key: 'watch', kind: 'reach', place: { sector: 129 }, text: 'Shadow the keel cutters along the Foldwood Path and count their beasts.' },
            { key: 'thorn', kind: 'gather', itemId: 'quest-binding-thorn', count: 6, siteIds: [BINDING_THORN], text: 'Harvest 6 Binding Thorn at Briar Spindle.' },
            { key: 'links', kind: 'gather', itemId: 'quest-tether-link', count: 2, siteIds: [SUNDERED_TETHER], text: 'Mine 2 Tether Links from the sundered tether. You need a pickaxe and mining skill 4.' },
            { key: 'snare', kind: 'make', buildingId: SUNDERED_TETHER, recipeId: 'pact-cutter-snare', text: 'Tie Pact-Cutter Snares on the old tether post.' },
            { key: 'haul', kind: 'deliver', buildingId: SLIP, itemId: 'quest-keelroot', count: 8, text: 'Bring the boatwright 8 Keelroot.' },
            { key: 'reaver', kind: 'boss', fightId: 'keel-reaver', text: 'Throw a Pact-Cutter Snare to break the keel cutter’s Beast Bond.' },
        ],
        rewards: { badges: ['coast-boatwright-v1'], weight: 16, statPoints: 25, gearChanceBp: QUEST_GEAR_CHANCE_BP, fateShards: 1, title: QUEST_LINE_TITLES.boatwrightTools3 },
    },

    // 12 to 14. The Uncounted. A defector brings out the people the Unmoored
    // never entered on a roll. Each quest forges papers under a lifted seal, as
    // First Footing did, from that region's own material, and asks whose papers
    // to forge. The first opens the second dock (api/player/travel.ts).
    'uncounted-1': {
        id: 'uncounted-1', series: 'uncounted', kind: 'quest', world: 'coast', tier: 2,
        title: 'The Uncounted I', marks: 2, giver: 'quay-defector',
        gate: { level: 80, quests: ['crossing-war-1'], region: 2 },
        stages: [
            { key: 'quay', kind: 'enter', buildingId: DEFECTOR_QUAY, text: 'Meet the defector at the Low Water Quay. She is on no roll the Unmoored keep.' },
            { key: 'post', kind: 'enter', buildingId: WATCH_POST, text: 'Read the duty desk at the Watch Post and learn whose word opens the quay.' },
            { key: 'papers', kind: 'choice', text: 'Decide whose papers to forge.', choice: { prompt: 'Whose papers will you forge?', options: [
                { key: 'quay-master', label: 'Forge the quay master’s pass', blurb: 'Slow to check. The watch will look twice.', bonusRyoPct: 25, standing: 'uncounted-quay-pass' },
                { key: 'watch-captain', label: 'Forge the watch captain’s order', blurb: 'Obeyed at once. Missed by morning.', standing: 'uncounted-watch-order' },
            ] } },
            { key: 'seal', kind: 'drop', fightId: 'quay-couriers', itemId: 'quest-garrison-seal', count: 1, text: 'Defeat the couriers at the Courier’s Cache and lift a seal.' },
            { key: 'seed', kind: 'gather', itemId: 'quest-inkseed', count: 4, siteIds: [INKSEED_BED], text: 'Harvest 4 Inkseed at the Inkseed Bed for the forger’s ink. You need a kama.' },
            { key: 'forge', kind: 'make', buildingId: RELAY_HOUSE, recipeId: 'quay-order', text: 'Forge the papers at the Relay House sealing counter.' },
            { key: 'warden', kind: 'boss', fightId: 'quay-warden', fightByChoice: { stage: 'papers', fights: { 'quay-master': 'quay-warden-watched' } }, text: 'Show the forged papers to break the quay warden’s Oath Guard.' },
        ],
        rewards: { weight: 12, statPoints: 15, fateShards: 1, unlocks: ['second-dock'], title: QUEST_LINE_TITLES.uncounted1 },
    },
    'uncounted-2': {
        id: 'uncounted-2', series: 'uncounted', kind: 'quest', world: 'coast', tier: 3,
        title: 'The Uncounted II', marks: 3, giver: 'quay-defector',
        gate: { level: 85, quests: ['uncounted-1', 'crossing-war-2'], region: 3 },
        stages: [
            { key: 'quay', kind: 'enter', buildingId: DEFECTOR_QUAY, text: 'Hear the defector name the others who were never counted.' },
            { key: 'shrine', kind: 'enter', buildingId: WITNESS_SHRINE, text: 'Read the witness register at the Witness Shrine.' },
            { key: 'ruin', kind: 'enter', buildingId: CHRONICLE_RUIN, text: 'Take a rubbing in the Chronicle Ruin and find the roll it was cut from.' },
            { key: 'name', kind: 'choice', text: 'Decide whose name the forged entry carries.', choice: { prompt: 'Whose name do you write into the register?', options: [
                { key: 'runner', label: 'Write in the runner who carries the roll', blurb: 'She can walk out by daylight.', bonusRyoPct: 25, standing: 'uncounted-runner-named' },
                { key: 'witness', label: 'Write in a witness long dead', blurb: 'No one living can deny it.', standing: 'uncounted-dead-witness' },
            ] } },
            { key: 'hollow', kind: 'reach', place: { sector: 129 }, text: 'Shadow the roll’s couriers to Runner’s Hollow.' },
            { key: 'seal', kind: 'drop', fightId: 'hollow-couriers', itemId: 'quest-garrison-seal', count: 1, text: 'Defeat the couriers in Runner’s Hollow and lift a seal.' },
            { key: 'thorn', kind: 'gather', itemId: 'quest-binding-thorn', count: 4, siteIds: [BINDING_THORN], text: 'Harvest 4 Binding Thorn at Briar Spindle to bind the entry. You need a kama and harvesting skill 4.' },
            { key: 'forge', kind: 'make', buildingId: WITNESS_SHRINE, recipeId: 'register-order', text: 'Forge the entry in the register room of the Witness Shrine.' },
            { key: 'keeper', kind: 'boss', fightId: 'roll-keeper', fightByChoice: { stage: 'name', fights: { runner: 'roll-keeper-wary' } }, text: 'Show the forged entry to break the roll keeper’s Oath Guard.' },
        ],
        rewards: { weight: 16, statPoints: 25, boneCharms: 1, title: QUEST_LINE_TITLES.uncounted2 },
    },
    'uncounted-3': {
        id: 'uncounted-3', series: 'uncounted', kind: 'quest', world: 'coast', tier: 3,
        title: 'The Uncounted III', marks: 3, giver: 'quay-defector',
        gate: { level: 90, quests: ['uncounted-2', 'crossing-war-3'], region: 4 },
        stages: [
            { key: 'quay', kind: 'enter', buildingId: DEFECTOR_QUAY, text: 'Hear where the defector means to take the uncounted across.' },
            { key: 'cleft', kind: 'enter', buildingId: COURIER_CLEFT, text: 'Find the split tally hidden in the Courier’s Cleft.' },
            { key: 'house', kind: 'enter', buildingId: PASS_RECORD_HOUSE, text: 'Look over the dockets on the toll counter of the Pass Record House.' },
            // The half tally was seen two steps ago, at the cleft, and is not shown
            // again here. A wrong match sends the player back to look at it.
            { key: 'match', kind: 'choice', text: 'Match the half tally from the cleft to its docket.', choice: {
                prompt: 'Three dockets, each pinned to half a tally. Which one is yours?',
                answer: 'second', backTo: 'cleft', wrong: 'The halves do not meet, and a clerk looks up from the far desk. Go back to the cleft and look at your half again.',
                options: [
                    { key: 'first', label: 'Take the first docket', blurb: 'Two notches and a square end.' },
                    { key: 'second', label: 'Take the second docket', blurb: 'Three notches and a slanted corner.' },
                    { key: 'third', label: 'Take the third docket', blurb: 'Three notches and a square end.' },
                ] } },
            { key: 'pass', kind: 'choice', text: 'Decide which pass to write them onto.', choice: { prompt: 'Which pass carries them over?', options: [
                { key: 'salt', label: 'Copy a salt carrier’s pass', blurb: 'Common, and searched at every gate.', bonusRyoPct: 25, standing: 'uncounted-salt-pass' },
                { key: 'dispatch', label: 'Copy a dispatch rider’s pass', blurb: 'Waved through. Counted at the far end.', standing: 'uncounted-dispatch-pass' },
            ] } },
            { key: 'seal', kind: 'drop', fightId: 'cleft-couriers', itemId: 'quest-garrison-seal', count: 1, text: 'Defeat the couriers at the Courier’s Cleft and lift a seal.' },
            { key: 'stylus', kind: 'gather', itemId: 'quest-frost-splinter', count: 3, siteIds: [FROST_WITNESS], text: 'Mine 3 Frost Splinters from the Frost Witness to cut the tally. You need a pickaxe and mining skill 4.' },
            { key: 'forge', kind: 'make', buildingId: PASS_RECORD_HOUSE, recipeId: 'pass-order', text: 'Forge the pass at the toll counter of the Pass Record House.' },
            { key: 'cairn', kind: 'enter', buildingId: DISPATCH_CAIRN, text: 'Lead the uncounted to the Last Dispatch Cairn.' },
            { key: 'captain', kind: 'boss', fightId: 'pass-captain', fightByChoice: { stage: 'pass', fights: { salt: 'pass-captain-searching' } }, text: 'Show the forged pass to break the toll captain’s Oath Guard.' },
        ],
        rewards: { badges: ['coast-uncounted-v1'], weight: 18, statPoints: 30, gearChanceBp: QUEST_GEAR_CHANCE_BP, fateShards: 1, title: QUEST_LINE_TITLES.uncounted3 },
    },

    // 15 to 17. Raise the Clan Gate. Clan quests: each is taken with a clan and
    // moves only while the player is in that clan (api/quests/_clan-facts.ts).
    // Each asks the clan's Landing to stand at a tier, read from the Landing's
    // own row, and ends with the player holding the founding ground at the Clan
    // Landing Plot against the Unmoored.
    'clan-gate-1': {
        id: 'clan-gate-1', series: 'clan-gate', kind: 'quest', world: 'coast', tier: 1,
        title: 'Raise the Clan Gate I', marks: 1, giver: 'record-keeper',
        gate: { level: 77, quests: ['crossing-war-1'], region: 1, clan: true },
        stages: [
            { key: 'record', kind: 'enter', buildingId: RECORD_HOUSE, text: 'Ask the Record House keeper how a clan’s claim is written down.' },
            { key: 'stake', kind: 'enter', buildingId: CLAN_PLOT, landing: { tier: 0 }, text: 'Stand on the founding ground once your clan has staked a Landing. You may join a clan that holds one.' },
            { key: 'cord', kind: 'gather', itemId: 'quest-wrack-cord', count: 4, siteIds: ['saltstair-harvest-102'], text: 'Harvest 4 Wrack Cord for the boundary line. You need a kama.' },
            { key: 'seal', kind: 'drop', fightId: 'plot-surveyors', itemId: 'quest-garrison-seal', count: 1, text: 'Defeat the Unmoored surveyors on the founding ground and lift their seal.' },
            { key: 'order', kind: 'make', buildingId: RECORD_HOUSE, recipeId: 'stand-down-order', text: 'Forge a Stand-Down Order at the Record House.' },
            { key: 'reeve', kind: 'boss', fightId: 'plot-reeve', text: 'Show the order to break the reeve’s Oath Guard.' },
        ],
        rewards: { weight: 8, statPoints: 10, title: QUEST_LINE_TITLES.clanGate1 },
    },
    'clan-gate-2': {
        id: 'clan-gate-2', series: 'clan-gate', kind: 'quest', world: 'coast', tier: 2,
        title: 'Raise the Clan Gate II', marks: 2, giver: 'record-keeper',
        gate: { level: 78, quests: ['clan-gate-1'], region: 1, clan: true },
        stages: [
            { key: 'record', kind: 'enter', buildingId: RECORD_HOUSE, text: 'Hear the Record House keeper on what the Unmoored do to a hall.' },
            { key: 'hall', kind: 'enter', buildingId: CLAN_PLOT, landing: { tier: 2 }, text: 'Stand on the founding ground once your clan has raised its Landing to a Landing Hall.' },
            { key: 'roots', kind: 'gather', itemId: 'quest-woundroot', count: 6, siteIds: ['saltstair-harvest-106'], text: 'Harvest 6 Woundroot at Woundroot Bank. You need a kama.' },
            { key: 'fittings', kind: 'gather', itemId: 'quest-splitstone-fittings', count: 2, siteIds: ['saltstair-mine-103'], text: 'Mine 2 Splitstone Fittings at Splitstone Seam. You need a pickaxe.' },
            { key: 'vial', kind: 'make', buildingId: RECORD_HOUSE, recipeId: 'woundroot-vial', text: 'Boil the roots down into Woundroot Vials at the Record House.' },
            { key: 'burner', kind: 'boss', fightId: 'hall-burner', text: 'Throw a Woundroot Vial to break the burner’s Bitter Tide.' },
        ],
        rewards: { weight: 12, statPoints: 15, boneCharms: 1, title: QUEST_LINE_TITLES.clanGate2 },
    },
    'clan-gate-3': {
        id: 'clan-gate-3', series: 'clan-gate', kind: 'quest', world: 'coast', tier: 3,
        title: 'Raise the Clan Gate III', marks: 3, giver: 'record-keeper',
        gate: { level: 80, quests: ['clan-gate-2'], region: 1, clan: true },
        stages: [
            { key: 'record', kind: 'enter', buildingId: RECORD_HOUSE, text: 'Bring the Record House keeper word that a raid is coming for the Landings.' },
            { key: 'gate', kind: 'enter', buildingId: CLAN_PLOT, landing: { tier: 3 }, text: 'Stand on the founding ground once your clan has raised its Landing to a Defended Landing.' },
            { key: 'seal', kind: 'drop', fightId: 'gate-raiders', itemId: 'quest-garrison-seal', count: 1, text: 'Defeat the first raiders on the founding ground and lift their seal.' },
            { key: 'cord', kind: 'gather', itemId: 'quest-wrack-cord', count: 4, siteIds: ['saltstair-harvest-102'], text: 'Harvest 4 Wrack Cord at Wrack Strand. You need a kama.' },
            { key: 'order', kind: 'make', buildingId: RECORD_HOUSE, recipeId: 'stand-down-order', text: 'Forge a Stand-Down Order at the Record House.' },
            { key: 'roots', kind: 'gather', itemId: 'quest-woundroot', count: 6, siteIds: ['saltstair-harvest-106'], text: 'Harvest 6 Woundroot at Woundroot Bank.' },
            { key: 'fittings', kind: 'gather', itemId: 'quest-splitstone-fittings', count: 2, siteIds: ['saltstair-mine-103'], text: 'Mine 2 Splitstone Fittings at Splitstone Seam. You need a pickaxe.' },
            { key: 'vial', kind: 'make', buildingId: RECORD_HOUSE, recipeId: 'woundroot-vial', text: 'Boil the roots down into Woundroot Vials at the Record House.' },
            { key: 'captain', kind: 'boss', fightId: 'raid-captain', text: 'Hold the gate. Show the order for the captain’s Oath Guard, then throw a vial for the Bitter Tide.' },
        ],
        rewards: { badges: ['coast-clan-gate-v1'], weight: 16, statPoints: 25, gearChanceBp: QUEST_GEAR_CHANCE_BP, fateShards: 1, title: QUEST_LINE_TITLES.clanGate3 },
    },

    // 18 to 20. Untamed Coast. A beast is brought to a lure and fought with the
    // player's companion beside them (every quest fight seals the active
    // companion, api/solo-pve/_ai-encounter.ts). The lure is made from that
    // region's fishing pool; the Hold is broken by the region's own tool.
    'untamed-coast-1': {
        id: 'untamed-coast-1', series: 'untamed', kind: 'quest', world: 'coast', tier: 1,
        title: 'Untamed Coast I', marks: 1, giver: 'trace-keeper',
        gate: { level: 75, quests: ['first-footing'], region: 1 },
        stages: [
            { key: 'trace', kind: 'enter', buildingId: HOUND_TRACE, text: 'Meet the keeper at the Hound Trace and read the tracks with your companion.' },
            { key: 'fish', kind: 'gather', itemId: 'quest-needle-fish', count: 4, siteIds: ['saltstair-fish-104'], text: 'Fish 4 Needle Fish at Needle Shoal. You need a fishing kunai.' },
            { key: 'lure', kind: 'make', buildingId: HOUND_TRACE, recipeId: 'needle-lure', text: 'Work the fish into Scent Lures at the Hound Trace.' },
            { key: 'set', kind: 'deliver', buildingId: HIGH_SILL, itemId: 'quest-scent-lure', count: 2, text: 'Set 2 Scent Lures at the High Sill and wait downwind. The hound goes to ground in the sea smoke.' },
            { key: 'cord', kind: 'gather', itemId: 'quest-wrack-cord', count: 2, siteIds: ['saltstair-harvest-102'], text: 'Harvest 2 Wrack Cord at Wrack Strand. You need a kama.' },
            { key: 'stone', kind: 'gather', itemId: 'quest-splitstone-fittings', count: 2, siteIds: ['saltstair-mine-103'], text: 'Mine 2 Splitstone Fittings at Splitstone Seam. You need a pickaxe.' },
            { key: 'shard', kind: 'make', buildingId: RECORD_HOUSE, recipeId: 'sill-signal-shard', text: 'Bind Signal Shards at the Record House. Struck splitstone flares as stormglass does.' },
            { key: 'hound', kind: 'boss', fightId: 'brinejaw', text: 'Throw a Signal Shard to break Old Brinejaw’s Smoke Hold.' },
        ],
        rewards: { weight: 8, statPoints: 10, title: QUEST_LINE_TITLES.untamedCoast1 },
    },
    'untamed-coast-2': {
        id: 'untamed-coast-2', series: 'untamed', kind: 'quest', world: 'coast', tier: 2,
        title: 'Untamed Coast II', marks: 2, giver: 'trace-keeper',
        gate: { level: 85, quests: ['untamed-coast-1', 'crossing-war-2'], region: 3 },
        stages: [
            { key: 'trace', kind: 'enter', buildingId: HOUND_TRACE, text: 'Hear the keeper on the pack that hunts the Briarwood fords.' },
            { key: 'ford', kind: 'enter', buildingId: ANTLERWASH_FORD, text: 'Read the wash at Antlerwash Ford with your companion.' },
            { key: 'fish', kind: 'gather', itemId: 'quest-scent-carp', count: 4, siteIds: ['briarwood-fish-127'], text: 'Fish 4 Scent Carp at the Scentwater Shelf. You need a fishing kunai and fishing skill 4.' },
            { key: 'lure', kind: 'make', buildingId: ANTLERWASH_FORD, recipeId: 'carp-lure', text: 'Work the carp into Scent Lures at the ford.' },
            { key: 'set', kind: 'deliver', buildingId: SCENT_STONE, itemId: 'quest-scent-lure', count: 2, text: 'Set 2 Scent Lures at the Scent Stone.' },
            { key: 'thorn', kind: 'gather', itemId: 'quest-binding-thorn', count: 6, siteIds: [BINDING_THORN], text: 'Harvest 6 Binding Thorn at Briar Spindle. You need a kama and harvesting skill 4.' },
            { key: 'links', kind: 'gather', itemId: 'quest-tether-link', count: 2, siteIds: [SUNDERED_TETHER], text: 'Mine 2 Tether Links from the sundered tether. You need a pickaxe and mining skill 4.' },
            { key: 'snare', kind: 'make', buildingId: SUNDERED_TETHER, recipeId: 'pact-cutter-snare', text: 'Tie Pact-Cutter Snares on the old tether post. The pack closes round its mother.' },
            { key: 'mother', kind: 'boss', fightId: 'thornmother', text: 'Throw a Pact-Cutter Snare to break Thornmother’s Beast Bond.' },
        ],
        rewards: { weight: 14, statPoints: 20, boneCharms: 1, title: QUEST_LINE_TITLES.untamedCoast2 },
    },
    'untamed-coast-3': {
        id: 'untamed-coast-3', series: 'untamed', kind: 'quest', world: 'coast', tier: 2,
        title: 'Untamed Coast III', marks: 2, giver: 'trace-keeper',
        gate: { level: 90, quests: ['untamed-coast-2', 'crossing-war-3'], region: 4 },
        stages: [
            { key: 'trace', kind: 'enter', buildingId: HOUND_TRACE, text: 'Hear the keeper on the white fox no trap has held.' },
            { key: 'scrape', kind: 'enter', buildingId: IBEX_SCRAPE, text: 'Read the Ibex Scrape with your companion and find what the fox hunts.' },
            { key: 'fish', kind: 'gather', itemId: 'quest-icebell-smelt', count: 4, siteIds: ['whitecrown-fish-135'], text: 'Fish 4 Icebell Smelt at the Icebell Shelf. You need a fishing kunai and fishing skill 4.' },
            { key: 'lure', kind: 'make', buildingId: IBEX_SCRAPE, recipeId: 'smelt-lure', text: 'Work the smelt into Scent Lures at the scrape.' },
            { key: 'set', kind: 'deliver', buildingId: WIND_COLLAR, itemId: 'quest-scent-lure', count: 2, text: 'Set 2 Scent Lures at the Wind Collar.' },
            { key: 'glass', kind: 'gather', itemId: 'quest-emberglass', count: 6, siteIds: [EMBERGLASS_SEAM], text: 'Mine 6 Emberglass at the Emberglass Seam. You need a pickaxe and mining skill 4.' },
            { key: 'splinter', kind: 'gather', itemId: 'quest-frost-splinter', count: 3, siteIds: [FROST_WITNESS], text: 'Mine 3 Frost Splinters from the Frost Witness.' },
            { key: 'senbon', kind: 'make', buildingId: ASSAY_HOUSE, recipeId: 'ember-senbon', text: 'Tip Ember Senbon at the Assay House. Rime plates the fox from nose to tail.' },
            { key: 'fox', kind: 'boss', fightId: 'whitemane', text: 'Throw an Ember Senbon to break Whitemane’s Rime Lock.' },
        ],
        rewards: { badges: ['coast-untamed-v1'], weight: 16, statPoints: 25, gearChanceBp: QUEST_GEAR_CHANCE_BP, fateShards: 1, title: QUEST_LINE_TITLES.untamedCoast3 },
    },
};

export const QUEST_LINE_RECIPES: Readonly<Record<string, QuestLineRecipe>> = {
    'signal-shard': { id: 'signal-shard', inputs: [{ itemId: 'gather-stormglass-shard', count: 2 }, { itemId: 'gather-binding-fiber', count: 2 }], output: { itemId: 'quest-signal-shard', count: 3 } },
    'stand-down-order': { id: 'stand-down-order', inputs: [{ itemId: 'quest-garrison-seal', count: 1 }, { itemId: 'quest-wrack-cord', count: 4 }], output: { itemId: 'quest-stand-down-order', count: 2 } },
    'woundroot-vial': { id: 'woundroot-vial', inputs: [{ itemId: 'quest-woundroot', count: 6 }, { itemId: 'quest-splitstone-fittings', count: 2 }], output: { itemId: 'quest-woundroot-vial', count: 3 } },
    'clouding-ink': { id: 'clouding-ink', inputs: [{ itemId: 'quest-inkseed', count: 6 }, { itemId: 'quest-mirror-silt', count: 2 }], output: { itemId: 'quest-clouding-ink', count: 3 } },
    'pact-cutter-snare': { id: 'pact-cutter-snare', inputs: [{ itemId: 'quest-binding-thorn', count: 6 }, { itemId: 'quest-tether-link', count: 2 }], output: { itemId: 'quest-pact-cutter-snare', count: 3 } },
    'ember-senbon': { id: 'ember-senbon', inputs: [{ itemId: 'quest-emberglass', count: 6 }, { itemId: 'quest-frost-splinter', count: 3 }], output: { itemId: 'quest-ember-senbon', count: 3 } },
    // Hushcrown Heights: the Remakers' workshop makes the earlier tools from the heights' own materials.
    'remade-vial': { id: 'remade-vial', inputs: [{ itemId: 'quest-windroot', count: 6 }, { itemId: 'quest-silver-grit', count: 2 }], output: { itemId: 'quest-woundroot-vial', count: 3 } },
    'remade-ink': { id: 'remade-ink', inputs: [{ itemId: 'quest-ink-loach', count: 4 }, { itemId: 'quest-silver-grit', count: 2 }], output: { itemId: 'quest-clouding-ink', count: 3 } },
    'crown-order': { id: 'crown-order', inputs: [{ itemId: 'quest-garrison-seal', count: 1 }, { itemId: 'quest-windroot', count: 4 }], output: { itemId: 'quest-stand-down-order', count: 2 } },
    'crown-snare': { id: 'crown-snare', inputs: [{ itemId: 'quest-windroot', count: 6 }, { itemId: 'quest-silver-grit', count: 2 }], output: { itemId: 'quest-pact-cutter-snare', count: 3 } },
    'crown-senbon': { id: 'crown-senbon', inputs: [{ itemId: 'quest-silver-grit', count: 4 }, { itemId: 'quest-windroot', count: 2 }], output: { itemId: 'quest-ember-senbon', count: 3 } },
    // The Uncounted: the same forged order, under a lifted seal, from each region's own material.
    'quay-order': { id: 'quay-order', inputs: [{ itemId: 'quest-garrison-seal', count: 1 }, { itemId: 'quest-inkseed', count: 4 }], output: { itemId: 'quest-stand-down-order', count: 2 } },
    'register-order': { id: 'register-order', inputs: [{ itemId: 'quest-garrison-seal', count: 1 }, { itemId: 'quest-binding-thorn', count: 4 }], output: { itemId: 'quest-stand-down-order', count: 2 } },
    'pass-order': { id: 'pass-order', inputs: [{ itemId: 'quest-garrison-seal', count: 1 }, { itemId: 'quest-frost-splinter', count: 3 }], output: { itemId: 'quest-stand-down-order', count: 2 } },
    // Untamed Coast: the same lure from each region's fish, and Signal Shards from coast stone and cord.
    'needle-lure': { id: 'needle-lure', inputs: [{ itemId: 'quest-needle-fish', count: 4 }], output: { itemId: 'quest-scent-lure', count: 2 } },
    'carp-lure': { id: 'carp-lure', inputs: [{ itemId: 'quest-scent-carp', count: 4 }], output: { itemId: 'quest-scent-lure', count: 2 } },
    'smelt-lure': { id: 'smelt-lure', inputs: [{ itemId: 'quest-icebell-smelt', count: 4 }], output: { itemId: 'quest-scent-lure', count: 2 } },
    'sill-signal-shard': { id: 'sill-signal-shard', inputs: [{ itemId: 'quest-splitstone-fittings', count: 2 }, { itemId: 'quest-wrack-cord', count: 2 }], output: { itemId: 'quest-signal-shard', count: 3 } },
};

export const QUEST_LINE_FIGHTS: Readonly<Record<string, QuestLineFight>> = {
    // Home map. The lookouts wait where the runner was shadowed to; the runner
    // is run to ground where his tally leads.
    'runner-lookouts': { id: 'runner-lookouts', castId: 'runner-lookout', sector: 5, levelOffset: 0, statBonus: 2, loadoutId: 'bruiser' },
    'chart-runner': { id: 'chart-runner', castId: 'chart-runner', sector: 3, levelOffset: 1, statBonus: 4, loadoutId: 'burst', hold: { breakerItemId: 'quest-signal-shard', name: 'Smoke Hold' } },
    // Saltstair Landing. All three are fought at the garrison in sector 107.
    'garrison-patrol': { id: 'garrison-patrol', castId: 'unmoored-patrol', sector: 107, levelOffset: 0, statBonus: 2, loadoutId: 'bruiser' },
    'gate-captain': { id: 'gate-captain', castId: 'gate-captain', sector: 107, levelOffset: 2, statBonus: 4, loadoutId: 'defender', hold: { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard' } },
    'garrison-commander': { id: 'garrison-commander', castId: 'garrison-commander', sector: 107, levelOffset: 3, statBonus: 6, loadoutId: 'boss', hold: { breakerItemId: 'quest-woundroot-vial', name: 'Bitter Tide' } },
    // Brackwater Fields. The adept is fought at the Mirror Pool on Glasswake Shelf.
    // The Crossing War II's turn: the adept's couriers, who were watching the cache. No Hold.
    'shelf-couriers': { id: 'shelf-couriers', castId: 'unmoored-courier', sector: 119, levelOffset: 1, statBonus: 3, loadoutId: 'bruiser' },
    'glasswake-adept': { id: 'glasswake-adept', castId: 'glasswake-adept', sector: 114, levelOffset: 3, statBonus: 6, loadoutId: 'burst', hold: { breakerItemId: 'quest-clouding-ink', name: 'Mirror Hold' } },
    // Briarwood Deep. The tamer is fought at the Leash Garrison.
    'leash-tamer': { id: 'leash-tamer', castId: 'leash-tamer', sector: 126, levelOffset: 3, statBonus: 7, loadoutId: 'boss', hold: { breakerItemId: 'quest-pact-cutter-snare', name: 'Beast Bond' } },
    // Whitecrown Passes. The warden is fought at the Rime Gatehouse.
    'rime-warden': { id: 'rime-warden', castId: 'rime-warden', sector: 138, levelOffset: 3, statBonus: 7, loadoutId: 'defender', hold: { breakerItemId: 'quest-ember-senbon', name: 'Rime Lock' } },
    // Hushcrown Heights. Chained Holds: each rises as the one before it breaks.
    'twin-warden': { id: 'twin-warden', castId: 'twin-warden', sector: 148, levelOffset: 3, statBonus: 8, loadoutId: 'defender',
        hold: { breakerItemId: 'quest-woundroot-vial', name: 'Bitter Tide', next: [{ breakerItemId: 'quest-clouding-ink', name: 'Mirror Hold' }] } },
    'crown-guards': { id: 'crown-guards', castId: 'crown-guard', sector: 149, levelOffset: 1, statBonus: 4, loadoutId: 'bruiser' },
    'unmoored-leader': { id: 'unmoored-leader', castId: 'unmoored-leader', sector: 150, levelOffset: 4, statBonus: 8, loadoutId: 'boss',
        hold: { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard', next: [
            { breakerItemId: 'quest-pact-cutter-snare', name: 'Beast Bond' },
            { breakerItemId: 'quest-ember-senbon', name: 'Rime Lock' },
        ] } },
    // Raise the Clan Gate. All are fought on the founding ground at the Clan Landing Plot.
    'plot-surveyors': { id: 'plot-surveyors', castId: 'unmoored-patrol', sector: 108, levelOffset: 0, statBonus: 2, loadoutId: 'bruiser' },
    'plot-reeve': { id: 'plot-reeve', castId: 'plot-reeve', sector: 108, levelOffset: 2, statBonus: 4, loadoutId: 'defender', hold: { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard' } },
    'hall-burner': { id: 'hall-burner', castId: 'hall-burner', sector: 108, levelOffset: 2, statBonus: 5, loadoutId: 'burst', hold: { breakerItemId: 'quest-woundroot-vial', name: 'Bitter Tide' } },
    'gate-raiders': { id: 'gate-raiders', castId: 'unmoored-patrol', sector: 108, levelOffset: 1, statBonus: 3, loadoutId: 'bruiser' },
    'raid-captain': { id: 'raid-captain', castId: 'raid-captain', sector: 108, levelOffset: 3, statBonus: 6, loadoutId: 'boss',
        hold: { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard', next: [{ breakerItemId: 'quest-woundroot-vial', name: 'Bitter Tide' }] } },
    // The Boatwright's Tools: Needle Shoal, Pitchwrack Strand and the Split Keel.
    'slip-wrecker': { id: 'slip-wrecker', castId: 'slip-wrecker', sector: 104, levelOffset: 2, statBonus: 4, loadoutId: 'bruiser', hold: { breakerItemId: 'quest-woundroot-vial', name: 'Bitter Tide' } },
    'pitch-warden': { id: 'pitch-warden', castId: 'pitch-warden', sector: 115, levelOffset: 2, statBonus: 5, loadoutId: 'burst', hold: { breakerItemId: 'quest-clouding-ink', name: 'Mirror Hold' } },
    'keel-reaver': { id: 'keel-reaver', castId: 'keel-reaver', sector: 123, levelOffset: 2, statBonus: 6, loadoutId: 'boss', hold: { breakerItemId: 'quest-pact-cutter-snare', name: 'Beast Bond' } },
    // The Uncounted: couriers who carry a seal, and the three who keep the rolls.
    'quay-couriers': { id: 'quay-couriers', castId: 'unmoored-courier', sector: 119, levelOffset: 0, statBonus: 2, loadoutId: 'bruiser' },
    'quay-warden': { id: 'quay-warden', castId: 'quay-warden', sector: 116, levelOffset: 2, statBonus: 5, loadoutId: 'defender', hold: { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard' } },
    'hollow-couriers': { id: 'hollow-couriers', castId: 'unmoored-courier', sector: 129, levelOffset: 0, statBonus: 3, loadoutId: 'bruiser' },
    'roll-keeper': { id: 'roll-keeper', castId: 'roll-keeper', sector: 124, levelOffset: 2, statBonus: 6, loadoutId: 'burst', hold: { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard' } },
    'cleft-couriers': { id: 'cleft-couriers', castId: 'unmoored-courier', sector: 132, levelOffset: 0, statBonus: 3, loadoutId: 'bruiser' },
    'pass-captain': { id: 'pass-captain', castId: 'pass-captain', sector: 140, levelOffset: 2, statBonus: 7, loadoutId: 'defender', hold: { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard' } },
    // The same three, on their guard. Each Uncounted choice has a slower paper
    // that pays a quarter more ryo: the watch looks twice, a living name can be
    // asked after, a common pass is searched. Taking it is this harder fight,
    // one level and three stat points up, so the better pay is earned and the
    // quick paper is the easier night. Same place, same Hold, same tool.
    'quay-warden-watched': { id: 'quay-warden-watched', castId: 'quay-warden', sector: 116, levelOffset: 3, statBonus: 8, loadoutId: 'defender', hold: { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard' } },
    'roll-keeper-wary': { id: 'roll-keeper-wary', castId: 'roll-keeper', sector: 124, levelOffset: 3, statBonus: 9, loadoutId: 'burst', hold: { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard' } },
    'pass-captain-searching': { id: 'pass-captain-searching', castId: 'pass-captain', sector: 140, levelOffset: 3, statBonus: 10, loadoutId: 'defender', hold: { breakerItemId: 'quest-stand-down-order', name: 'Oath Guard' } },
    // Untamed Coast: each beast is fought where its lure was set.
    'brinejaw': { id: 'brinejaw', castId: 'brinejaw', sector: 110, levelOffset: 2, statBonus: 4, loadoutId: 'bruiser', hold: { breakerItemId: 'quest-signal-shard', name: 'Smoke Hold' } },
    'thornmother': { id: 'thornmother', castId: 'thornmother', sector: 130, levelOffset: 2, statBonus: 6, loadoutId: 'boss', hold: { breakerItemId: 'quest-pact-cutter-snare', name: 'Beast Bond' } },
    'whitemane': { id: 'whitemane', castId: 'whitemane', sector: 137, levelOffset: 2, statBonus: 7, loadoutId: 'burst', hold: { breakerItemId: 'quest-ember-senbon', name: 'Rime Lock' } },
};

/**
 * Join what a quest asks with what is said in it (api/quests/_coast-script.ts):
 * the two framing scenes, and each step's lines by its stage key. A line that
 * already carries its own (the Rounds do) keeps them.
 */
function scripted(lines: Readonly<Record<string, QuestLine>>): Record<string, QuestLine> {
    return Object.fromEntries(Object.entries(lines).map(([id, line]) => {
        const script = Object.hasOwn(COAST_SCRIPT, id) ? COAST_SCRIPT[id] : undefined;
        if (!script) return [id, line];
        return [id, {
            ...line,
            scenes: { offer: script.offer, done: script.done },
            stages: line.stages.map(stage => {
                const said = script.stages && Object.hasOwn(script.stages, stage.key) ? { ...stage, say: script.stages[stage.key] } : stage;
                // What each clue inside a building teaches, from the script's `clues`.
                return said.kind === 'enter' && said.clues && script.clues
                    ? { ...said, clues: said.clues.map(clue => (Object.hasOwn(script.clues!, clue.key) ? { ...clue, say: script.clues![clue.key] } : clue)) }
                    : said;
            }),
        }];
    }));
}

/**
 * Everything the game offers: the twenty quests above, then each region's
 * Rounds (api/quests/_coast-rounds.ts) and the ten side tales
 * (api/quests/_coast-tales.ts), each with its script joined on.
 */
export const QUEST_LINE_CATALOGUE: QuestLineCatalogue = {
    lines: scripted({ ...QUEST_LINES, ...COAST_ROUND_LINES, ...COAST_TALE_LINES }),
    recipes: QUEST_LINE_RECIPES,
    // The twenty quests' bosses take forms as their health falls (_coast-boss-forms.ts). Rounds and tale fights do not.
    fights: { ...withCoastBossForms(QUEST_LINE_FIGHTS), ...COAST_ROUND_FIGHTS, ...COAST_TALE_FIGHTS },
    isQuestOnlyItem,
    isKeptItem: isKeptQuestMaterial,
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(Number(n) || 0)));

/**
 * Ryo for finishing a quest line: the Quest Book's curve (weight x (40 + level
 * x 5)), with a higher weight ceiling because a quest line is several times
 * longer than an epic. A quest's fights pay the ordinary purse on top of it.
 *
 * Reward amounts were settled 2026-11-20 (the owner asked for them to be
 * decided for the game and its players):
 *   - Ryo keeps the Quest Book's curve and the weights above. It is the game's
 *     own standard for a one-time quest.
 *   - Stat points total 505 across the twenty quests, 455 without a clan. That
 *     is a little under what the village story pays over the same levels: 520
 *     from its level 75, 85 and 100 milestones. They rise with the quest: 10 for
 *     the shortest, 80 for the finale, which stays well under the story finale's
 *     250. While the coast opened at level 50 the same rule gave 645 against the
 *     story's 660; the owner moved the coast to level 75 on 2026-11-21 and asked
 *     for the stat points to be rescaled with it, so each amount is 0.79 of what
 *     it was, rounded to a five.
 *   - Fate Shards stay at 0 or 1 a quest, as the Quest Book pays. Bone Charms
 *     (1 or 2) and Aura Stones (3 in all) stay small, as the owner ruled: a
 *     ranked podium pays 3 to 10 Aura Stones a season.
 *   - Gear: ten quests also carry a 20 percent chance of one gear piece (owner,
 *     2026-11-20: "some of them can have like a 20% chance to drop gear"). They
 *     are the six Crossing War quests and the last quest of each side series,
 *     the ones that end a region or a story. It is an ordinary gear step drop
 *     of the player's own tier (api/quests/_gear.ts), so two pieces is what a
 *     player who finishes everything can expect.
 * api/quests/_catalog.test.ts pins the stat point totals and the gear chances.
 */
export function questLineRyo(level: number, weight: number): number {
    return clamp(weight, 1, 40) * (40 + clamp(level, 1, 100) * 5);
}

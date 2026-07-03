"use strict";
/*
 * Legacy definitions — the canonical roster of 100 earned identity paths.
 *
 * Legacies are COMPLETELY SEPARATE from bloodlines: nothing in this module may
 * read or reference bloodline data, and eligibility is computed purely from the
 * server-owned activity counters in `legacy:stats:<player>` (api/_legacy-track.ts).
 *
 * Rarity distribution (design spec): 10 mythic, 25 legendary, 50 rare, 15 basic.
 * A definitions-lint test (api/_legacy-defs.test.ts) enforces the counts, unique
 * ids, and the multi-proof rule (mythic requirements span >= 4 stat categories,
 * legendary >= 2) so a mis-authored entry fails `npm test` instead of shipping.
 *
 * Requirement numbers are the launch baseline for what a player achieved from
 * level 1-50 — mythic is intentionally brutal. All thresholds are tunable at
 * runtime through the `shared:legacy-defs` admin overlay (see _legacy-score.ts)
 * without a deploy, so balancing passes never need to edit this file.
 *
 * Specialty Jutsu: every Legacy grants one signature jutsu, authored in
 * shinobij.client/src/data/legacy-jutsu.ts and generated into the server
 * catalog api/pvp/_legacy-jutsu-catalog.ts — `specialtyJutsuId` is derived from
 * that catalog at construction (see LEGACY_DEFS below).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXPECTED_RARITY_COUNTS = exports.RARITY_ORDER = exports.LEGACY_MIN_LEVEL = exports.LEGACY_BY_ID = exports.LEGACY_DEFS = exports.STAT_CATEGORY = void 0;
const _legacy_jutsu_catalog_js_1 = require("./pvp/_legacy-jutsu-catalog.js");
/** Which category a stat counts toward for the multi-proof rarity rule. */
exports.STAT_CATEGORY = {
    ninjutsuKills: 'ninjutsu', ninjutsuDamage: 'ninjutsu',
    genjutsuKills: 'genjutsu', genjutsuDamage: 'genjutsu', genjutsuControlUses: 'genjutsu',
    taijutsuKills: 'taijutsu', taijutsuDamage: 'taijutsu',
    bukijutsuKills: 'bukijutsu', bukijutsuDamage: 'bukijutsu',
    pvpWins: 'pvp', pvpLosses: 'pvp', pvpKills: 'pvp', rankedWins: 'pvp',
    sameRankWins: 'pvp', higherLevelWins: 'pvp', defensiveWins: 'pvp',
    comebackWins: 'pvp', bestKillStreak: 'pvp', warPvpKills: 'war',
    arenaTournaments: 'pvp',
    pveKills: 'pve', eliteKills: 'pve', missionCompletions: 'pve',
    huntCompletions: 'pve', raidsCompleted: 'war', bossContribution: 'pve',
    dungeonClears: 'pve', hollowGateClears: 'pve', endlessTowerBest: 'pve',
    weeklyBossTop10: 'pve',
    tilesExplored: 'explorer', sectorDiscoveries: 'explorer',
    hiddenFinds: 'explorer', biomesVisited: 'explorer', wandererQuests: 'explorer',
    villageDonations: 'village', warContribution: 'war', sectorCaptures: 'war',
    sectorDefenses: 'war', warMissions: 'village', warsWon: 'war',
    warMvps: 'war', villageTenureDays: 'village',
    healingDone: 'support', shieldsApplied: 'support', cleansesUsed: 'support',
    damageBlocked: 'support',
    petDuelWins: 'pets', petExpeditions: 'pets', cardClashWins: 'cards',
    firstClears: 'mythic', eventCompletions: 'mythic',
};
const r = (stat, atLeast, weight) => weight === undefined ? { stat, atLeast } : { stat, atLeast, weight };
// ————————————————————————————————————————————————————————————————————————
// MYTHIC (10) — multi-category mountains. A level-50 mythic candidate has
// dominated several arenas of play at once; most players will never hold one.
// ————————————————————————————————————————————————————————————————————————
const MYTHIC = [
    {
        // Identity category is 'explorer' (the pioneer who "lit the way first"),
        // never 'mythic' — that would surface the owner-only rarity as a codex
        // tab. Still a mythic-RARITY path; its reqs/trials are unchanged in bite.
        id: 'first-flame', name: 'Legacy of the First Flame', rarity: 'mythic', category: 'explorer',
        title: 'First Flame Bearer',
        flavor: 'Before the roads had names, someone had to walk them burning. The world remembers who lit the way first.',
        reqs: [r('firstClears', 1, 3), r('missionCompletions', 600), r('pveKills', 3000), r('warContribution', 200_000), r('eventCompletions', 10), r('tilesExplored', 2000)],
    },
    {
        // Renamed from "Gate Opener" — it collided with the legendary
        // Gatebreaker in both name and (formerly) badge art (depth audit).
        id: 'gate-opener', name: 'Legacy of the Sundered Seal', rarity: 'mythic', category: 'pve',
        title: 'Sundered Seal',
        flavor: 'The seal beneath Central does not crack for the curious. It cracks for the one who kept coming back.',
        reqs: [r('hollowGateClears', 75, 3), r('dungeonClears', 40), r('eliteKills', 500), r('bossContribution', 1_000_000), r('firstClears', 1), r('hiddenFinds', 30), r('damageBlocked', 500_000)],
    },
    {
        id: 'hundred-storms', name: 'Legacy of the Hundred Storms', rarity: 'mythic', category: 'ninjutsu',
        title: 'Hundred Storms',
        flavor: 'Ninjutsu, genjutsu, taijutsu, bukijutsu — the storm does not choose one wind. It is all of them at once.',
        reqs: [r('ninjutsuKills', 400), r('genjutsuKills', 400), r('taijutsuKills', 400), r('bukijutsuKills', 400), r('pveKills', 3000)],
    },
    {
        id: 'duel-sovereign', name: 'Legacy of the Duel Sovereign', rarity: 'mythic', category: 'pvp',
        title: 'Duel Sovereign',
        flavor: 'Kings are crowned. Sovereigns are proven — one challenger at a time, none of them lesser, none of them lucky.',
        reqs: [r('pvpWins', 400, 3), r('sameRankWins', 150), r('bestKillStreak', 15), r('rankedWins', 120), r('higherLevelWins', 60), r('warPvpKills', 50), r('eliteKills', 200), r('eventCompletions', 8)],
    },
    {
        id: 'silent-empire', name: 'Legacy of the Silent Empire', rarity: 'mythic', category: 'genjutsu',
        title: 'Silent Emperor',
        flavor: 'No banners, no borders, no decree ever spoken aloud. An empire built entirely of moments its subjects cannot remember.',
        reqs: [r('genjutsuKills', 800, 3), r('genjutsuDamage', 600_000), r('pvpWins', 200), r('defensiveWins', 75), r('missionCompletions', 400), r('sectorDiscoveries', 100)],
    },
    {
        id: 'last-bastion', name: 'Legacy of the Last Bastion', rarity: 'mythic', category: 'support',
        title: 'The Last Bastion',
        flavor: 'When every other wall fell, the line held — because the line was a person.',
        reqs: [r('healingDone', 500_000, 3), r('damageBlocked', 1_000_000), r('shieldsApplied', 800), r('sectorDefenses', 25), r('defensiveWins', 100), r('villageTenureDays', 45)],
    },
    {
        id: 'founders-shadow', name: "Legacy of the Founder's Shadow", rarity: 'mythic', category: 'village',
        title: "Founder's Shadow",
        flavor: 'Some serve a village. A very few become the thing the village quietly stands on.',
        reqs: [r('villageTenureDays', 75, 3), r('villageDonations', 1_000_000), r('warsWon', 12), r('warPvpKills', 150), r('sectorCaptures', 25), r('missionCompletions', 500), r('defensiveWins', 50)],
    },
    {
        // Identity category is 'pve' (the world-boss/great-beast slayer), never
        // 'mythic' — the rarity stays hidden. Still a mythic-RARITY path.
        id: 'world-awakener', name: 'Legacy of the World Awakener', rarity: 'mythic', category: 'pve',
        title: 'World Awakener',
        flavor: 'The great beasts do not stir for armies. They stir for the one name the world keeps repeating.',
        reqs: [r('weeklyBossTop10', 8, 3), r('bossContribution', 1_200_000), r('eventCompletions', 15), r('pvpWins', 150), r('firstClears', 1), r('warContribution', 100_000)],
    },
    {
        id: 'horizons-end', name: "Legacy of the Horizon's End", rarity: 'mythic', category: 'explorer',
        title: "Horizon's End",
        flavor: 'Maps end where courage does. Somewhere past the last drawn line, the horizon finally learned this one’s name.',
        reqs: [r('tilesExplored', 2400, 3), r('sectorDiscoveries', 250), r('hiddenFinds', 60), r('wandererQuests', 75), r('huntCompletions', 150), r('petExpeditions', 50), r('eventCompletions', 8)],
    },
    {
        id: 'deathless-ember', name: 'Legacy of the Deathless Ember', rarity: 'mythic', category: 'taijutsu',
        title: 'Deathless Ember',
        flavor: 'Extinguished a hundred times, and a hundred times the coal came back red. Some fires simply refuse the dark.',
        reqs: [r('comebackWins', 40, 3), r('defensiveWins', 100), r('pvpWins', 250), r('hollowGateClears', 40), r('eliteKills', 400), r('taijutsuDamage', 400_000), r('damageBlocked', 800_000)],
    },
];
// ————————————————————————————————————————————————————————————————————————
// LEGENDARY (25) — a major milestone identity: one dominant path proven with
// at least two supporting arenas. Roughly the top few percent of level-50s.
// ————————————————————————————————————————————————————————————————————————
const LEGENDARY = [
    // — combat styles (2 per style) —
    {
        id: 'elemental-cataclysm', name: 'Legacy of the Elemental Cataclysm', rarity: 'legendary', category: 'ninjutsu',
        title: 'Cataclysm', flavor: 'Where this one fought, the weather still has not settled.',
        reqs: [r('ninjutsuDamage', 600_000, 2), r('ninjutsuKills', 600), r('pveKills', 1500)],
    },
    {
        id: 'thousand-seals', name: 'Legacy of the Thousand Seals', rarity: 'legendary', category: 'ninjutsu',
        title: 'Thousand Seals', flavor: 'Hands faster than doubt. Every seal a promise the enemy could not read in time.',
        reqs: [r('ninjutsuKills', 500, 2), r('missionCompletions', 400), r('eliteKills', 200)],
    },
    {
        id: 'moonlit-ghost', name: 'Legacy of the Moonlit Ghost', rarity: 'legendary', category: 'genjutsu',
        villageAffinity: 'Moonshadow', title: 'Moonlit Ghost',
        flavor: 'Seen only twice: once in the moment before, and once in the nightmare after.',
        reqs: [r('genjutsuKills', 600, 2), r('pvpWins', 150), r('sectorDiscoveries', 80)],
    },
    {
        id: 'void-whisper', name: 'Legacy of the Void Whisper', rarity: 'legendary', category: 'genjutsu',
        title: 'Void Whisper', flavor: 'It never raised its voice. It lowered the world’s instead.',
        reqs: [r('genjutsuKills', 400, 2), r('genjutsuDamage', 350_000), r('defensiveWins', 40)],
    },
    {
        id: 'arena-demon', name: 'Legacy of the Arena Demon', rarity: 'legendary', category: 'taijutsu',
        title: 'Arena Demon', flavor: 'The crowd stopped betting on outcomes years ago. Now they only bet on how long.',
        reqs: [r('taijutsuKills', 600, 2), r('pvpWins', 150), r('sameRankWins', 40)],
    },
    {
        id: 'unbroken-body', name: 'Legacy of the Unbroken Body', rarity: 'legendary', category: 'taijutsu',
        title: 'Unbroken',
        flavor: 'Bones remember every fracture. These bones remember winning anyway.',
        reqs: [r('taijutsuDamage', 500_000, 2), r('damageBlocked', 700_000), r('comebackWins', 15)],
    },
    {
        id: 'blade-saint', name: 'Legacy of the Blade Saint', rarity: 'legendary', category: 'bukijutsu',
        title: 'Blade Saint', flavor: 'To others, ten thousand draws of the sword. To the saint, one draw — practiced ten thousand times.',
        reqs: [r('bukijutsuKills', 700, 2), r('bukijutsuDamage', 500_000), r('sameRankWins', 50)],
    },
    {
        id: 'thousand-cuts', name: 'Legacy of the Thousand Cuts', rarity: 'legendary', category: 'bukijutsu',
        title: 'Thousand Cuts', flavor: 'No single wound was fatal. That was never the point.',
        reqs: [r('bukijutsuKills', 500, 2), r('pveKills', 1500), r('huntCompletions', 150)],
    },
    // — pvp (3) —
    {
        id: 'duel-king', name: 'Legacy of the Duel King', rarity: 'legendary', category: 'pvp',
        title: 'Duel King',
        flavor: 'The throne is a circle of scorched ground, and nobody has taken it back yet.',
        reqs: [r('pvpWins', 200, 2), r('rankedWins', 60), r('bestKillStreak', 10), r('eliteKills', 150)],
    },
    {
        id: 'village-reaper', name: 'Legacy of the Village Reaper', rarity: 'legendary', category: 'war',
        title: 'Village Reaper', flavor: 'Ask a fallen sector who took it, and watch how quiet the survivors get.',
        reqs: [r('warPvpKills', 100, 2), r('warsWon', 8), r('pvpWins', 150)],
    },
    {
        id: 'bloodstained-path', name: 'Legacy of the Bloodstained Path', rarity: 'legendary', category: 'pvp',
        title: 'Bloodstained', flavor: 'Every step of the road behind is marked. The road ahead has already started bleeding.',
        reqs: [r('pvpKills', 250, 2), r('higherLevelWins', 30), r('comebackWins', 15), r('huntCompletions', 80)],
    },
    // — pve (3) —
    {
        id: 'gatebreaker', name: 'Legacy of the Gatebreaker', rarity: 'legendary', category: 'pve',
        title: 'Gatebreaker',
        flavor: 'Doors are a suggestion. Ancient sealed doors are a slightly longer suggestion.',
        reqs: [r('hollowGateClears', 30, 2), r('eliteKills', 200), r('bossContribution', 400_000), r('hiddenFinds', 15)],
    },
    {
        id: 'trial-conqueror', name: 'Legacy of the Trial Conqueror', rarity: 'legendary', category: 'pve',
        title: 'Trial Conqueror', flavor: 'The trials were built to find the limit of a shinobi. They are still looking.',
        reqs: [r('dungeonClears', 40, 2), r('endlessTowerBest', 40), r('missionCompletions', 400), r('tilesExplored', 1500)],
    },
    {
        id: 'ancient-hunter', name: 'Legacy of the Ancient Hunter', rarity: 'legendary', category: 'pve',
        title: 'Ancient Hunter', flavor: 'The old beasts teach one lesson each. This hunter finished the whole curriculum.',
        reqs: [r('huntCompletions', 150, 2), r('eliteKills', 250), r('hiddenFinds', 25)],
    },
    // — village champions (4) —
    {
        id: 'ashen-will', name: 'Legacy of the Ashen Will', rarity: 'legendary', category: 'village',
        villageAffinity: 'Ashen Leaf', title: 'Ashen Will',
        flavor: 'Ashen Leaf endures because someone always chooses to be the ember that will not go out.',
        reqs: [r('villageTenureDays', 45, 2), r('villageDonations', 250_000), r('warContribution', 30_000), r('sectorDefenses', 12)],
    },
    {
        id: 'storm-fang', name: 'Legacy of the Storm Fang', rarity: 'legendary', category: 'village',
        villageAffinity: 'Stormveil', title: 'Storm Fang',
        flavor: 'Stormveil does not wait for weather. It sends its own.',
        reqs: [r('villageTenureDays', 45, 2), r('warPvpKills', 60), r('raidsCompleted', 40), r('warsWon', 6)],
    },
    {
        id: 'frostbound-shield', name: 'Legacy of the Frostbound Shield', rarity: 'legendary', category: 'village',
        villageAffinity: 'Frostfang', title: 'Frostbound Shield',
        flavor: 'The north holds because its shield never asks how cold it is.',
        reqs: [r('villageTenureDays', 45, 2), r('sectorDefenses', 18), r('damageBlocked', 500_000), r('defensiveWins', 40)],
    },
    {
        id: 'moonlit-oath', name: 'Legacy of the Moonlit Oath', rarity: 'legendary', category: 'village',
        villageAffinity: 'Moonshadow', title: 'Oath of the Moon',
        flavor: 'Moonshadow keeps no written oaths. It keeps kept ones.',
        reqs: [r('villageTenureDays', 45, 2), r('genjutsuKills', 300), r('sectorDiscoveries', 80), r('warContribution', 30_000)],
    },
    // — support (2) —
    {
        id: 'village-guardian', name: 'Legacy of the Village Guardian', rarity: 'legendary', category: 'support',
        title: 'Village Guardian',
        flavor: 'Heroes are counted by the battles they won. Guardians, by the ones nobody else had to fight.',
        reqs: [r('healingDone', 400_000, 2), r('shieldsApplied', 600), r('sectorDefenses', 15)],
    },
    {
        id: 'oathkeeper', name: 'Legacy of the Oathkeeper', rarity: 'legendary', category: 'support',
        title: 'Oathkeeper', flavor: 'Promised to stand between. Has never once defined between what.',
        reqs: [r('shieldsApplied', 400, 2), r('healingDone', 250_000), r('defensiveWins', 40), r('sectorDefenses', 8)],
    },
    // — explorer (2) —
    {
        id: 'mapless-one', name: 'Legacy of the Mapless One', rarity: 'legendary', category: 'explorer',
        title: 'The Mapless One', flavor: 'Threw the map away at the first fork. The land has been introducing itself ever since.',
        reqs: [r('tilesExplored', 2400, 2), r('sectorDiscoveries', 60), r('hiddenFinds', 25), r('huntCompletions', 80)],
    },
    {
        id: 'shrine-seeker', name: 'Legacy of the Shrine Seeker', rarity: 'legendary', category: 'explorer',
        title: 'Shrine Seeker', flavor: 'Every forgotten shrine has one visitor left. They are all the same visitor.',
        reqs: [r('sectorDiscoveries', 100, 2), r('wandererQuests', 40), r('tilesExplored', 2000), r('missionCompletions', 250)],
    },
    // — pets / cards / war (3) —
    {
        id: 'beast-sovereign', name: 'Legacy of the Beast Sovereign', rarity: 'legendary', category: 'pets',
        title: 'Beast Sovereign', flavor: 'Every beast in the wild owes this one a scar, a meal, or a life — and they pay their debts in loyalty.',
        reqs: [r('petDuelWins', 100, 2), r('petExpeditions', 80), r('eliteKills', 150)],
    },
    {
        id: 'silent-gambit', name: 'Legacy of the Silent Gambit', rarity: 'legendary', category: 'cards',
        title: 'The Silent Gambit', flavor: 'Won the hall’s deadliest hands without ever once needing the cards to be good.',
        reqs: [r('cardClashWins', 120, 2), r('pvpWins', 40), r('missionCompletions', 300)],
    },
    {
        // Title renamed from "Warborn" — it read as an accidental collision
        // with the rare Warborn Blade (depth audit).
        id: 'warborn-banner', name: 'Legacy of the Warborn Banner', rarity: 'legendary', category: 'war',
        title: 'Bannerlord',
        flavor: 'Some carry the banner. Some are what the banner is a picture of.',
        reqs: [r('warsWon', 8, 2), r('warPvpKills', 40), r('warContribution', 60_000), r('raidsCompleted', 50), r('pvpWins', 100)],
    },
];
// ————————————————————————————————————————————————————————————————————————
// RARE (50) — a clear, earned identity in one path with light supporting
// proof. The workhorse tier: most dedicated level-50s qualify for a few.
// ————————————————————————————————————————————————————————————————————————
const RARE = [
    // — ninjutsu (4) —
    { id: 'elemental-storm', name: 'Legacy of the Elemental Storm', rarity: 'rare', category: 'ninjutsu', title: 'Elemental Storm',
        flavor: 'Five elements, one temper.', reqs: [r('ninjutsuKills', 250, 2), r('ninjutsuDamage', 150_000)] },
    { id: 'burning-vanguard', name: 'Legacy of the Burning Vanguard', rarity: 'rare', category: 'ninjutsu', villageAffinity: 'Ashen Leaf', title: 'Burning Vanguard',
        flavor: 'First through every breach, and the breach is usually on fire because of them.', reqs: [r('ninjutsuKills', 200, 2), r('raidsCompleted', 25)] },
    { id: 'chakra-tempest', name: 'Legacy of the Chakra Tempest', rarity: 'rare', category: 'ninjutsu', title: 'Chakra Tempest',
        flavor: 'Too much power, aimed just well enough.', reqs: [r('ninjutsuDamage', 250_000, 2), r('pveKills', 600)] },
    { id: 'stormcallers-path', name: "Legacy of the Stormcaller's Path", rarity: 'rare', category: 'ninjutsu', villageAffinity: 'Stormveil', title: 'Stormcaller',
        flavor: 'Learned ninjutsu the Stormveil way: outside, mid-tempest, on purpose.', reqs: [r('ninjutsuKills', 200, 2), r('raidsCompleted', 20)] },
    // — genjutsu (4) —
    { id: 'shadow-strategist', name: 'Legacy of the Shadow Strategist', rarity: 'rare', category: 'genjutsu', title: 'Shadow Strategist',
        flavor: 'Wins the fight during the bow before it.', reqs: [r('genjutsuKills', 200, 2), r('genjutsuDamage', 120_000)] },
    { id: 'silent-fang', name: 'Legacy of the Silent Fang', rarity: 'rare', category: 'genjutsu', villageAffinity: 'Moonshadow', title: 'Silent Fang',
        flavor: 'The bite arrives before the bark, instead of it.', reqs: [r('genjutsuKills', 200, 2), r('bestKillStreak', 5)] },
    { id: 'dream-weaver', name: 'Legacy of the Dream Weaver', rarity: 'rare', category: 'genjutsu', title: 'Dream Weaver',
        flavor: 'Enemies wake up defeated and rested. Nobody knows how to feel about it.', reqs: [r('genjutsuKills', 150, 2), r('healingDone', 30_000)] },
    { id: 'mirage-dancer', name: 'Legacy of the Mirage Dancer', rarity: 'rare', category: 'genjutsu', title: 'Mirage Dancer',
        flavor: 'Every step is a lie, and every lie lands.', reqs: [r('genjutsuDamage', 150_000, 2), r('defensiveWins', 15)] },
    // — taijutsu (4) —
    { id: 'iron-fist', name: 'Legacy of the Iron Fist', rarity: 'rare', category: 'taijutsu', title: 'Iron Fist',
        flavor: 'The training posts filed a complaint. It was denied.', reqs: [r('taijutsuKills', 250, 2), r('taijutsuDamage', 150_000)] },
    { id: 'bloodied-knuckle', name: 'Legacy of the Bloodied Knuckle', rarity: 'rare', category: 'taijutsu', title: 'Bloodied Knuckle',
        flavor: 'No weapon ever felt necessary.', reqs: [r('taijutsuKills', 200, 2), r('pvpWins', 40)] },
    { id: 'mountain-stance', name: 'Legacy of the Mountain Stance', rarity: 'rare', category: 'taijutsu', villageAffinity: 'Frostfang', title: 'Mountain Stance',
        flavor: 'Has been moved exactly once, and still disputes it.', reqs: [r('taijutsuDamage', 200_000, 2), r('damageBlocked', 150_000)] },
    { id: 'crashing-wave', name: 'Legacy of the Crashing Wave', rarity: 'rare', category: 'taijutsu', villageAffinity: 'Stormveil', title: 'Crashing Wave',
        flavor: 'Stormveil taijutsu: hit like the tide, leave like it too.', reqs: [r('taijutsuKills', 200, 2), r('comebackWins', 8)] },
    // — bukijutsu (4) —
    { id: 'warborn-blade', name: 'Legacy of the Warborn Blade', rarity: 'rare', category: 'bukijutsu', title: 'Warborn Blade',
        flavor: 'Forged in a war, quenched in the next one.', reqs: [r('bukijutsuKills', 250, 2), r('bukijutsuDamage', 150_000)] },
    { id: 'crimson-duelist', name: 'Legacy of the Crimson Duelist', rarity: 'rare', category: 'bukijutsu', title: 'Crimson Duelist',
        flavor: 'Accepts every duel, apologizes to none of them.', reqs: [r('bukijutsuKills', 200, 2), r('sameRankWins', 15)] },
    { id: 'quiet-scabbard', name: 'Legacy of the Quiet Scabbard', rarity: 'rare', category: 'bukijutsu', title: 'Quiet Scabbard',
        flavor: 'The blade speaks once per conversation.', reqs: [r('bukijutsuDamage', 200_000, 2), r('sameRankWins', 15)] },
    { id: 'hunters-edge', name: "Legacy of the Hunter's Edge", rarity: 'rare', category: 'bukijutsu', title: "Hunter's Edge",
        flavor: 'Every notch on the haft is a story the prey did not finish.', reqs: [r('bukijutsuKills', 200, 2), r('huntCompletions', 50)] },
    // — pvp (4) —
    { id: 'proving-grounds', name: 'Legacy of the Proving Grounds', rarity: 'rare', category: 'pvp', title: 'Proven',
        flavor: 'Never asks for a rematch. Never needs one.', reqs: [r('pvpWins', 75, 2), r('sameRankWins', 20)] },
    { id: 'ranked-ascendant', name: 'Legacy of the Ranked Ascendant', rarity: 'rare', category: 'pvp', title: 'Ascendant',
        flavor: 'The ladder was climbed with other climbers still on it.', reqs: [r('rankedWins', 25, 2), r('pvpWins', 50)] },
    { id: 'giant-slayer', name: 'Legacy of the Giant Slayer', rarity: 'rare', category: 'pvp', title: 'Giant Slayer',
        flavor: 'Reads level differences as suggestions.', reqs: [r('higherLevelWins', 10, 2), r('pvpWins', 40)] },
    { id: 'wall-of-defiance', name: 'Legacy of the Wall of Defiance', rarity: 'rare', category: 'pvp', title: 'The Wall',
        flavor: 'Challengers arrive with plans. They leave with respect for masonry.', reqs: [r('defensiveWins', 15, 2), r('comebackWins', 5)] },
    // — pve (6) —
    { id: 'hollow-seeker', name: 'Legacy of the Hollow Seeker', rarity: 'rare', category: 'pve', title: 'Hollow Seeker',
        flavor: 'The Gate whispers to everyone. This one whispers back.', reqs: [r('hollowGateClears', 10, 2), r('eliteKills', 60)] },
    { id: 'tower-climber', name: 'Legacy of the Endless Ascent', rarity: 'rare', category: 'pve', title: 'Endless Ascent',
        flavor: 'The tower is infinite. Their patience is merely very large.', reqs: [r('endlessTowerBest', 25, 2), r('pveKills', 500)] },
    { id: 'mission-hound', name: 'Legacy of the Mission Hound', rarity: 'rare', category: 'pve', title: 'Mission Hound',
        flavor: 'The board runs out of postings before they run out of morning.', reqs: [r('missionCompletions', 250, 2), r('huntCompletions', 40)] },
    { id: 'beast-tracker', name: 'Legacy of the Beast Tracker', rarity: 'rare', category: 'pve', title: 'Beast Tracker',
        flavor: 'Knows every hunt by its footprints, and several by first name.', reqs: [r('huntCompletions', 60, 2), r('eliteKills', 60)] },
    { id: 'boss-breaker', name: 'Legacy of the Boss Breaker', rarity: 'rare', category: 'pve', title: 'Boss Breaker',
        flavor: 'Big health bars are just long to-do lists.', reqs: [r('bossContribution', 100_000, 2), r('weeklyBossTop10', 1)] },
    { id: 'dungeon-delver', name: 'Legacy of the Dungeon Delver', rarity: 'rare', category: 'pve', title: 'Dungeon Delver',
        flavor: 'If it is dark, locked, and humming — they are already inside.', reqs: [r('dungeonClears', 15, 2), r('tilesExplored', 800)] },
    // — village (8: 2 per village) —
    { id: 'ashen-hearth', name: 'Legacy of the Ashen Hearth', rarity: 'rare', category: 'village', villageAffinity: 'Ashen Leaf', title: 'Hearthkeeper',
        flavor: 'Ashen Leaf’s fires stay lit because someone keeps feeding them quietly.', reqs: [r('villageTenureDays', 21, 2), r('villageDonations', 50_000)] },
    { id: 'embers-discipline', name: "Legacy of the Ember's Discipline", rarity: 'rare', category: 'village', villageAffinity: 'Ashen Leaf', title: 'Ember Disciple',
        flavor: 'Trained where the drills end when the instructor gets bored. The instructor never gets bored.', reqs: [r('villageTenureDays', 21, 2), r('pveKills', 400)] },
    { id: 'tidebreaker', name: 'Legacy of the Tidebreaker', rarity: 'rare', category: 'village', villageAffinity: 'Stormveil', title: 'Tidebreaker',
        flavor: 'Stormveil counts its storms survived. This one counts storms caused.', reqs: [r('villageTenureDays', 21, 2), r('warPvpKills', 25)] },
    { id: 'thunder-raider', name: 'Legacy of the Thunder Raider', rarity: 'rare', category: 'village', villageAffinity: 'Stormveil', title: 'Thunder Raider',
        flavor: 'Arrives with the thunder. The lightning is just the announcement.', reqs: [r('villageTenureDays', 21, 2), r('raidsCompleted', 25)] },
    { id: 'northern-fang', name: 'Legacy of the Northern Fang', rarity: 'rare', category: 'village', villageAffinity: 'Frostfang', title: 'Northern Fang',
        flavor: 'In the north the frost bites first — and it learned the hard way who bites back.', reqs: [r('villageTenureDays', 21, 2), r('sectorDefenses', 8)] },
    { id: 'winter-sentinel', name: 'Legacy of the Winter Sentinel', rarity: 'rare', category: 'village', villageAffinity: 'Frostfang', title: 'Winter Sentinel',
        flavor: 'Stood the long watch. The long watch blinked first.', reqs: [r('villageTenureDays', 21, 2), r('defensiveWins', 12)] },
    { id: 'veiled-lantern', name: 'Legacy of the Veiled Lantern', rarity: 'rare', category: 'village', villageAffinity: 'Moonshadow', title: 'Veiled Lantern',
        flavor: 'Moonshadow’s streets are safe because something politely unseen keeps them so.', reqs: [r('villageTenureDays', 21, 2), r('sectorDiscoveries', 30)] },
    { id: 'midnight-errand', name: 'Legacy of the Midnight Errand', rarity: 'rare', category: 'village', villageAffinity: 'Moonshadow', title: 'Midnight Runner',
        flavor: 'The missions nobody logs, delivered by the shinobi nobody saw.', reqs: [r('villageTenureDays', 21, 2), r('missionCompletions', 150)] },
    // — explorer (4) —
    { id: 'hidden-path', name: 'Legacy of the Hidden Path', rarity: 'rare', category: 'explorer', title: 'Pathfinder',
        flavor: 'Shortcuts are just long-cuts nobody was brave enough to check.', reqs: [r('tilesExplored', 1200, 2), r('hiddenFinds', 8)] },
    { id: 'wayfarers-mark', name: "Legacy of the Wayfarer's Mark", rarity: 'rare', category: 'explorer', title: 'Wayfarer',
        flavor: 'Home is a direction, not an address.', reqs: [r('tilesExplored', 1000, 2), r('wandererQuests', 10)] },
    { id: 'rumor-chaser', name: 'Legacy of the Rumor Chaser', rarity: 'rare', category: 'explorer', title: 'Rumor Chaser',
        flavor: 'Every tall tale in every tavern gets personally fact-checked.', reqs: [r('sectorDiscoveries', 40, 2), r('wandererQuests', 15)] },
    { id: 'strangers-friend', name: "Legacy of the Stranger's Friend", rarity: 'rare', category: 'explorer', title: "Stranger's Friend",
        flavor: 'Wanderers on every road owe this one a favor, a meal, or an apology.', reqs: [r('wandererQuests', 25, 2), r('sectorDiscoveries', 25)] },
    // — support (3) —
    { id: 'shielding-palm', name: 'Legacy of the Shielding Palm', rarity: 'rare', category: 'support', title: 'Shielding Palm',
        flavor: 'An open hand that has stopped more blades than most swords.', reqs: [r('shieldsApplied', 200, 2), r('damageBlocked', 100_000)] },
    { id: 'field-medic', name: 'Legacy of the Field Medic', rarity: 'rare', category: 'support', title: 'Field Medic',
        flavor: 'Runs toward the scream. Bills nobody.', reqs: [r('healingDone', 50_000, 2), r('missionCompletions', 100)] },
    { id: 'purifying-light', name: 'Legacy of the Purifying Light', rarity: 'rare', category: 'support', title: 'Purifier',
        flavor: 'Curses, poisons, despair — all laundry, all washable.', reqs: [r('healingDone', 60_000, 2), r('defensiveWins', 10)] },
    // — pets (3) —
    { id: 'pack-leader', name: 'Legacy of the Pack Leader', rarity: 'rare', category: 'pets', title: 'Pack Leader',
        flavor: 'Speaks fluent growl, purr, and dramatic silence.', reqs: [r('petDuelWins', 50, 2), r('petExpeditions', 20)] },
    { id: 'wild-heart', name: 'Legacy of the Wild Heart', rarity: 'rare', category: 'pets', title: 'Wild Heart',
        flavor: 'Half the menagerie followed them home. The other half is en route.', reqs: [r('petExpeditions', 40, 2), r('huntCompletions', 30)] },
    { id: 'coliseum-tamer', name: 'Legacy of the Coliseum Tamer', rarity: 'rare', category: 'pets', title: 'Coliseum Tamer',
        flavor: 'The crowd chants the pet’s name. The tamer prefers it that way.', reqs: [r('petDuelWins', 75, 2), r('arenaTournaments', 8)] },
    // — cards (2) —
    { id: 'card-sharp', name: 'Legacy of the Card Sharp', rarity: 'rare', category: 'cards', title: 'Card Sharp',
        flavor: 'Shuffles like a magician, wins like an accountant.', reqs: [r('cardClashWins', 40, 2), r('missionCompletions', 100)] },
    { id: 'tables-shadow', name: "Legacy of the Table's Shadow", rarity: 'rare', category: 'cards', title: "The Table's Shadow",
        flavor: 'Nobody remembers inviting them to the game. Nobody dares un-invite them.', reqs: [r('cardClashWins', 60, 2), r('pvpWins', 25)] },
    // — war (4) —
    { id: 'sector-warden', name: 'Legacy of the Sector Warden', rarity: 'rare', category: 'war', title: 'Sector Warden',
        flavor: 'Holds ground like the ground asked them personally.', reqs: [r('sectorDefenses', 8, 2), r('warContribution', 25_000)] },
    { id: 'banner-taker', name: 'Legacy of the Banner Taker', rarity: 'rare', category: 'war', title: 'Banner Taker',
        flavor: 'Collects enemy flags the way others collect excuses.', reqs: [r('raidsCompleted', 20, 2), r('warPvpKills', 15)] },
    { id: 'siege-runner', name: 'Legacy of the Siege Runner', rarity: 'rare', category: 'war', title: 'Siege Runner',
        flavor: 'Between the lines, under the arrows, on schedule.', reqs: [r('raidsCompleted', 30, 2), r('warContribution', 20_000)] },
    { id: 'war-drummer', name: 'Legacy of the War Drummer', rarity: 'rare', category: 'war', title: 'War Drummer',
        flavor: 'Every war has a heartbeat. Someone has to be it.', reqs: [r('warContribution', 30_000, 2), r('warsWon', 3)] },
];
// ————————————————————————————————————————————————————————————————————————
// BASIC (15) — accessible identity fallbacks. Every genuine level-50 should
// qualify for several; the Sage always has something honest to offer.
// ————————————————————————————————————————————————————————————————————————
const BASIC = [
    { id: 'wandering-shinobi', name: 'Legacy of the Wandering Shinobi', rarity: 'basic', category: 'explorer', title: 'Wanderer',
        flavor: 'The road never asked for credentials. Neither did they.', reqs: [r('tilesExplored', 400)] },
    { id: 'village-veteran', name: 'Legacy of the Village Veteran', rarity: 'basic', category: 'village', title: 'Veteran',
        flavor: 'Fifty levels of showing up. It counts for more than anyone admits.', reqs: [r('villageTenureDays', 10)] },
    { id: 'proven-fighter', name: 'Legacy of the Proven Fighter', rarity: 'basic', category: 'pvp', title: 'Fighter',
        flavor: 'Not the strongest in the ring. Reliably in the ring.', reqs: [r('pvpWins', 15)] },
    { id: 'road-worn-shinobi', name: 'Legacy of the Road-Worn Shinobi', rarity: 'basic', category: 'explorer', title: 'Road-Worn',
        flavor: 'Boots resoled six times. Resolve, zero times.', reqs: [r('huntCompletions', 25)] },
    { id: 'ember-student', name: 'Legacy of the Ember Student', rarity: 'basic', category: 'ninjutsu', title: 'Ember Student',
        flavor: 'The first spark was an accident. The next thousand were not.', reqs: [r('ninjutsuKills', 60)] },
    { id: 'quiet-mind', name: 'Legacy of the Quiet Mind', rarity: 'basic', category: 'genjutsu', title: 'Quiet Mind',
        flavor: 'Learned early that the loudest jutsu is rarely the one that ends it.', reqs: [r('genjutsuKills', 60)] },
    { id: 'calloused-fist', name: 'Legacy of the Calloused Fist', rarity: 'basic', category: 'taijutsu', title: 'Calloused Fist',
        flavor: 'Gloves kept wearing out. The hands did not.', reqs: [r('taijutsuKills', 60)] },
    { id: 'steel-apprentice', name: 'Legacy of the Steel Apprentice', rarity: 'basic', category: 'bukijutsu', title: 'Steel Apprentice',
        flavor: 'First blade: borrowed. First lesson: give it back sharper.', reqs: [r('bukijutsuKills', 60)] },
    { id: 'field-hand', name: 'Legacy of the Field Hand', rarity: 'basic', category: 'pve', title: 'Field Hand',
        flavor: 'No mission too small, no ledger left unbalanced.', reqs: [r('missionCompletions', 60)] },
    { id: 'beast-friend', name: 'Legacy of the Beast Friend', rarity: 'basic', category: 'pets', title: 'Beast Friend',
        flavor: 'Was adopted by a pet, technically.', reqs: [r('petDuelWins', 10)] },
    { id: 'table-regular', name: 'Legacy of the Table Regular', rarity: 'basic', category: 'cards', title: 'Table Regular',
        flavor: 'Has a usual seat, a usual bet, and an unusual win rate.', reqs: [r('cardClashWins', 10)] },
    { id: 'lantern-bearer', name: 'Legacy of the Lantern Bearer', rarity: 'basic', category: 'support', title: 'Lantern Bearer',
        flavor: 'Someone has to hold the light. Someone always did.', reqs: [r('healingDone', 20_000)] },
    { id: 'first-steps', name: 'Legacy of the First Steps', rarity: 'basic', category: 'explorer', title: 'Trailblazer',
        flavor: 'Every map starts with somebody’s first wrong turn.', reqs: [r('sectorDiscoveries', 10)] },
    { id: 'honest-ryo', name: 'Legacy of the Honest Ryo', rarity: 'basic', category: 'village', title: 'Honest Hand',
        flavor: 'Paid their dues. Then paid a little extra, quietly.', reqs: [r('villageDonations', 10_000)] },
    { id: 'steadfast-neighbor', name: 'Legacy of the Steadfast Neighbor', rarity: 'basic', category: 'village', title: 'Steadfast',
        flavor: 'The village remembers who answered the bell without asking whose fire it was.', reqs: [r('sectorDefenses', 4)] },
];
// Every legacy has badge art at /badges/legacy-<id>.png (full 100-badge set,
// docs/legacy-assets.md §2), so `badge` is simply the id. Kept as a field
// (rather than derived at render sites) because the client LegacyDefView
// consumes it and a future legacy could still override the art.
exports.LEGACY_DEFS = [...MYTHIC, ...LEGENDARY, ...RARE, ...BASIC].map((d) => ({
    ...d,
    badge: d.badge ?? d.id,
    specialtyJutsuId: d.specialtyJutsuId ?? _legacy_jutsu_catalog_js_1.LEGACY_JUTSU_ID_BY_LEGACY[d.id],
}));
exports.LEGACY_BY_ID = new Map(exports.LEGACY_DEFS.map((d) => [d.id, d]));
/** Global minimum level for any Legacy offer (Jonin threshold). */
exports.LEGACY_MIN_LEVEL = 50;
exports.RARITY_ORDER = { basic: 0, rare: 1, legendary: 2, mythic: 3 };
/** Design-spec rarity counts, enforced by the defs lint test. */
exports.EXPECTED_RARITY_COUNTS = {
    mythic: 10, legendary: 25, rare: 50, basic: 15,
};

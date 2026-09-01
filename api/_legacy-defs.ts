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
 * level 1-50. Basic paths are one approachable proof, rare paths pair two,
 * legendary paths require 3-5 proofs, and mythics require 6-8 proofs spanning
 * at least four categories. Mythic is intentionally brutal but every floor is
 * below its real earning cap. All thresholds are tunable at runtime through the
 * `shared:legacy-defs` admin overlay (see _legacy-score.ts) without a deploy.
 *
 * Specialty Jutsu: every Legacy grants one signature jutsu, authored in
 * shinobij.client/src/data/legacy-jutsu.ts and generated into the server
 * catalog api/pvp/_legacy-jutsu-catalog.ts — `specialtyJutsuId` is derived from
 * that catalog at construction (see LEGACY_DEFS below).
 */

import { LEGACY_JUTSU_ID_BY_LEGACY } from './pvp/_legacy-jutsu-catalog.js';

export type LegacyRarity = 'basic' | 'rare' | 'legendary' | 'mythic';

// NB: 'mythic' is an INTERNAL bucket only — `firstClears`/`eventCompletions`
// map to it for the multi-proof lint (STAT_CATEGORY below), and it labels a
// (now unused) trial template. NO legacy may carry `category: 'mythic'`:
// `category` is a player-facing identity facet (the codex tabs, the "your X
// path is…" whispers), and a "Mythic" facet would leak the owner-only rarity
// the whole system hides — swaying the choice by its tier (the mystery rule).
// A mythic-RARITY legacy lives in a real identity category (see first-flame →
// explorer, world-awakener → pve). A lint in _legacy-defs.test.ts enforces this.
export type LegacyCategory =
    | 'ninjutsu' | 'genjutsu' | 'taijutsu' | 'bukijutsu'
    | 'pvp' | 'pve' | 'village' | 'support' | 'explorer'
    | 'pets' | 'cards' | 'war' | 'mythic';

/** Flat server-owned counters tracked per player (see api/_legacy-track.ts). */
export type LegacyStatKey =
    // combat style
    | 'ninjutsuKills' | 'ninjutsuDamage'
    | 'genjutsuKills' | 'genjutsuDamage' | 'genjutsuControlUses'
    | 'taijutsuKills' | 'taijutsuDamage'
    | 'bukijutsuKills' | 'bukijutsuDamage'
    // pvp
    | 'pvpWins' | 'pvpLosses' | 'pvpKills' | 'rankedWins' | 'sameRankWins'
    | 'higherLevelWins' | 'defensiveWins' | 'comebackWins' | 'bestKillStreak'
    | 'warPvpKills' | 'arenaTournaments'
    // pve
    | 'pveKills' | 'eliteKills' | 'missionCompletions' | 'huntCompletions'
    | 'raidsCompleted' | 'bossContribution' | 'dungeonClears'
    | 'hollowGateClears' | 'endlessTowerBest' | 'weeklyBossTop10'
    // exploration
    | 'tilesExplored' | 'sectorDiscoveries' | 'hiddenFinds' | 'biomesVisited'
    | 'wandererQuests'
    // village & war
    | 'villageDonations' | 'warContribution' | 'sectorCaptures'
    | 'sectorDefenses' | 'warMissions' | 'warsWon' | 'warMvps'
    | 'villageTenureDays'
    // support
    | 'healingDone' | 'shieldsApplied' | 'cleansesUsed' | 'damageBlocked'
    // companions & pastimes
    | 'petDuelWins' | 'petExpeditions' | 'cardClashWins'
    // meta
    | 'firstClears' | 'eventCompletions';

/** Which category a stat counts toward for the multi-proof rarity rule. */
export const STAT_CATEGORY: Record<LegacyStatKey, LegacyCategory> = {
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

/** One eligibility requirement: a stat floor, or any-one-of several floors. */
export type LegacyReq =
    | { stat: LegacyStatKey; atLeast: number; weight?: number }
    | { anyOf: ReadonlyArray<{ stat: LegacyStatKey; atLeast: number }> };

export type LegacyDef = {
    id: string;                 // kebab slug, unique
    name: string;               // "Legacy of the ..."
    rarity: LegacyRarity;
    category: LegacyCategory;
    /** Village whose members get a 1.15x eligibility-score bonus. Never a lock. */
    villageAffinity?: string;
    /** Wearable title granted at Stage 2 (Awakened). */
    title: string;
    /** 1-2 sentence lore shown by the Wandering Sage and in the codex. */
    flavor: string;
    /** ALL requirements must pass for eligibility. */
    reqs: ReadonlyArray<LegacyReq>;
    /** Badge art at /badges/legacy-<badge>.webp (all 100 generated). */
    badge?: string;
    /**
     * The Legacy's signature jutsu id — derived at construction from the
     * generated server catalog (api/pvp/_legacy-jutsu-catalog.ts), so the
     * link can never drift from the authored data. Every launch Legacy has one.
     */
    specialtyJutsuId?: string;
};

const r = (stat: LegacyStatKey, atLeast: number, weight?: number): LegacyReq =>
    weight === undefined ? { stat, atLeast } : { stat, atLeast, weight };

// ————————————————————————————————————————————————————————————————————————
// MYTHIC (10) — multi-category mountains. A level-50 mythic candidate has
// dominated several arenas of play at once; most players will never hold one.
// ————————————————————————————————————————————————————————————————————————
const MYTHIC: LegacyDef[] = [
    {
        // Identity category is 'explorer' (the pioneer who "lit the way first"),
        // never 'mythic' — that would surface the owner-only rarity as a codex
        // tab. Still a mythic-RARITY path; its reqs/trials are unchanged in bite.
        id: 'first-flame', name: 'Legacy of the First Flame', rarity: 'mythic', category: 'explorer',
        title: 'First Flame Bearer',
        flavor: 'Road wardens in five countries copied routes from this shinobi’s field notes. Witnesses remember who carried the first torch into places patrols had abandoned.',
        reqs: [r('firstClears', 1, 3), r('missionCompletions', 600), r('pveKills', 3000), r('warContribution', 200_000), r('eventCompletions', 10), r('tilesExplored', 2000)],
    },
    {
        // Renamed from "Gate Opener" — it collided with the legendary
        // Gatebreaker in both name and (formerly) badge art (depth audit).
        id: 'gate-opener', name: 'Legacy of the Sundered Seal', rarity: 'mythic', category: 'pve',
        title: 'Sundered Seal',
        flavor: 'The Central keepers logged seventy-five descents under the same name. Most shinobi stop returning after the first bad extraction.',
        reqs: [r('hollowGateClears', 75, 3), r('eliteKills', 500), r('bossContribution', 1_000_000), r('firstClears', 1), r('hiddenFinds', 30), r('damageBlocked', 500_000)],
    },
    {
        id: 'hundred-storms', name: 'Legacy of the Hundred Storms', rarity: 'mythic', category: 'ninjutsu',
        title: 'Hundred Storms',
        flavor: 'Mission reports follow the same ninjutsu specialist through thousands of victories, great-beast hunts, border wars, and storms that changed the ground beneath whole squads.',
        reqs: [r('ninjutsuKills', 800, 3), r('ninjutsuDamage', 600_000), r('pveKills', 3000), r('eliteKills', 400), r('pvpWins', 150), r('eventCompletions', 8), r('warContribution', 100_000)],
    },
    {
        id: 'duel-sovereign', name: 'Legacy of the Duel Sovereign', rarity: 'mythic', category: 'pvp',
        title: 'Duel Sovereign',
        flavor: 'Arena clerks checked the record twice: four hundred wins, including ranked rivals and shinobi with every advantage on paper.',
        reqs: [r('pvpWins', 400, 3), r('sameRankWins', 150), r('bestKillStreak', 15), r('rankedWins', 120), r('higherLevelWins', 60), r('warPvpKills', 50), r('eliteKills', 200), r('eventCompletions', 8)],
    },
    {
        id: 'silent-empire', name: 'Legacy of the Silent Empire', rarity: 'mythic', category: 'genjutsu',
        title: 'Silent Emperor',
        flavor: 'Opponents describe missing seconds, false orders, and fights decided before they understood the genjutsu. The reports come from every border.',
        reqs: [r('genjutsuKills', 800, 3), r('genjutsuDamage', 600_000), r('pvpWins', 200), r('defensiveWins', 75), r('missionCompletions', 400), r('sectorDiscoveries', 100)],
    },
    {
        id: 'last-bastion', name: 'Legacy of the Last Bastion', rarity: 'mythic', category: 'support',
        title: 'The Last Bastion',
        flavor: 'Medics and defenders keep placing the same shinobi at the last unbroken position. Hundreds of people reached shelter behind that line.',
        reqs: [r('healingDone', 500_000, 3), r('damageBlocked', 1_000_000), r('shieldsApplied', 800), r('sectorDefenses', 25), r('defensiveWins', 100), r('villageTenureDays', 45)],
    },
    {
        id: 'founders-shadow', name: "Legacy of the Founder's Shadow", rarity: 'mythic', category: 'village',
        title: "Founder's Shadow",
        flavor: 'Donation ledgers, war rolls, and mission books all carry this name. The village has leaned on the same person for years.',
        reqs: [r('villageTenureDays', 75, 3), r('villageDonations', 1_000_000), r('warsWon', 12), r('warPvpKills', 150), r('sectorCaptures', 25), r('missionCompletions', 500), r('defensiveWins', 50)],
    },
    {
        // Identity category is 'pve' (the world-boss/great-beast slayer), never
        // 'mythic' — the rarity stays hidden. Still a mythic-RARITY path.
        id: 'world-awakener', name: 'Legacy of the World Awakener', rarity: 'mythic', category: 'pve',
        title: 'World Awakener',
        flavor: 'Great-beast hunt reports from eight seasons place this shinobi near the decisive strike. Rival villages agree on the name, which is rare enough.',
        reqs: [r('weeklyBossTop10', 8, 3), r('bossContribution', 1_200_000), r('eventCompletions', 15), r('pvpWins', 150), r('firstClears', 1), r('warContribution', 100_000)],
    },
    {
        id: 'horizons-end', name: "Legacy of the Horizon's End", rarity: 'mythic', category: 'explorer',
        title: "Horizon's End",
        flavor: 'Surveyors have redrawn their outer lines around this shinobi’s discoveries. Their oldest boots have crossed more blank country than most maps contain.',
        // 2,500 is the trusted Legacy mirror ceiling. Unlike Mapless One's
        // 2,400-tile legendary proof, this mythic reaches the full safe cap.
        reqs: [r('tilesExplored', 2500, 3), r('sectorDiscoveries', 250), r('hiddenFinds', 60), r('wandererQuests', 75), r('huntCompletions', 150), r('petExpeditions', 50), r('eventCompletions', 8)],
    },
    {
        id: 'deathless-ember', name: 'Legacy of the Deathless Ember', rarity: 'mythic', category: 'taijutsu',
        title: 'Deathless Ember',
        flavor: 'Healers recorded injuries that should have ended the fight. Witnesses recorded the same shinobi standing up and finishing it.',
        reqs: [r('comebackWins', 40, 3), r('defensiveWins', 100), r('pvpWins', 250), r('hollowGateClears', 40), r('eliteKills', 400), r('taijutsuDamage', 400_000), r('damageBlocked', 800_000)],
    },
];

// ————————————————————————————————————————————————————————————————————————
// LEGENDARY (25) — a major milestone identity: one dominant path proven with
// at least two supporting arenas. Roughly the top few percent of level-50s.
// ————————————————————————————————————————————————————————————————————————
const LEGENDARY: LegacyDef[] = [
    // — combat styles (2 per style) —
    {
        id: 'elemental-cataclysm', name: 'Legacy of the Elemental Cataclysm', rarity: 'legendary', category: 'ninjutsu',
        title: 'Cataclysm', flavor: 'Field teams still identify this shinobi’s battles by scorched ground, flash-frozen stone, and trees split by lightning.',
        reqs: [r('ninjutsuDamage', 600_000, 2), r('ninjutsuKills', 600), r('pveKills', 1500)],
    },
    {
        id: 'thousand-seals', name: 'Legacy of the Thousand Seals', rarity: 'legendary', category: 'ninjutsu',
        title: 'Thousand Seals', flavor: 'Witnesses describe complete hand-seal chains formed under pressure, with no wasted motion and no need to begin again.',
        reqs: [r('ninjutsuKills', 500, 2), r('missionCompletions', 400), r('eliteKills', 200)],
    },
    {
        id: 'moonlit-ghost', name: 'Legacy of the Moonlit Ghost', rarity: 'legendary', category: 'genjutsu',
        villageAffinity: 'Moonshadow', title: 'Moonlit Ghost',
        flavor: 'Moonshadow booth records show opponents striking the wrong position again and again. Most never saw the real shinobi until the bout ended.',
        reqs: [r('genjutsuKills', 600, 2), r('pvpWins', 150), r('sectorDiscoveries', 80)],
    },
    {
        id: 'void-whisper', name: 'Legacy of the Void Whisper', rarity: 'legendary', category: 'genjutsu',
        title: 'Void Whisper', flavor: 'Opponents remember the field going quiet before their senses failed. The same detail appears in reports from unrelated fights.',
        reqs: [r('genjutsuKills', 400, 2), r('genjutsuDamage', 350_000), r('defensiveWins', 40)],
    },
    {
        id: 'arena-demon', name: 'Legacy of the Arena Demon', rarity: 'legendary', category: 'taijutsu',
        title: 'Arena Demon', flavor: 'Stormveil bookies still post a duration line, but few will take the opposing name anymore.',
        reqs: [r('taijutsuKills', 600, 2), r('pvpWins', 150), r('sameRankWins', 40)],
    },
    {
        id: 'unbroken-body', name: 'Legacy of the Unbroken Body', rarity: 'legendary', category: 'taijutsu',
        title: 'Unbroken',
        flavor: 'The hospital has treated this shinobi for fractures, torn joints, and worse. Several intake forms were signed after a victory.',
        reqs: [r('taijutsuDamage', 500_000, 2), r('damageBlocked', 700_000), r('comebackWins', 15)],
    },
    {
        id: 'blade-saint', name: 'Legacy of the Blade Saint', rarity: 'legendary', category: 'bukijutsu',
        title: 'Blade Saint', flavor: 'Armorers who watched the bouts noted the same clean draw under ten different pressures. Practice made it reliable, not decorative.',
        reqs: [r('bukijutsuKills', 700, 2), r('bukijutsuDamage', 500_000), r('sameRankWins', 50)],
    },
    {
        id: 'thousand-cuts', name: 'Legacy of the Thousand Cuts', rarity: 'legendary', category: 'bukijutsu',
        title: 'Thousand Cuts', flavor: 'Hunt reports show a patient fighter who opens small wounds, controls the escape, and lets the target exhaust itself.',
        reqs: [r('bukijutsuKills', 500, 2), r('pveKills', 1500), r('huntCompletions', 150)],
    },
    // — pvp (3) —
    {
        id: 'duel-king', name: 'Legacy of the Duel King', rarity: 'legendary', category: 'pvp',
        title: 'Duel King',
        flavor: 'The challenge board has carried this name through two hundred victories. Every open challenge was answered in public.',
        reqs: [r('pvpWins', 200, 2), r('rankedWins', 60), r('bestKillStreak', 10), r('eliteKills', 150)],
    },
    {
        id: 'village-reaper', name: 'Legacy of the Village Reaper', rarity: 'legendary', category: 'war',
        title: 'Village Reaper', flavor: 'War rolls credit this shinobi with a hundred enemy defeats and repeated captures at the front. Survivors recognize the field sign.',
        reqs: [r('warPvpKills', 100, 2), r('warsWon', 8), r('pvpWins', 150)],
    },
    {
        id: 'bloodstained-path', name: 'Legacy of the Bloodstained Path', rarity: 'legendary', category: 'pvp',
        title: 'Bloodstained', flavor: 'The record follows one fighter through duels, hunts, and ambushes. Too many entries end with the other name crossed out.',
        reqs: [r('pvpKills', 250, 2), r('higherLevelWins', 30), r('comebackWins', 15), r('huntCompletions', 80)],
    },
    // — pve (3) —
    {
        id: 'gatebreaker', name: 'Legacy of the Gatebreaker', rarity: 'legendary', category: 'pve',
        title: 'Gatebreaker',
        flavor: 'Hollow Gate keepers have replaced hinges, seals, and warning boards after this shinobi’s descents. The repair ledger is unusually thick.',
        reqs: [r('hollowGateClears', 30, 2), r('eliteKills', 200), r('bossContribution', 400_000), r('hiddenFinds', 15)],
    },
    {
        id: 'trial-conqueror', name: 'Legacy of the Trial Conqueror', rarity: 'legendary', category: 'pve',
        title: 'Trial Conqueror', flavor: 'Dungeon wardens and tower clerks agree that this shinobi finishes trials after most candidates turn back.',
        reqs: [r('dungeonClears', 40, 2), r('endlessTowerBest', 40), r('missionCompletions', 400), r('tilesExplored', 1500)],
    },
    {
        id: 'ancient-hunter', name: 'Legacy of the Ancient Hunter', rarity: 'legendary', category: 'pve',
        title: 'Ancient Hunter', flavor: 'Hunter Guild records show old beasts tracked through broken country and brought down without losing the trail.',
        reqs: [r('huntCompletions', 150, 2), r('eliteKills', 250), r('hiddenFinds', 25)],
    },
    // — village champions (4) —
    {
        id: 'ashen-will', name: 'Legacy of the Ashen Will', rarity: 'legendary', category: 'village',
        villageAffinity: 'Ashen Leaf', title: 'Ashen Will',
        flavor: 'Ashen Leaf’s Branch Register shows the same shinobi funding repairs, holding threatened ground, and changing old practice when it failed people.',
        reqs: [r('villageTenureDays', 45, 2), r('villageDonations', 250_000), r('warContribution', 30_000), r('sectorDefenses', 12)],
    },
    {
        id: 'storm-fang', name: 'Legacy of the Storm Fang', rarity: 'legendary', category: 'village',
        villageAffinity: 'Stormveil', title: 'Storm Fang',
        flavor: 'Stormveil’s Challenge Board records this shinobi answering raids and posted grievances in the open, usually before the rain cleared.',
        reqs: [r('villageTenureDays', 45, 2), r('warPvpKills', 60), r('raidsCompleted', 40), r('warsWon', 6)],
    },
    {
        id: 'frostbound-shield', name: 'Legacy of the Frostbound Shield', rarity: 'legendary', category: 'village',
        villageAffinity: 'Frostfang', title: 'Frostbound Shield',
        flavor: 'Frostfang rescue rolls place this shinobi at failed walls and frozen crossings. Every name assigned behind them returned to the Count.',
        reqs: [r('villageTenureDays', 45, 2), r('sectorDefenses', 18), r('damageBlocked', 500_000), r('defensiveWins', 40)],
    },
    {
        id: 'moonlit-oath', name: 'Legacy of the Moonlit Oath', rarity: 'legendary', category: 'village',
        villageAffinity: 'Moonshadow', title: 'Oath of the Moon',
        flavor: 'Moonshadow brokers trusted this shinobi with names that could ruin families. The sealed receipts show every trust returned intact.',
        reqs: [r('villageTenureDays', 45, 2), r('genjutsuKills', 300), r('sectorDiscoveries', 80), r('warContribution', 30_000)],
    },
    // — support (2) —
    {
        id: 'village-guardian', name: 'Legacy of the Village Guardian', rarity: 'legendary', category: 'support',
        title: 'Village Guardian',
        flavor: 'Village medics list hundreds of wounds prevented by this shinobi’s shields. Many civilians never knew how close the fighting came.',
        reqs: [r('healingDone', 400_000, 2), r('shieldsApplied', 600), r('sectorDefenses', 15)],
    },
    {
        id: 'oathkeeper', name: 'Legacy of the Oathkeeper', rarity: 'legendary', category: 'support',
        title: 'Oathkeeper', flavor: 'Witnesses keep finding this shinobi between danger and someone who cannot take the hit. The protected names keep changing.',
        reqs: [r('shieldsApplied', 400, 2), r('healingDone', 250_000), r('defensiveWins', 40), r('sectorDefenses', 8)],
    },
    // — explorer (2) —
    {
        id: 'mapless-one', name: 'Legacy of the Mapless One', rarity: 'legendary', category: 'explorer',
        title: 'The Mapless One', flavor: 'Survey teams use this shinobi’s trail marks beyond the last reliable chart. They also note a habit of checking the way home.',
        reqs: [r('tilesExplored', 2400, 2), r('sectorDiscoveries', 60), r('hiddenFinds', 25), r('huntCompletions', 80)],
    },
    {
        id: 'shrine-seeker', name: 'Legacy of the Shrine Seeker', rarity: 'legendary', category: 'explorer',
        title: 'Shrine Seeker', flavor: 'Shrine keepers across the countries remember the same visitor clearing steps, copying inscriptions, and asking who still tends the place.',
        reqs: [r('sectorDiscoveries', 100, 2), r('wandererQuests', 40), r('tilesExplored', 2000), r('missionCompletions', 250)],
    },
    // — pets / cards / war (3) —
    {
        id: 'beast-sovereign', name: 'Legacy of the Beast Sovereign', rarity: 'legendary', category: 'pets',
        title: 'Beast Sovereign', flavor: 'Stable hands report a tamer who wins hard bouts, brings injured companions home, and earns obedience without breaking temperament.',
        reqs: [r('petDuelWins', 100, 2), r('petExpeditions', 80), r('eliteKills', 150)],
    },
    {
        id: 'silent-gambit', name: 'Legacy of the Silent Gambit', rarity: 'legendary', category: 'cards',
        title: 'The Silent Gambit', flavor: 'Card Hall ledgers show repeated wins from weak opening hands. The dealers blame patience and very careful counting.',
        reqs: [r('cardClashWins', 120, 2), r('pvpWins', 40), r('missionCompletions', 300)],
    },
    {
        // Title renamed from "Warborn" — it read as an accidental collision
        // with the rare Warborn Blade (depth audit).
        id: 'warborn-banner', name: 'Legacy of the Warborn Banner', rarity: 'legendary', category: 'war',
        title: 'Bannerlord',
        flavor: 'War clerks record this shinobi carrying orders through raids, winning ground, and returning with the village banner still upright.',
        reqs: [r('warsWon', 8, 2), r('warPvpKills', 40), r('warContribution', 60_000), r('raidsCompleted', 50), r('pvpWins', 100)],
    },
];

// ————————————————————————————————————————————————————————————————————————
// RARE (50) — a clear, earned identity in one path with light supporting
// proof. The workhorse tier: most dedicated level-50s qualify for a few.
// ————————————————————————————————————————————————————————————————————————
const RARE: LegacyDef[] = [
    // — ninjutsu (4) —
    { id: 'elemental-storm', name: 'Legacy of the Elemental Storm', rarity: 'rare', category: 'ninjutsu', title: 'Elemental Storm',
      flavor: 'Mission ledgers show five elemental natures used with the same disciplined timing.', reqs: [r('ninjutsuKills', 250, 2), r('ninjutsuDamage', 150_000)] },
    { id: 'burning-vanguard', name: 'Legacy of the Burning Vanguard', rarity: 'rare', category: 'ninjutsu', villageAffinity: 'Ashen Leaf', title: 'Burning Vanguard',
      flavor: 'Raid captains keep assigning this shinobi to the first breach because the entry is usually clear by the time the squad arrives.', reqs: [r('ninjutsuKills', 200, 2), r('warContribution', 15_000)] },
    { id: 'chakra-tempest', name: 'Legacy of the Chakra Tempest', rarity: 'rare', category: 'ninjutsu', title: 'Chakra Tempest',
      flavor: 'Damage reports describe unusually heavy ninjutsu placed close enough to allies that careful aim clearly mattered.', reqs: [r('ninjutsuDamage', 250_000, 2), r('pveKills', 600)] },
    { id: 'stormcallers-path', name: "Legacy of the Stormcaller's Path", rarity: 'rare', category: 'ninjutsu', villageAffinity: 'Stormveil', title: 'Stormcaller',
      flavor: 'Stormveil instructors remember this shinobi drilling ninjutsu outdoors through rain, crosswind, and live banner cables.', reqs: [r('ninjutsuKills', 200, 2), r('raidsCompleted', 20)] },
    // — genjutsu (4) —
    { id: 'shadow-strategist', name: 'Legacy of the Shadow Strategist', rarity: 'rare', category: 'genjutsu', title: 'Shadow Strategist',
      flavor: 'Opponents often misread the opening bow, the distance, or the first signal. By the correction, the genjutsu is already set.', reqs: [r('genjutsuKills', 200, 2), r('genjutsuDamage', 120_000)] },
    { id: 'silent-fang', name: 'Legacy of the Silent Fang', rarity: 'rare', category: 'genjutsu', villageAffinity: 'Moonshadow', title: 'Silent Fang',
      flavor: 'Fight reports rarely record a warning before this shinobi’s genjutsu lands.', reqs: [r('genjutsuKills', 200, 2), r('bestKillStreak', 5)] },
    { id: 'dream-weaver', name: 'Legacy of the Dream Weaver', rarity: 'rare', category: 'genjutsu', title: 'Dream Weaver',
      flavor: 'Several enemies woke restrained instead of dead, while allies remember the same shinobi treating their wounds.', reqs: [r('genjutsuKills', 150, 2), r('healingDone', 30_000)] },
    { id: 'mirage-dancer', name: 'Legacy of the Mirage Dancer', rarity: 'rare', category: 'genjutsu', title: 'Mirage Dancer',
      flavor: 'Witnesses describe false footsteps, doubled silhouettes, and opponents striking safe ground while the real attack arrived elsewhere.', reqs: [r('genjutsuDamage', 150_000, 2), r('defensiveWins', 15)] },
    // — taijutsu (4) —
    { id: 'iron-fist', name: 'Legacy of the Iron Fist', rarity: 'rare', category: 'taijutsu', title: 'Iron Fist',
      flavor: 'Training staff replaced enough split posts to start recording this shinobi’s practice hours separately.', reqs: [r('taijutsuKills', 250, 2), r('taijutsuDamage', 150_000)] },
    { id: 'bloodied-knuckle', name: 'Legacy of the Bloodied Knuckle', rarity: 'rare', category: 'taijutsu', title: 'Bloodied Knuckle',
      flavor: 'Arena records show repeated armed opponents disarmed by a shinobi who entered with empty hands.', reqs: [r('taijutsuKills', 200, 2), r('pvpWins', 40)] },
    { id: 'mountain-stance', name: 'Legacy of the Mountain Stance', rarity: 'rare', category: 'taijutsu', villageAffinity: 'Frostfang', title: 'Mountain Stance',
      flavor: 'Witnesses remember this shinobi holding position through impacts that broke the ground around both feet.', reqs: [r('taijutsuDamage', 200_000, 2), r('damageBlocked', 150_000)] },
    { id: 'crashing-wave', name: 'Legacy of the Crashing Wave', rarity: 'rare', category: 'taijutsu', villageAffinity: 'Stormveil', title: 'Crashing Wave',
      flavor: 'Stormveil bouts show the same rhythm: absorb the first rush, turn the footing, then drive the opponent back across the chalk.', reqs: [r('taijutsuKills', 200, 2), r('comebackWins', 8)] },
    // — bukijutsu (4) —
    { id: 'warborn-blade', name: 'Legacy of the Warborn Blade', rarity: 'rare', category: 'bukijutsu', title: 'Warborn Blade',
      flavor: 'Weapon masters from two separate wars signed the same field assessment: reliable edge, disciplined recovery.', reqs: [r('bukijutsuKills', 250, 2), r('bukijutsuDamage', 150_000)] },
    { id: 'crimson-duelist', name: 'Legacy of the Crimson Duelist', rarity: 'rare', category: 'bukijutsu', title: 'Crimson Duelist',
      flavor: 'Challenge clerks record a wandering swordsman who accepts posted duels and leaves each result under a real name.', reqs: [r('bukijutsuKills', 200, 2), r('sameRankWins', 15)] },
    { id: 'quiet-scabbard', name: 'Legacy of the Quiet Scabbard', rarity: 'rare', category: 'bukijutsu', title: 'Quiet Scabbard',
      flavor: 'Most witnesses remember a single decisive draw, followed by the sound of the weapon returning to its sheath.', reqs: [r('bukijutsuDamage', 200_000, 2), r('sameRankWins', 15)] },
    { id: 'hunters-edge', name: "Legacy of the Hunter's Edge", rarity: 'rare', category: 'bukijutsu', title: "Hunter's Edge",
      flavor: 'Hunter Guild notes praise a polearm user who reads a charging beast, controls the distance, and ends the hunt cleanly.', reqs: [r('bukijutsuKills', 200, 2), r('huntCompletions', 50)] },
    // — pvp (4) —
    { id: 'proving-grounds', name: 'Legacy of the Proving Grounds', rarity: 'rare', category: 'pvp', title: 'Proven',
      flavor: 'The proving-ground ledger shows seventy-five wins and very few disputed results.', reqs: [r('pvpWins', 75, 2), r('sameRankWins', 20)] },
    { id: 'ranked-ascendant', name: 'Legacy of the Ranked Ascendant', rarity: 'rare', category: 'pvp', title: 'Ascendant',
      flavor: 'Ranked clerks watched this shinobi advance through active challengers instead of waiting for easier pairings.', reqs: [r('rankedWins', 25, 2), r('pvpWins', 50)] },
    { id: 'giant-slayer', name: 'Legacy of the Giant Slayer', rarity: 'rare', category: 'pvp', title: 'Giant Slayer',
      flavor: 'Ten verified bouts ended with this shinobi defeating an opponent whose record looked stronger before the bell.', reqs: [r('higherLevelWins', 10, 2), r('pvpWins', 40)] },
    { id: 'wall-of-defiance', name: 'Legacy of the Wall of Defiance', rarity: 'rare', category: 'pvp', title: 'The Wall',
      flavor: 'Opponents prepared ways around this guard and still spent the bout trying to move it.', reqs: [r('defensiveWins', 15, 2), r('comebackWins', 5)] },
    // — pve (6) —
    { id: 'hollow-seeker', name: 'Legacy of the Hollow Seeker', rarity: 'rare', category: 'pve', title: 'Hollow Seeker',
      flavor: 'Gate keepers logged ten completed descents and careful notes on the intake patterns encountered below.', reqs: [r('hollowGateClears', 10, 2), r('eliteKills', 60)] },
    { id: 'tower-climber', name: 'Legacy of the Endless Ascent', rarity: 'rare', category: 'pve', title: 'Endless Ascent',
      flavor: 'Tower clerks watched this shinobi clear twenty-five floors by conserving supplies and refusing unnecessary fights.', reqs: [r('endlessTowerBest', 25, 2), r('pveKills', 500)] },
    { id: 'mission-hound', name: 'Legacy of the Mission Hound', rarity: 'rare', category: 'pve', title: 'Mission Hound',
      flavor: 'Mission clerks know this shinobi by the stack of completed orders returned before midday.', reqs: [r('missionCompletions', 250, 2), r('huntCompletions', 40)] },
    { id: 'beast-tracker', name: 'Legacy of the Beast Tracker', rarity: 'rare', category: 'pve', title: 'Beast Tracker',
      flavor: 'Guild trackers trust this shinobi to identify a target from damaged brush, spoor, and one partial print.', reqs: [r('huntCompletions', 60, 2), r('eliteKills', 60)] },
    { id: 'boss-breaker', name: 'Legacy of the Boss Breaker', rarity: 'rare', category: 'pve', title: 'Boss Breaker',
      flavor: 'Great-beast teams record this shinobi staying in the fight long enough to create a hundred thousand points of damage.', reqs: [r('bossContribution', 100_000, 2), r('weeklyBossTop10', 1)] },
    { id: 'dungeon-delver', name: 'Legacy of the Dungeon Delver', rarity: 'rare', category: 'pve', title: 'Dungeon Delver',
      flavor: 'Dungeon wardens keep finding this shinobi beyond doors their own survey teams had marked unopened.', reqs: [r('dungeonClears', 15, 2), r('tilesExplored', 800)] },
    // — village (8: 2 per village) —
    { id: 'ashen-hearth', name: 'Legacy of the Ashen Hearth', rarity: 'rare', category: 'village', villageAffinity: 'Ashen Leaf', title: 'Hearthkeeper',
      flavor: 'Ashen Leaf’s Register shows three weeks of duties kept and repairs funded without a public claim for credit.', reqs: [r('villageTenureDays', 21, 2), r('villageDonations', 50_000)] },
    { id: 'embers-discipline', name: "Legacy of the Ember's Discipline", rarity: 'rare', category: 'village', villageAffinity: 'Ashen Leaf', title: 'Ember Disciple',
      flavor: 'Ashen Leaf instructors remember a student who stayed after formal drills to repeat the parts that still failed.', reqs: [r('villageTenureDays', 21, 2), r('pveKills', 400)] },
    { id: 'tidebreaker', name: 'Legacy of the Tidebreaker', rarity: 'rare', category: 'village', villageAffinity: 'Stormveil', title: 'Tidebreaker',
      flavor: 'Stormveil’s board records this shinobi carrying twenty-five war challenges back across the bell line.', reqs: [r('villageTenureDays', 21, 2), r('warPvpKills', 25)] },
    { id: 'thunder-raider', name: 'Legacy of the Thunder Raider', rarity: 'rare', category: 'village', villageAffinity: 'Stormveil', title: 'Thunder Raider',
      flavor: 'Raid parties learned to watch for this shinobi at the front whenever Stormveil’s thunder covered an approach.', reqs: [r('villageTenureDays', 21, 2), r('raidsCompleted', 25)] },
    { id: 'northern-fang', name: 'Legacy of the Northern Fang', rarity: 'rare', category: 'village', villageAffinity: 'Frostfang', title: 'Northern Fang',
      flavor: 'Frostfang’s Count lists eight threatened sectors where this shinobi held until the missing names came home.', reqs: [r('villageTenureDays', 21, 2), r('sectorDefenses', 8)] },
    { id: 'winter-sentinel', name: 'Legacy of the Winter Sentinel', rarity: 'rare', category: 'village', villageAffinity: 'Frostfang', title: 'Winter Sentinel',
      flavor: 'Watch captains recorded this shinobi completing the full northern rotation through cold, injury, and repeated attacks.', reqs: [r('villageTenureDays', 21, 2), r('defensiveWins', 12)] },
    { id: 'veiled-lantern', name: 'Legacy of the Veiled Lantern', rarity: 'rare', category: 'village', villageAffinity: 'Moonshadow', title: 'Veiled Lantern',
      flavor: 'Moonshadow route books show thirty quiet discoveries turned over to the people responsible for keeping those streets safe.', reqs: [r('villageTenureDays', 21, 2), r('sectorDiscoveries', 30)] },
    { id: 'midnight-errand', name: 'Legacy of the Midnight Errand', rarity: 'rare', category: 'village', villageAffinity: 'Moonshadow', title: 'Midnight Runner',
      flavor: 'Moonshadow’s sealed office has one hundred fifty completed orders under this mark, most returned without public notice.', reqs: [r('villageTenureDays', 21, 2), r('missionCompletions', 150)] },
    // — explorer (4) —
    { id: 'hidden-path', name: 'Legacy of the Hidden Path', rarity: 'rare', category: 'explorer', title: 'Pathfinder',
      flavor: 'Survey notes show this shinobi checking side routes others dismissed, then marking which ones actually saved time.', reqs: [r('tilesExplored', 1200, 2), r('hiddenFinds', 8)] },
    { id: 'wayfarers-mark', name: "Legacy of the Wayfarer's Mark", rarity: 'rare', category: 'explorer', title: 'Wayfarer',
      flavor: 'Road journals place this shinobi a thousand tiles from familiar ground, still carrying clear return marks.', reqs: [r('tilesExplored', 1000, 2), r('wandererQuests', 10)] },
    { id: 'rumor-chaser', name: 'Legacy of the Rumor Chaser', rarity: 'rare', category: 'explorer', title: 'Rumor Chaser',
      flavor: 'Tavern rumors sent this shinobi to forty sites. The returned notes separate what was true from what merely sold drinks.', reqs: [r('sectorDiscoveries', 40, 2), r('wandererQuests', 15)] },
    { id: 'strangers-friend', name: "Legacy of the Stranger's Friend", rarity: 'rare', category: 'explorer', title: "Stranger's Friend",
      flavor: 'Couriers, medics, and road merchants in every country recognize this shinobi and can name a favor completed for them.', reqs: [r('wandererQuests', 25, 2), r('sectorDiscoveries', 25)] },
    // — support (3) —
    { id: 'shielding-palm', name: 'Legacy of the Shielding Palm', rarity: 'rare', category: 'support', title: 'Shielding Palm',
      flavor: 'Combat medics credit this shinobi’s shields with stopping injuries their supplies could not have treated in time.', reqs: [r('shieldsApplied', 200, 2), r('damageBlocked', 100_000)] },
    { id: 'field-medic', name: 'Legacy of the Field Medic', rarity: 'rare', category: 'support', title: 'Field Medic',
      flavor: 'Field reports repeatedly place this medic at the first cry for help, treating whoever was bleeding before asking for a name.', reqs: [r('healingDone', 50_000, 2), r('missionCompletions', 100)] },
    { id: 'purifying-light', name: 'Legacy of the Purifying Light', rarity: 'rare', category: 'support', title: 'Purifier',
      flavor: 'Patients remember poison drawn, genjutsu broken, and panic treated with the same steady hands.', reqs: [r('healingDone', 60_000, 2), r('defensiveWins', 10)] },
    // — pets (3) —
    { id: 'pack-leader', name: 'Legacy of the Pack Leader', rarity: 'rare', category: 'pets', title: 'Pack Leader',
      flavor: 'Stable hands watch this tamer read flattened ears, stiff tails, and warning growls before a companion has to bite.', reqs: [r('petDuelWins', 50, 2), r('petExpeditions', 20)] },
    { id: 'wild-heart', name: 'Legacy of the Wild Heart', rarity: 'rare', category: 'pets', title: 'Wild Heart',
      flavor: 'Expedition records show companions returning fed, treated, and willing to leave with the same tamer again.', reqs: [r('petExpeditions', 40, 2), r('huntCompletions', 30)] },
    { id: 'coliseum-tamer', name: 'Legacy of the Colosseum Tamer', rarity: 'rare', category: 'pets', title: 'Colosseum Tamer',
      flavor: 'Colosseum crowds know the companion’s name first. The tamer keeps pointing back to it after every win.', reqs: [r('petDuelWins', 75, 2), r('arenaTournaments', 8)] },
    // — cards (2) —
    { id: 'card-sharp', name: 'Legacy of the Card Sharp', rarity: 'rare', category: 'cards', title: 'Card Sharp',
      flavor: 'Card Hall dealers remember a neat shuffle, exact counts, and very few wagers made without a reason.', reqs: [r('cardClashWins', 40, 2), r('missionCompletions', 100)] },
    { id: 'tables-shadow', name: "Legacy of the Table's Shadow", rarity: 'rare', category: 'cards', title: "The Table's Shadow",
      flavor: 'Road games and formal halls both record this player taking a seat, stating the stake, and leaving with more wins than losses.', reqs: [r('cardClashWins', 60, 2), r('pvpWins', 25)] },
    // — war (4) —
    { id: 'sector-warden', name: 'Legacy of the Sector Warden', rarity: 'rare', category: 'war', title: 'Sector Warden',
      flavor: 'War reports place this defender on eight sectors through the final signal, even after relief was late.', reqs: [r('sectorDefenses', 8, 2), r('warContribution', 25_000)] },
    { id: 'banner-taker', name: 'Legacy of the Banner Taker', rarity: 'rare', category: 'war', title: 'Banner Taker',
      flavor: 'Quartermasters have logged enemy flags from twenty raids under this shinobi’s return receipts.', reqs: [r('raidsCompleted', 20, 2), r('warPvpKills', 15)] },
    { id: 'siege-runner', name: 'Legacy of the Siege Runner', rarity: 'rare', category: 'war', title: 'Siege Runner',
      flavor: 'Commanders kept receiving orders through broken lines because this runner changed routes without losing the schedule.', reqs: [r('raidsCompleted', 30, 2), r('warContribution', 20_000)] },
    { id: 'war-drummer', name: 'Legacy of the War Drummer', rarity: 'rare', category: 'war', title: 'War Drummer',
      flavor: 'Supply, signal, and casualty rolls from three wars all depend on work this shinobi kept moving behind the front.', reqs: [r('warContribution', 30_000, 2), r('warsWon', 3)] },
];

// ————————————————————————————————————————————————————————————————————————
// BASIC (15) — accessible identity fallbacks. Every genuine level-50 should
// qualify for several; the Sage always has something honest to offer.
// ————————————————————————————————————————————————————————————————————————
const BASIC: LegacyDef[] = [
    { id: 'wandering-shinobi', name: 'Legacy of the Wandering Shinobi', rarity: 'basic', category: 'explorer', title: 'Wanderer',
      flavor: 'Four hundred explored tiles show a shinobi who kept reliable notes after the marked patrol roads ended.', reqs: [r('tilesExplored', 400)] },
    { id: 'village-veteran', name: 'Legacy of the Village Veteran', rarity: 'basic', category: 'village', title: 'Veteran',
      flavor: 'For ten days of village work, this shinobi showed up when assigned and stayed until the task was signed closed.', reqs: [r('villageTenureDays', 10)] },
    { id: 'proven-fighter', name: 'Legacy of the Proven Fighter', rarity: 'basic', category: 'pvp', title: 'Fighter',
      flavor: 'The arena ledger shows fifteen wins from a shinobi who kept answering the next bell.', reqs: [r('pvpWins', 15)] },
    { id: 'road-worn-shinobi', name: 'Legacy of the Road-Worn Shinobi', rarity: 'basic', category: 'explorer', title: 'Road-Worn',
      flavor: 'Guild cobblers resoled the same boots through twenty-five completed hunts.', reqs: [r('huntCompletions', 25)] },
    { id: 'ember-student', name: 'Legacy of the Ember Student', rarity: 'basic', category: 'ninjutsu', title: 'Ember Student',
      flavor: 'Instructors recorded the first unstable spark, then sixty field victories earned through deliberate control.', reqs: [r('ninjutsuKills', 60)] },
    { id: 'quiet-mind', name: 'Legacy of the Quiet Mind', rarity: 'basic', category: 'genjutsu', title: 'Quiet Mind',
      flavor: 'Sixty fights ended after this shinobi made the enemy trust the wrong sight or sound.', reqs: [r('genjutsuKills', 60)] },
    { id: 'calloused-fist', name: 'Legacy of the Calloused Fist', rarity: 'basic', category: 'taijutsu', title: 'Calloused Fist',
      flavor: 'Training staff replaced several pairs of gloves while the same hands kept improving.', reqs: [r('taijutsuKills', 60)] },
    { id: 'steel-apprentice', name: 'Legacy of the Steel Apprentice', rarity: 'basic', category: 'bukijutsu', title: 'Steel Apprentice',
      flavor: 'The first blade was borrowed and returned sharper. Later weapon loans came without hesitation.', reqs: [r('bukijutsuKills', 60)] },
    { id: 'field-hand', name: 'Legacy of the Field Hand', rarity: 'basic', category: 'pve', title: 'Field Hand',
      flavor: 'Mission clerks count sixty completed orders, including the small jobs experienced shinobi often ignore.', reqs: [r('missionCompletions', 60)] },
    { id: 'beast-friend', name: 'Legacy of the Beast Friend', rarity: 'basic', category: 'pets', title: 'Beast Friend',
      flavor: 'Stable hands joke that the companion chose first. Ten duel wins suggest the arrangement works.', reqs: [r('petDuelWins', 10)] },
    { id: 'table-regular', name: 'Legacy of the Table Regular', rarity: 'basic', category: 'cards', title: 'Table Regular',
      flavor: 'The Card Hall keeps a usual seat open for this player and has recorded ten wins from it.', reqs: [r('cardClashWins', 10)] },
    { id: 'lantern-bearer', name: 'Legacy of the Lantern Bearer', rarity: 'basic', category: 'support', title: 'Lantern Bearer',
      flavor: 'Patients remember this shinobi holding the lamp steady while treating wounds after dark.', reqs: [r('healingDone', 20_000)] },
    { id: 'first-steps', name: 'Legacy of the First Steps', rarity: 'basic', category: 'explorer', title: 'Trailblazer',
      flavor: 'Ten discoveries began as wrong turns that this shinobi marked clearly for the next traveler.', reqs: [r('sectorDiscoveries', 10)] },
    { id: 'honest-ryo', name: 'Legacy of the Honest Ryo', rarity: 'basic', category: 'village', title: 'Honest Hand',
      flavor: 'Village receipts show every due paid and several repairs funded without a name on the notice board.', reqs: [r('villageDonations', 10_000)] },
    { id: 'steadfast-neighbor', name: 'Legacy of the Steadfast Neighbor', rarity: 'basic', category: 'village', title: 'Steadfast',
      flavor: 'Four defense rolls show this shinobi answering the alarm before asking whose street was threatened.', reqs: [r('sectorDefenses', 4)] },
];

// Every legacy has badge art at /badges/legacy-<id>.webp (full 100-badge set,
// docs/legacy-assets.md §2), so `badge` is simply the id. Kept as a field
// (rather than derived at render sites) because the client LegacyDefView
// consumes it and a future legacy could still override the art.
export const LEGACY_DEFS: readonly LegacyDef[] =
    [...MYTHIC, ...LEGENDARY, ...RARE, ...BASIC].map((d) => ({
        ...d,
        badge: d.badge ?? d.id,
        specialtyJutsuId: d.specialtyJutsuId ?? LEGACY_JUTSU_ID_BY_LEGACY[d.id],
    }));

export const LEGACY_BY_ID: ReadonlyMap<string, LegacyDef> = new Map(LEGACY_DEFS.map((d) => [d.id, d]));

/** Global minimum level for any Legacy offer (Jonin threshold). */
export const LEGACY_MIN_LEVEL = 50;

export const RARITY_ORDER: Record<LegacyRarity, number> = { basic: 0, rare: 1, legendary: 2, mythic: 3 };

/** Design-spec rarity counts, enforced by the defs lint test. */
export const EXPECTED_RARITY_COUNTS: Record<LegacyRarity, number> = {
    mythic: 10, legendary: 25, rare: 50, basic: 15,
};

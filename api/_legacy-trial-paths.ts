import type { LegacyDef, LegacyRarity, LegacyStatKey } from './_legacy-defs.js';
import type { TrialKind, TrialObjective } from './_legacy-core.js';

type PathProof = { variants: readonly [string, string]; bind: LegacyStatKey; prove: LegacyStatKey };
const p = (first: string, alternate: string, bind: LegacyStatKey, prove: LegacyStatKey): PathProof =>
    ({ variants: [first, alternate], bind, prove });

/** Identity-owned routes. Every primary and secondary is repeatable below 100. */
export const LEGACY_TRIAL_PATHS: Readonly<Record<string, PathProof>> = {
    'first-flame': p('riftQuests missionCompletions', 'wandererQuests towerClears', 'gatheringClaims', 'towerMechanicClears'),
    'gate-opener': p('hollowGateClears damageBlocked', 'dungeonClears shieldsApplied', 'raidsCompleted', 'towerMechanicClears'),
    'hundred-storms': p('ninjutsuKills warContribution', 'ninjutsuDamage pvpWins', 'missionCompletions', 'towerParClears'),
    'duel-sovereign': p('rankedWins sameRankWins', 'pvpWins warPvpKills', 'huntCompletions', 'towerCleanClears'),
    'silent-empire': p('genjutsuKills defensiveWins', 'genjutsuDamage pvpWins', 'riftQuests', 'towerMechanicClears'),
    'last-bastion': p('healingDone sectorDefenses', 'shieldsApplied defensiveWins', 'professionActions', 'damageBlocked'),
    'founders-shadow': p('villageDonations warPvpKills', 'raidsCompleted defensiveWins', 'craftsCompleted', 'towerCleanClears'),
    'world-awakener': p('clanBossOperations pvpWins', 'towerMechanicClears warContribution', 'riftQuests', 'towerCleanClears'),
    'horizons-end': p('gatheringClaims wandererQuests', 'riftQuests petExpeditions', 'huntCompletions', 'towerMechanicClears'),
    'deathless-ember': p('taijutsuKills defensiveWins', 'taijutsuDamage pvpWins', 'hollowGateClears', 'damageBlocked'),
    'elemental-cataclysm': p('ninjutsuDamage towerClears', 'ninjutsuKills missionCompletions', 'riftQuests', 'towerMechanicClears'),
    'thousand-seals': p('ninjutsuKills riftQuests', 'ninjutsuDamage wandererQuests', 'craftsCompleted', 'towerParClears'),
    'moonlit-ghost': p('genjutsuKills pvpWins', 'genjutsuDamage sameRankWins', 'riftQuests', 'towerCleanClears'),
    'void-whisper': p('genjutsuDamage towerCleanClears', 'genjutsuKills dungeonClears', 'wandererQuests', 'towerMechanicClears'),
    'arena-demon': p('taijutsuKills pvpWins', 'taijutsuDamage sameRankWins', 'huntCompletions', 'towerParClears'),
    'unbroken-body': p('taijutsuDamage damageBlocked', 'taijutsuKills shieldsApplied', 'missionCompletions', 'towerCleanClears'),
    'blade-saint': p('bukijutsuKills craftsCompleted', 'bukijutsuDamage towerParClears', 'huntCompletions', 'towerCleanClears'),
    'thousand-cuts': p('bukijutsuKills huntCompletions', 'bukijutsuDamage pveKills', 'gatheringClaims', 'towerMechanicClears'),
    'duel-king': p('rankedWins pvpWins', 'sameRankWins pvpKills', 'cardClashWins', 'towerParClears'),
    'village-reaper': p('warPvpKills raidsCompleted', 'pvpWins warContribution', 'craftsCompleted', 'towerCleanClears'),
    'bloodstained-path': p('pvpKills huntCompletions', 'higherLevelWins pvpWins', 'raidsCompleted', 'towerMechanicClears'),
    'gatebreaker': p('hollowGateClears riftQuests', 'dungeonClears damageBlocked', 'huntCompletions', 'towerMechanicClears'),
    'trial-conqueror': p('dungeonClears towerClears', 'towerCleanClears missionCompletions', 'gatheringClaims', 'towerParClears'),
    'ancient-hunter': p('huntCompletions gatheringClaims', 'eliteKills riftQuests', 'petExpeditions', 'towerMechanicClears'),
    'ashen-will': p('villageDonations craftsCompleted', 'missionCompletions warContribution', 'gatheringClaims', 'towerCleanClears'),
    'storm-fang': p('warPvpKills raidsCompleted', 'sameRankWins warContribution', 'huntCompletions', 'towerMechanicClears'),
    'frostbound-shield': p('damageBlocked sectorDefenses', 'shieldsApplied defensiveWins', 'craftsCompleted', 'towerCleanClears'),
    'moonlit-oath': p('genjutsuKills riftQuests', 'genjutsuDamage raidsCompleted', 'villageDonations', 'towerParClears'),
    'village-guardian': p('healingDone sectorDefenses', 'shieldsApplied defensiveWins', 'professionActions', 'towerCleanClears'),
    'oathkeeper': p('shieldsApplied sectorDefenses', 'damageBlocked defensiveWins', 'healingDone', 'towerMechanicClears'),
    'mapless-one': p('gatheringClaims riftQuests', 'sectorDiscoveries huntCompletions', 'wandererQuests', 'towerCleanClears'),
    'shrine-seeker': p('wandererQuests craftsCompleted', 'riftQuests sectorDiscoveries', 'gatheringClaims', 'towerParClears'),
    'beast-sovereign': p('petDuelWins towerClears', 'petExpeditions huntCompletions', 'gatheringClaims', 'towerCleanClears'),
    'silent-gambit': p('cardClashWins craftsCompleted', 'cardClashWins wandererQuests', 'huntCompletions', 'towerParClears'),
    'warborn-banner': p('raidsCompleted warPvpKills', 'warContribution pvpWins', 'villageDonations', 'towerMechanicClears'),
    'elemental-storm': p('ninjutsuKills ninjutsuDamage', 'ninjutsuDamage missionCompletions', 'huntCompletions', 'towerParClears'),
    'burning-vanguard': p('ninjutsuKills warContribution', 'ninjutsuDamage raidsCompleted', 'craftsCompleted', 'towerMechanicClears'),
    'chakra-tempest': p('ninjutsuDamage towerClears', 'ninjutsuKills pveKills', 'riftQuests', 'towerCleanClears'),
    'stormcallers-path': p('ninjutsuKills riftQuests', 'ninjutsuDamage huntCompletions', 'wandererQuests', 'towerParClears'),
    'shadow-strategist': p('genjutsuKills towerParClears', 'genjutsuDamage missionCompletions', 'wandererQuests', 'towerMechanicClears'),
    'silent-fang': p('genjutsuKills pvpWins', 'genjutsuDamage sameRankWins', 'huntCompletions', 'towerCleanClears'),
    'dream-weaver': p('genjutsuKills healingDone', 'genjutsuDamage shieldsApplied', 'missionCompletions', 'towerCleanClears'),
    'mirage-dancer': p('genjutsuDamage towerMechanicClears', 'genjutsuKills towerClears', 'riftQuests', 'towerParClears'),
    'iron-fist': p('taijutsuKills taijutsuDamage', 'taijutsuDamage towerClears', 'huntCompletions', 'damageBlocked'),
    'bloodied-knuckle': p('taijutsuKills pvpWins', 'taijutsuDamage sameRankWins', 'missionCompletions', 'towerParClears'),
    'mountain-stance': p('taijutsuDamage damageBlocked', 'taijutsuKills shieldsApplied', 'craftsCompleted', 'towerCleanClears'),
    'crashing-wave': p('taijutsuKills pvpWins', 'taijutsuDamage defensiveWins', 'huntCompletions', 'towerMechanicClears'),
    'warborn-blade': p('bukijutsuKills bukijutsuDamage', 'bukijutsuDamage raidsCompleted', 'craftsCompleted', 'towerParClears'),
    'crimson-duelist': p('bukijutsuKills sameRankWins', 'bukijutsuDamage pvpWins', 'huntCompletions', 'towerCleanClears'),
    'quiet-scabbard': p('bukijutsuDamage craftsCompleted', 'bukijutsuKills towerParClears', 'wandererQuests', 'towerMechanicClears'),
    'hunters-edge': p('bukijutsuKills gatheringClaims', 'bukijutsuDamage huntCompletions', 'petExpeditions', 'towerParClears'),
    'proving-grounds': p('pvpWins sameRankWins', 'pvpKills rankedWins', 'missionCompletions', 'towerParClears'),
    'ranked-ascendant': p('rankedWins pvpWins', 'sameRankWins pvpKills', 'cardClashWins', 'towerCleanClears'),
    'giant-slayer': p('higherLevelWins pvpWins', 'sameRankWins rankedWins', 'huntCompletions', 'towerMechanicClears'),
    'wall-of-defiance': p('defensiveWins damageBlocked', 'sectorDefenses shieldsApplied', 'healingDone', 'towerCleanClears'),
    'hollow-seeker': p('hollowGateClears eliteKills', 'dungeonClears riftQuests', 'wandererQuests', 'towerMechanicClears'),
    'tower-climber': p('towerClears missionCompletions', 'towerCleanClears pveKills', 'craftsCompleted', 'towerParClears'),
    'mission-hound': p('missionCompletions huntCompletions', 'pveKills riftQuests', 'gatheringClaims', 'towerParClears'),
    'beast-tracker': p('huntCompletions gatheringClaims', 'eliteKills wandererQuests', 'petExpeditions', 'towerCleanClears'),
    'boss-breaker': p('towerMechanicClears huntCompletions', 'towerParClears raidsCompleted', 'riftQuests', 'towerCleanClears'),
    'dungeon-delver': p('dungeonClears gatheringClaims', 'hollowGateClears wandererQuests', 'craftsCompleted', 'towerParClears'),
    'ashen-hearth': p('villageDonations craftsCompleted', 'healingDone missionCompletions', 'gatheringClaims', 'towerCleanClears'),
    'embers-discipline': p('towerParClears missionCompletions', 'pveKills craftsCompleted', 'villageDonations', 'towerMechanicClears'),
    'tidebreaker': p('warPvpKills damageBlocked', 'raidsCompleted pvpWins', 'craftsCompleted', 'towerCleanClears'),
    'thunder-raider': p('raidsCompleted huntCompletions', 'warContribution riftQuests', 'gatheringClaims', 'towerParClears'),
    'northern-fang': p('sectorDefenses huntCompletions', 'defensiveWins shieldsApplied', 'craftsCompleted', 'towerMechanicClears'),
    'winter-sentinel': p('defensiveWins damageBlocked', 'sectorDefenses healingDone', 'missionCompletions', 'towerCleanClears'),
    'veiled-lantern': p('riftQuests sectorDiscoveries', 'wandererQuests healingDone', 'craftsCompleted', 'towerParClears'),
    'midnight-errand': p('missionCompletions craftsCompleted', 'raidsCompleted wandererQuests', 'gatheringClaims', 'towerCleanClears'),
    'hidden-path': p('gatheringClaims hiddenFinds', 'riftQuests wandererQuests', 'huntCompletions', 'towerMechanicClears'),
    'wayfarers-mark': p('gatheringClaims wandererQuests', 'sectorDiscoveries riftQuests', 'craftsCompleted', 'towerCleanClears'),
    'rumor-chaser': p('sectorDiscoveries riftQuests', 'wandererQuests gatheringClaims', 'missionCompletions', 'towerParClears'),
    'strangers-friend': p('wandererQuests sectorDiscoveries', 'riftQuests healingDone', 'petExpeditions', 'towerCleanClears'),
    'shielding-palm': p('shieldsApplied damageBlocked', 'healingDone towerClears', 'missionCompletions', 'towerCleanClears'),
    'field-medic': p('healingDone missionCompletions', 'shieldsApplied huntCompletions', 'craftsCompleted', 'towerParClears'),
    'purifying-light': p('healingDone towerCleanClears', 'damageBlocked riftQuests', 'wandererQuests', 'towerMechanicClears'),
    'pack-leader': p('petDuelWins petExpeditions', 'petExpeditions towerClears', 'gatheringClaims', 'huntCompletions'),
    'wild-heart': p('petExpeditions gatheringClaims', 'petDuelWins huntCompletions', 'wandererQuests', 'towerCleanClears'),
    'coliseum-tamer': p('petDuelWins cardClashWins', 'petExpeditions towerParClears', 'huntCompletions', 'towerMechanicClears'),
    'card-sharp': p('cardClashWins craftsCompleted', 'cardClashWins missionCompletions', 'gatheringClaims', 'towerParClears'),
    'tables-shadow': p('cardClashWins pvpWins', 'cardClashWins rankedWins', 'wandererQuests', 'towerCleanClears'),
    'sector-warden': p('sectorDefenses warContribution', 'defensiveWins raidsCompleted', 'craftsCompleted', 'towerCleanClears'),
    'banner-taker': p('raidsCompleted warPvpKills', 'warContribution pvpWins', 'huntCompletions', 'towerMechanicClears'),
    'siege-runner': p('raidsCompleted craftsCompleted', 'warContribution missionCompletions', 'gatheringClaims', 'towerParClears'),
    'war-drummer': p('warContribution raidsCompleted', 'craftsCompleted missionCompletions', 'villageDonations', 'towerMechanicClears'),
    'wandering-shinobi': p('gatheringClaims', 'sectorDiscoveries', 'wandererQuests', 'huntCompletions'),
    'village-veteran': p('missionCompletions', 'villageDonations', 'craftsCompleted', 'towerClears'),
    'proven-fighter': p('pvpWins', 'sameRankWins', 'huntCompletions', 'towerParClears'),
    'road-worn-shinobi': p('huntCompletions', 'riftQuests', 'gatheringClaims', 'towerClears'),
    'ember-student': p('ninjutsuKills', 'ninjutsuDamage', 'missionCompletions', 'towerClears'),
    'quiet-mind': p('genjutsuKills', 'genjutsuDamage', 'wandererQuests', 'towerParClears'),
    'calloused-fist': p('taijutsuKills', 'taijutsuDamage', 'huntCompletions', 'damageBlocked'),
    'steel-apprentice': p('bukijutsuKills', 'bukijutsuDamage', 'craftsCompleted', 'towerClears'),
    'field-hand': p('pveKills', 'towerClears', 'gatheringClaims', 'missionCompletions'),
    'beast-friend': p('petDuelWins', 'petExpeditions', 'gatheringClaims', 'huntCompletions'),
    'table-regular': p('cardClashWins', 'cardClashWins missionCompletions', 'wandererQuests', 'huntCompletions'),
    'lantern-bearer': p('healingDone', 'shieldsApplied', 'missionCompletions', 'damageBlocked'),
    'first-steps': p('wandererQuests', 'riftQuests', 'gatheringClaims', 'towerClears'),
    'honest-ryo': p('craftsCompleted', 'gatheringClaims', 'villageDonations', 'missionCompletions'),
    'steadfast-neighbor': p('damageBlocked', 'healingDone', 'missionCompletions', 'towerClears'),
};

/** Estimated yields for a 45-minute active session, not new reward rates. */
export const LEGACY_SESSION_YIELDS: Partial<Record<LegacyStatKey, number>> = {
    ninjutsuKills: 8, genjutsuKills: 8, taijutsuKills: 8, bukijutsuKills: 8,
    ninjutsuDamage: 8000, genjutsuDamage: 8000, taijutsuDamage: 8000, bukijutsuDamage: 8000,
    pvpWins: 2, pvpKills: 2, rankedWins: 1.5, sameRankWins: 1.5, higherLevelWins: 0.5,
    defensiveWins: 1, sectorDefenses: 1, warPvpKills: 1, pveKills: 10, eliteKills: 2,
    missionCompletions: 5, huntCompletions: 3, raidsCompleted: 2, warContribution: 2500,
    villageDonations: 2000, healingDone: 12000, shieldsApplied: 8, damageBlocked: 8000,
    hollowGateClears: 0.5, dungeonClears: 1, sectorDiscoveries: 2, wandererQuests: 2,
    hiddenFinds: 0.5, riftQuests: 1, gatheringClaims: 15, craftsCompleted: 4,
    petDuelWins: 3, petExpeditions: 2, cardClashWins: 4, professionActions: 2,
    towerClears: 1, towerCleanClears: 0.5, towerParClears: 0.5, towerMechanicClears: 0.5,
    clanBossOperations: 0.5,
};
export const LEGACY_AWAKENING_SESSIONS: Record<LegacyRarity, number> = { basic: 1.5, rare: 4, legendary: 7.5, mythic: 17.5 };
const STAGE_EFFORT: Record<TrialKind, number> = { awaken: 1, bind: 1.2, prove: 1.4, mythic: 1.65 };
const PVP = new Set<LegacyStatKey>(['pvpWins', 'pvpKills', 'rankedWins', 'sameRankWins', 'higherLevelWins', 'defensiveWins', 'sectorDefenses', 'warPvpKills', 'bestKillStreak', 'comebackWins']);

export function individualTrialObjectives(def: LegacyDef, kind: TrialKind, variant: number): TrialObjective[] {
    const path = LEGACY_TRIAL_PATHS[def.id];
    if (!path) throw new Error(`Missing Legacy trial path: ${def.id}`);
    const requiresPvp = def.reqs.some(req => 'stat' in req ? PVP.has(req.stat) : req.anyOf.every(part => PVP.has(part.stat)));
    const primary = path.variants[((variant % 2) + 2) % 2].split(' ') as LegacyStatKey[];
    const proofs = [...primary];
    if (kind === 'bind' || kind === 'mythic') proofs.push(path.bind);
    if (kind === 'prove' || kind === 'mythic') proofs.push(path.prove);
    const used = new Set<LegacyStatKey>();
    return proofs.map((raw, index) => {
        // Alternatives in qualification must not turn later stages into surprise PvP.
        let stat = !requiresPvp && PVP.has(raw) ? 'towerClears' as const : raw;
        if (used.has(stat)) stat = (['missionCompletions', 'huntCompletions', 'wandererQuests', 'gatheringClaims'] as const).find(key => !used.has(key))!;
        used.add(stat);
        const rate = LEGACY_SESSION_YIELDS[stat];
        if (!rate) throw new Error(`Non-repeatable Legacy trial proof: ${def.id}/${stat}`);
        const sessions = LEGACY_AWAKENING_SESSIONS[def.rarity] * STAGE_EFFORT[kind];
        // Supporting proofs are simultaneous breadth, not a second full grind.
        const share = index < primary.length ? 1 / primary.length : 0.5;
        return { stat, delta: Math.max(1, Math.round(rate * sessions * share)) };
    });
}

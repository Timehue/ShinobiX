// Profession daily mission pool. Each profession draws 3 random missions per
// UTC day. Rewards are profession XP only — "a little boost" on top of the
// per-action XP each profession already earns.
//
// Pet Tamer is intentionally absent per docs/professions.md: Pet Tamers earn
// XP from expeditions, not missions.

export type Profession = 'healer' | 'vanguard' | 'petTamer';

export type MissionKind =
    | 'healer-heal-count'        // increment per successful heal (caller passes targetName for unique)
    | 'healer-heal-unique'       // unique-target heal count
    | 'vanguard-pvp-wins'        // increment per PvP win
    | 'vanguard-pvp-unique';     // unique-opponent PvP wins

export type MissionTemplate = {
    templateId: string;
    profession: Profession;
    kind: MissionKind;
    name: string;
    description: string;
    target: number;
    xpReward: number;
};

const HEALER_POOL: MissionTemplate[] = [
    { templateId: 'healer-triage-run', profession: 'healer', kind: 'healer-heal-unique', name: 'Triage Run', description: 'Heal 3 different patients.', target: 3, xpReward: 50 },
    { templateId: 'healer-mercy-round', profession: 'healer', kind: 'healer-heal-unique', name: 'Mercy Round', description: 'Heal 4 different patients.', target: 4, xpReward: 60 },
    { templateId: 'healer-field-medic', profession: 'healer', kind: 'healer-heal-unique', name: 'Field Medic', description: 'Heal 5 different patients.', target: 5, xpReward: 75 },
    { templateId: 'healer-combat-medic', profession: 'healer', kind: 'healer-heal-count', name: 'Combat Medic', description: 'Perform 5 successful heals.', target: 5, xpReward: 75 },
    { templateId: 'healer-hospital-vigil', profession: 'healer', kind: 'healer-heal-count', name: 'Hospital Vigil', description: 'Perform 7 successful heals.', target: 7, xpReward: 100 },
    { templateId: 'healer-ward-watch', profession: 'healer', kind: 'healer-heal-unique', name: 'Ward Watch', description: 'Heal 8 different patients.', target: 8, xpReward: 125 },
    { templateId: 'healer-surgeon', profession: 'healer', kind: 'healer-heal-count', name: 'Surgeon', description: 'Perform 10 successful heals.', target: 10, xpReward: 125 },
    { templateId: 'healer-mass-casualty', profession: 'healer', kind: 'healer-heal-unique', name: 'Mass Casualty', description: 'Heal 10 different patients.', target: 10, xpReward: 150 },
];

const VANGUARD_POOL: MissionTemplate[] = [
    { templateId: 'vanguard-patrol', profession: 'vanguard', kind: 'vanguard-pvp-wins', name: 'Patrol', description: 'Win 1 PvP battle.', target: 1, xpReward: 30 },
    { templateId: 'vanguard-skirmish', profession: 'vanguard', kind: 'vanguard-pvp-wins', name: 'Skirmish', description: 'Win 2 PvP battles.', target: 2, xpReward: 50 },
    { templateId: 'vanguard-blooded', profession: 'vanguard', kind: 'vanguard-pvp-wins', name: 'Blooded', description: 'Win 3 PvP battles.', target: 3, xpReward: 75 },
    { templateId: 'vanguard-cleaner', profession: 'vanguard', kind: 'vanguard-pvp-unique', name: 'Cleaner', description: 'Defeat 3 different players.', target: 3, xpReward: 100 },
    { templateId: 'vanguard-massacre', profession: 'vanguard', kind: 'vanguard-pvp-wins', name: 'Massacre', description: 'Win 5 PvP battles.', target: 5, xpReward: 100 },
    { templateId: 'vanguard-headhunter', profession: 'vanguard', kind: 'vanguard-pvp-unique', name: 'Headhunter', description: 'Defeat 4 different players.', target: 4, xpReward: 125 },
    { templateId: 'vanguard-warpath', profession: 'vanguard', kind: 'vanguard-pvp-wins', name: 'Warpath', description: 'Win 7 PvP battles.', target: 7, xpReward: 150 },
    { templateId: 'vanguard-annihilator', profession: 'vanguard', kind: 'vanguard-pvp-unique', name: 'Annihilator', description: 'Defeat 5 different players.', target: 5, xpReward: 150 },
];

export function getMissionPool(profession: Profession): MissionTemplate[] {
    if (profession === 'healer') return HEALER_POOL;
    if (profession === 'vanguard') return VANGUARD_POOL;
    return [];
}

// Seeded RNG so the same (player, date) always yields the same pick — prevents
// "refresh until I like my missions" without needing extra storage.
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function stringHash(s: string): number {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

// Pick N templates from the pool, deterministic per (player, date).
export function pickDailyMissions(
    profession: Profession,
    playerName: string,
    dateKey: string,
    count = 3,
): MissionTemplate[] {
    const pool = getMissionPool(profession);
    if (pool.length === 0) return [];
    const take = Math.min(count, pool.length);
    const rng = mulberry32(stringHash(`${playerName}:${dateKey}`));
    const remaining = [...pool];
    const chosen: MissionTemplate[] = [];
    for (let i = 0; i < take; i += 1) {
        const idx = Math.floor(rng() * remaining.length);
        chosen.push(remaining.splice(idx, 1)[0]);
    }
    return chosen;
}

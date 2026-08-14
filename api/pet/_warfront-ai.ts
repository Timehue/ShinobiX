import { GAUNTLET_POOL, type GauntletPoolPet, type GauntletRole } from '../_pet-sim/_gauntlet-pool.js';
import type { Pet } from '../_pet-sim/pet-types.js';

/**
 * The Warfront opponent roster is selected by the server-prepared seed. The
 * scouting response exposes only this compact identity; the exact roster and
 * raw seed stay sealed until the player commits their squad and playbook.
 *
 * Members reference the generated canonical pet pool, so every fighter uses an
 * already-approved roster model/config instead of inventing Warfront-only art.
 */
export const WARFRONT_AI_WARBAND_VERSION = 1 as const;

export type WarfrontAiWarbandId = 'siege' | 'sustain' | 'ambush';
export type WarfrontAiWarbandScout = {
    version: typeof WARFRONT_AI_WARBAND_VERSION;
    id: WarfrontAiWarbandId;
    name: string;
    style: string;
};

export type WarfrontDifficultyBand = 'rookie' | 'veteran' | 'elite';
export type WarfrontDifficultySeal = {
    version: 1;
    band: WarfrontDifficultyBand;
    label: string;
    playerPower: number;
    opponentPower: number;
};

type WarfrontAiWarband = WarfrontAiWarbandScout & {
    /** Exactly one canonical fighter per Warfront role. */
    members: ReadonlyArray<{ petId: string; role: GauntletRole }>;
};

const WARBANDS: readonly WarfrontAiWarband[] = [
    {
        version: WARFRONT_AI_WARBAND_VERSION,
        id: 'siege',
        name: 'Iron Breach Company',
        style: 'Armored lane pressure and structure focus',
        members: [
            { petId: 'rare-20', role: 'defender' }, // Bamboo Ape
            { petId: 'rare-21', role: 'tracker' },  // Frostbite Cub
            { petId: 'rare-22', role: 'assassin' }, // Shrine Salamander
            { petId: 'rare-23', role: 'sage' },     // Granite Badger
        ],
    },
    {
        version: WARFRONT_AI_WARBAND_VERSION,
        id: 'sustain',
        name: 'Riverstone Covenant',
        style: 'Durable formation with steady recovery',
        members: [
            { petId: 'rare-12', role: 'defender' }, // Mist Lynx
            { petId: 'rare-9', role: 'tracker' },   // Bristle Boar
            { petId: 'rare-30', role: 'assassin' }, // Tidal Mink
            { petId: 'rare-31', role: 'sage' },     // Frost Seal
        ],
    },
    {
        version: WARFRONT_AI_WARBAND_VERSION,
        id: 'ambush',
        name: 'Ashwing Prowlers',
        style: 'Fast rotations and isolated-target pressure',
        members: [
            { petId: 'rare-0', role: 'defender' },  // Crimson Fox
            { petId: 'rare-17', role: 'tracker' },  // Stormfin Gull
            { petId: 'rare-18', role: 'assassin' }, // Duskwings Bat
            { petId: 'rare-7', role: 'sage' },      // Ashwing Raven
        ],
    },
] as const;

const CANONICAL_PETS = new Map(GAUNTLET_POOL.map((pet) => [pet.id, pet] as const));

function normalizedSeed(seed: number): number {
    return Number.isFinite(seed) ? (Math.floor(seed) >>> 0) : 0;
}

export function warfrontAiWarband(seed: number): WarfrontAiWarbandScout {
    const profile = WARBANDS[normalizedSeed(seed) % WARBANDS.length];
    return { version: profile.version, id: profile.id, name: profile.name, style: profile.style };
}

function selectedWarband(seed: number): WarfrontAiWarband {
    return WARBANDS[normalizedSeed(seed) % WARBANDS.length];
}

function asWarfrontPet(source: GauntletPoolPet, role: GauntletRole): Pet {
    return {
        id: source.id,
        name: source.name,
        element: (source.element ?? 'None') as Pet['element'],
        rarity: source.rarity,
        // Warfront rewards seal the opponent level. Keep all three profiles on
        // the same level so the hidden profile cannot change the economy payout.
        level: 18,
        xp: 0,
        maxLevel: 70,
        hp: source.hp,
        attack: source.attack,
        defense: source.defense,
        speed: source.speed,
        moveRange: role === 'defender' ? 2 : role === 'assassin' ? 5 : role === 'tracker' ? 4 : 3,
        jutsus: source.jutsus.map((jutsu) => ({
            name: jutsu.name,
            kind: jutsu.kind as Pet['jutsus'][number]['kind'],
            power: jutsu.power,
            cooldown: jutsu.cooldown,
            currentCooldown: 0,
        })),
        role,
        unlockedForPve: true,
    };
}

type CombatAverages = { level: number; hp: number; attack: number; defense: number; speed: number };

const finite = (value: unknown, fallback: number): number => {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
};

function combatAverages(pets: readonly Pet[]): CombatAverages {
    const count = Math.max(1, pets.length);
    const sum = pets.reduce((out, pet) => ({
        level: out.level + Math.max(1, Math.min(100, finite(pet.level, 1))),
        hp: out.hp + Math.max(1, Math.min(100_000, finite(pet.hp, 400))),
        attack: out.attack + Math.max(1, Math.min(100_000, finite(pet.attack, 40))),
        defense: out.defense + Math.max(0, Math.min(100_000, finite(pet.defense, 20))),
        speed: out.speed + Math.max(1, Math.min(100_000, finite(pet.speed, 30))),
    }), { level: 0, hp: 0, attack: 0, defense: 0, speed: 0 });
    return {
        level: sum.level / count,
        hp: sum.hp / count,
        attack: sum.attack / count,
        defense: sum.defense / count,
        speed: sum.speed / count,
    };
}

// Low-progression pets have enough health to participate but their raw attack
// and movement budgets sit below the fixed Warfront map/structure scale. If
// used verbatim, otherwise competitive rookie matches reach the ten-minute
// verdict far too often. Normalize only those two pacing axes to the canonical
// rare-roster floor; identity, health, defense, roles, jutsu, and every relative
// difference remain authoritative. Mid/max rosters are already above the floor
// and pass through byte-for-byte.
const WARFRONT_ATTACK_FLOOR = 80;
const WARFRONT_SPEED_FLOOR = 52;
export function normalizeWarfrontPlayerTeam(playerPets: readonly Pet[]): Pet[] {
    const avg = combatAverages(playerPets);
    const attackScale = Math.max(1, WARFRONT_ATTACK_FLOOR / Math.max(1, avg.attack));
    const speedScale = Math.max(1, WARFRONT_SPEED_FLOOR / Math.max(1, avg.speed));
    if (attackScale === 1 && speedScale === 1) return playerPets.map((pet) => ({ ...pet }));
    return playerPets.map((pet) => ({
        ...pet,
        attack: Math.max(1, Math.min(100_000, Math.round(finite(pet.attack, avg.attack) * attackScale))),
        speed: Math.max(1, Math.min(100_000, Math.round(finite(pet.speed, avg.speed) * speedScale))),
    }));
}

/** Compact, deterministic combat-strength indicator for disclosure and gates.
 * It is not an economy input; all fields come from the authoritative roster. */
export function warfrontRosterPower(pets: readonly Pet[]): number {
    const avg = combatAverages(pets);
    return Math.max(1, Math.round(avg.hp * 0.12 + avg.attack * 2 + avg.defense * 1.5 + avg.speed + avg.level * 4));
}

function difficultyBand(avgLevel: number): { band: WarfrontDifficultyBand; label: string; ratio: number } {
    if (avgLevel < 20) return { band: 'rookie', label: 'Rising Squad', ratio: 0.96 };
    if (avgLevel < 50) return { band: 'veteran', label: 'Veteran Front', ratio: 1 };
    // Max-level standard companions still face the authored rare warband's
    // deeper technique kits. A narrow raw-stat handicap keeps that matchup
    // competitive without erasing the opponent's elite tactical identity.
    return { band: 'elite', label: 'Elite Warfront', ratio: 0.96 };
}

const scaled = (source: number, sourceAverage: number, targetAverage: number, ratio: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, Math.round(source / Math.max(1, sourceAverage) * targetAverage * ratio)));

/**
 * Progression-aware opponent sealing. The warband identity/roles/jutsu remain
 * authored, while its raw stat budget follows the four pets the authenticated
 * player actually committed. This removes unwinnable new-player and trivial
 * max-roster extremes without reading client-provided stats or changing replay
 * determinism. The small band ratios are deliberately narrow so deployment and
 * Council choices, rather than account age, decide a close matchup.
 */
export function buildProgressionWarfrontAiTeam(
    count: number,
    seed: number,
    playerPets: readonly Pet[],
): { pets: Pet[]; difficulty: WarfrontDifficultySeal } {
    const base = buildWarfrontAiTeam(count, seed);
    const player = combatAverages(playerPets);
    const authored = combatAverages(base);
    const band = difficultyBand(player.level);
    const level = Math.max(1, Math.min(100, Math.round(player.level)));
    const pets = base.map((pet) => ({
        ...pet,
        level,
        maxLevel: 100,
        hp: scaled(finite(pet.hp, authored.hp), authored.hp, player.hp, band.ratio, 80, 100_000),
        attack: scaled(finite(pet.attack, authored.attack), authored.attack, player.attack, band.ratio, 8, 100_000),
        defense: scaled(finite(pet.defense, authored.defense), authored.defense, player.defense, band.ratio, 0, 100_000),
        speed: scaled(finite(pet.speed, authored.speed), authored.speed, player.speed, band.ratio, 8, 100_000),
    }));
    return {
        pets,
        difficulty: {
            version: 1,
            band: band.band,
            label: band.label,
            playerPower: warfrontRosterPower(playerPets),
            opponentPower: warfrontRosterPower(pets),
        },
    };
}

/** Build the exact seed-sealed AI team. A regulation Warfront is 4v4; count is
 * retained only for old diagnostic callers and never cycles/duplicates pets. */
export function buildWarfrontAiTeam(count: number, seed: number): Pet[] {
    const n = Math.max(1, Math.min(4, Math.floor(Number.isFinite(count) ? count : 4)));
    return selectedWarband(seed).members.slice(0, n).map(({ petId, role }) => {
        const source = CANONICAL_PETS.get(petId);
        if (!source) throw new Error(`warfront-ai: canonical pet ${petId} is missing`);
        return asWarfrontPet(source, role);
    });
}

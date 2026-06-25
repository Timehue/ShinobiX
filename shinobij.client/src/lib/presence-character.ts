/**
 * presenceCharacter — project a full Character down to the display-only fields the
 * presence frame carries. Extracted verbatim from App.tsx as an App-size drain;
 * behaviour is identical to the previous in-App definition.
 *
 * ── Heartbeat presence projection ─────────────────────────────────────────
 * The heartbeat POST used to upload the player's ENTIRE character every beat
 * (inventory, jutsu, stats, bloodlines, mission journals, full pet objects,
 * and a base64 avatar data URL). At a 1s cadence that was a large repeated
 * upload, a fat presence-row write, and bloated the roster mget that reads
 * these rows back. The presence row's `character` is consumed ONLY by the
 * roster endpoint for *display* (and the Pet Arena reads `pets` for PvP pet
 * challenges). Gameplay/PvP paths (attack, challenge, heal, clear-attack)
 * read only sector/inBattle/travelingUntil/pendingAttacker — never character;
 * real combat hydrates the opponent from save:<name> via fetchPlayerCombatSave.
 *
 * So we upload only the display fields the roster surfaces. Notable drops:
 *   • avatarImage — every avatar render site falls back to the name-keyed
 *     sharedImages['avatar:<name>'] cache, so the heavy data URL is redundant.
 *   • inventory / jutsu / stats / bloodlines / mission+quest logs / currencies
 *     — never read off the presence row; roster.ts strips them anyway.
 * Pets are kept but projected to the same public fields roster.ts exposes, so
 * Pet Arena opponent selection keeps working without shipping pet movesets etc.
 * pet `image` is dropped for the SAME reason as avatarImage: every pet render
 * site (PetArenaCard / PetBattleAvatar) resolves the sprite from the viewer's
 * own sharedImages['pet:<id>'|'pet:<base>'] cache and only falls back to
 * pet.image, so shipping the (often multi-100 KB) data URL on every 1s heartbeat
 * was pure waste. Stats/jutsus stay, so the pet battle sim is unaffected.
 */
import type { Character } from "../types/character";

const PRESENCE_PET_FIELDS = [
    'id', 'name', 'rarity', 'level', 'element', 'trait', 'species',
    'hp', 'attack', 'defense', 'speed', 'jutsus', 'xp', 'unlockedForPve', 'expedition',
] as const;

export function presenceCharacter(c: Character): Partial<Character> {
    const src = c as unknown as Record<string, unknown>;
    const slim: Record<string, unknown> = {};
    // Display scalars the roster / profile cards render. Avatar intentionally
    // omitted — resolved from the shared image cache by name.
    const KEEP = [
        'name', 'level', 'village', 'specialty', 'rank', 'rankTitle', 'customTitle',
        'profession', 'professionRank', 'professionXp', 'rankedRating', 'petRankedRating',
        'clan', 'clanFounder', 'hp', 'maxHp',
    ];
    for (const k of KEEP) if (k in src) slim[k] = src[k];
    // Pets: project to public fields only (Pet Arena needs the list + basic stats).
    const pets = src.pets;
    if (Array.isArray(pets)) {
        slim.pets = pets.map((p) => {
            if (!p || typeof p !== 'object') return p;
            const ps = p as Record<string, unknown>;
            const out: Record<string, unknown> = {};
            for (const f of PRESENCE_PET_FIELDS) if (f in ps) out[f] = ps[f];
            return out;
        });
    }
    return slim as Partial<Character>;
}

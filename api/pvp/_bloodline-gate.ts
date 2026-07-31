/*
 * Server-side bloodline access gate for jutsu.
 *
 * The client hides bloodline-only jutsu behind canEquipElementJutsu
 * (shinobij.client/src/lib/bloodline.ts), but until this module nothing on the
 * server re-checked it: the learn endpoint accepted any JUTSU_CATALOG /
 * admin-authored id and resolveEquippedLoadout sealed it into combat — so a
 * player with no bloodline could field the built-in (or an authored) bloodline
 * kit in ranked PvP.
 *
 * The rule mirrors the client check, relaxed only where the server cannot know
 * more (it never rejects a loadout the client legally allows):
 *   • no element / "None"                        → universal, always usable
 *   • one of the base elements (or Yin/Yang)     → usable (element awakening is
 *     not a bloodline concern; the client's own-element check is not enforced
 *     here so legacy saves with a sparse `elements[]` keep their kits)
 *   • a BUILT-IN bloodline jutsu (by id)         → must carry that bloodline
 *   • any other special-element jutsu            → must own the element, or
 *     carry a bloodline that grants it (special element match, or the jutsu is
 *     in the bloodline's own list)
 *
 * "Carried" = the starter bloodline (character.bloodline, with the legacy
 * "Blue Blade Eyes" alias) plus the currently EQUIPPED bloodline
 * (character.equippedBloodlineId resolved against the save's own
 * savedBloodlines or the built-in list) — the same set the client's
 * getCharacterBloodlines produces. Stored-but-unequipped bloodlines do NOT
 * grant access, matching the client.
 *
 * BUILTIN_BLOODLINES is a hand-kept mirror of starterSavedBloodlines
 * (shinobij.client/src/data/jutsu.ts) — guarded in lock-step by
 * scripts/bloodline-gate-parity.test.mjs (runs in `npm test`).
 *
 * Leaf module (no combat/storage imports) so both api/pvp/session.ts and
 * api/training/jutsu-ryo.ts can use it without cycles.
 */
import { characterOwnsElement } from './_elements.js';

export type BuiltinBloodline = {
    id: string;
    name: string;
    specialElement: string;
    jutsuIds: readonly string[];
};

export const BUILTIN_BLOODLINES: readonly BuiltinBloodline[] = [
    {
        id: 'starter-bloodline-ashen-eyes',
        name: 'Ashen Eyes',
        specialElement: 'Blood',
        jutsuIds: ['ashen-eyes-blood-gaze', 'ashen-eyes-crimson-hall', 'ashen-eyes-vein-mirror', 'ashen-eyes-hematoma-veil'],
    },
    {
        id: 'starter-bloodline-inferno-cataclysm',
        name: 'Inferno Cataclysm',
        specialElement: 'Lava',
        jutsuIds: ['inferno-cataclysm-lava-burst', 'inferno-cataclysm-molten-rain', 'inferno-cataclysm-crater-lance', 'inferno-cataclysm-obsidian-afterglow'],
    },
    {
        id: 'starter-bloodline-shadow-lotus',
        name: 'Shadow Lotus',
        specialElement: 'Shadow',
        jutsuIds: ['shadow-lotus-umbra-senbon', 'shadow-lotus-night-petal', 'shadow-lotus-eclipse-wire', 'shadow-lotus-black-petal-guard'],
    },
    {
        id: 'starter-bloodline-iron-fang',
        name: 'Iron Fang',
        specialElement: 'Iron',
        jutsuIds: ['iron-fang-ferrous-crash', 'iron-fang-steel-maw', 'iron-fang-magnet-knuckle', 'iron-fang-anvil-breath'],
    },
];

// Elements that are NOT bloodline-exclusive: the five awakenable base elements
// plus Yin/Yang (weapon-attunement elements) and the no-element sentinels.
const OPEN_ELEMENTS: ReadonlySet<string> = new Set([
    '', 'none', 'fire', 'water', 'earth', 'wind', 'lightning', 'yin', 'yang',
]);

const BUILTIN_BY_JUTSU_ID = new Map<string, BuiltinBloodline>(
    BUILTIN_BLOODLINES.flatMap((b) => b.jutsuIds.map((id) => [id, b] as const)),
);

type CarriedBloodline = {
    id: string;
    specialElement: string;
    jutsuIds: ReadonlySet<string>;
};

function lower(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

// The bloodlines the character is CARRYING right now — mirrors the client's
// getCharacterBloodlines: the starter (by name, legacy alias remapped) plus the
// equipped bloodline (custom from the save's own savedBloodlines, or built-in).
export function carriedBloodlines(
    saveCharacter: Record<string, unknown>,
    save: Record<string, unknown> | null,
): CarriedBloodline[] {
    const out: CarriedBloodline[] = [];
    const push = (id: string, specialElement: unknown, jutsus: unknown): void => {
        if (out.some((b) => b.id === id)) return;
        const ids = new Set<string>();
        if (Array.isArray(jutsus)) {
            for (const j of jutsus) {
                const jid = j && typeof j === 'object' ? lower((j as Record<string, unknown>).id) : '';
                if (jid) ids.add(jid);
            }
        }
        out.push({ id, specialElement: lower(specialElement), jutsuIds: ids });
    };
    const starterName = saveCharacter.bloodline === 'Blue Blade Eyes' ? 'Ashen Eyes' : String(saveCharacter.bloodline ?? '');
    const starter = BUILTIN_BLOODLINES.find((b) => b.name === starterName);
    if (starter) push(starter.id, starter.specialElement, starter.jutsuIds.map((id) => ({ id })));
    const equippedId = typeof saveCharacter.equippedBloodlineId === 'string' ? saveCharacter.equippedBloodlineId : '';
    if (equippedId) {
        const saved = Array.isArray(save?.savedBloodlines) ? save.savedBloodlines as unknown[] : [];
        const custom = saved.find(
            (b) => b && typeof b === 'object' && (b as Record<string, unknown>).id === equippedId,
        ) as Record<string, unknown> | undefined;
        if (custom) push(equippedId, custom.specialElement, custom.jutsus);
        else {
            const builtin = BUILTIN_BLOODLINES.find((b) => b.id === equippedId);
            if (builtin) push(builtin.id, builtin.specialElement, builtin.jutsuIds.map((id) => ({ id })));
        }
    }
    return out;
}

/**
 * May this character legitimately field `jutsu`? See the module header for the
 * rule. `save` is the player's full record (savedBloodlines lives top-level);
 * pass null only for save-less callers — the caller should skip the gate then
 * (NPC loadouts are server-authored, not player-claimed).
 */
export function characterMayUseJutsu(
    saveCharacter: Record<string, unknown>,
    save: Record<string, unknown> | null,
    jutsu: { id?: unknown; element?: unknown },
): boolean {
    const jutsuId = lower(jutsu.id);
    const carried = (): CarriedBloodline[] => carriedBloodlines(saveCharacter, save);
    const builtinOwner = BUILTIN_BY_JUTSU_ID.get(jutsuId);
    if (builtinOwner) {
        return carried().some((b) => b.id === builtinOwner.id);
    }
    const element = lower(jutsu.element);
    if (OPEN_ELEMENTS.has(element)) return true;
    if (characterOwnsElement(saveCharacter, element)) return true;
    return carried().some((b) => b.specialElement === element || b.jutsuIds.has(jutsuId));
}

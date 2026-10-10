/*
 * Who holds a sector's garrison — the one answer all three win-conditions share.
 *
 * The Combat garrison already had this rule inline in api/village/sector-war.ts:
 * the defending village's current ANBU, or — when a village has not appointed
 * any yet — its seated Kage, who is also a real appointed leader. Without the
 * Kage fallback a village could leave its garrison permanently unassaultable
 * simply by never appointing ANBU, which is the same "absent defence wins by
 * being absent" hole the Card/Pet garrisons exist to close.
 *
 * Card and Pet now field garrisons too, so the rule moved here rather than
 * being written a second and third time. Each engine seals something different
 * from the chosen defender (Combat their sealed ANBU character, Pet their war
 * team, Card their Chronicle deck) — but WHO defends is one decision, and a
 * player should never find that the same village fields a garrison against one
 * win-condition and not another.
 *
 * `pickAnbuDefender` rotates the choice and stamps its own last-defended map,
 * so repeat assaults spread across a village's appointees instead of grinding
 * one person's sealed kit.
 *
 * Choosing a defender is not enough, though: the chosen one must be ABLE to
 * field what the engine seals. An ANBU whose pets are all on an expedition or
 * breeding has no war team, one who never built a Chronicle deck has no deck,
 * one with no save has no snapshot. Picking that player and refusing ("the
 * garrison has nothing to hold with") made the garrison unassaultable for as
 * long as the rotation kept landing on them, while every other appointee and
 * the Kage stood ready. `fieldGarrisonDefender` walks the rotation instead.
 */
import { kv } from './_storage.js';
import { safeName } from './_utils.js';
import {
    anbuLastDefKey,
    loadAnbuAppointees,
    pickAnbuDefender,
    villageSlug,
} from './_anbu-infiltration-store.js';

export interface GarrisonDefender {
    /** safeName slug of the player whose sealed kit defends this sector. */
    slug: string;
    /** True when the seated Kage stood in: the village has no ANBU appointed,
     *  or none of its ANBU could field what this engine seals. */
    byKage: boolean;
}

function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

/** The seated Kage of a village, or '' when the seat is empty. */
export async function seatedKageOf(village: string): Promise<string> {
    const st = await kv.get<{ seatedKage?: string }>(kageKey(village));
    const name = safeName(st?.seatedKage ?? '');
    const save = name ? await kv.get<{ character?: { village?: string } }>(`save:${name}`) : null;
    return String(save?.character?.village ?? '').trim().toLowerCase() === village.trim().toLowerCase() ? name : '';
}

/**
 * Choose the player whose sealed kit defends `village`'s garrison, or null when
 * the village has neither current ANBU nor a seated Kage.
 *
 * A null is a real refusal, not a fallback to nobody: a village with no leader
 * at all fields no garrison, and the caller must say so rather than inventing a
 * defender. That is the one case where an absent defence still holds, and it is
 * deliberate — there is no one there to have sealed a kit.
 */
export async function garrisonDefenderFor(village: string): Promise<GarrisonDefender | null> {
    const appointees = await loadAnbuAppointees(village);
    if (appointees.length > 0) {
        const slug = await pickAnbuDefender(village, appointees);
        if (slug) return { slug, byKage: false };
    }
    const kage = await seatedKageOf(village);
    return kage ? { slug: kage, byKage: true } : null;
}

/** The refusal a caller shows when `garrisonDefenderFor` returns null. */
export const NO_GARRISON_DEFENDER_ERROR =
    'That village has no ANBU or Kage to field a garrison yet.';

/**
 * The order `pickAnbuDefender` picks in — least recently defended first, ties
 * broken by slug — WITHOUT stamping anyone. Only the appointee who actually
 * defends is stamped (by `fieldGarrisonDefender`), so one who cannot field
 * never pushes the rotation along on a refusal.
 */
export async function garrisonRotation(village: string, appointees: readonly string[]): Promise<string[]> {
    const lastMap = (await kv.get<Record<string, unknown>>(anbuLastDefKey(villageSlug(village)))) ?? {};
    const lastDefended = (slug: string): number => {
        const at = Number(Object.prototype.hasOwnProperty.call(lastMap, slug) ? lastMap[slug] : 0);
        return Number.isFinite(at) ? at : 0;
    };
    // Slug order first, then a STABLE sort on the timestamp: equal timestamps
    // keep slug order, exactly the tie-break pickAnbuDefender applies.
    return [...appointees].sort().sort((a, b) => lastDefended(a) - lastDefended(b));
}

export type FieldedGarrison<T> =
    | {
        ok: true;
        defender: GarrisonDefender;
        /** What `field` sealed from the defender (a deck, a team, a snapshot). */
        fielded: T;
        /** The appointee roster as loaded: its order numbers the masked name. */
        appointees: string[];
    }
    | {
        ok: false;
        /** `no-defender`: no ANBU and no seated Kage at all. `cannot-field`:
         *  there were candidates, and none of them could field this engine. */
        reason: 'no-defender' | 'cannot-field';
    };

/**
 * The defender who holds this garrison for ONE engine: the first appointee in
 * rotation order whose `field` succeeds, then the seated Kage. `field` returns
 * what it sealed, or null when that player cannot field it right now.
 *
 * Only a total failure refuses, and it says which kind: a village with nobody
 * to defend (NO_GARRISON_DEFENDER_ERROR) is a different message from one whose
 * defenders all happen to be unable to field right now.
 */
export async function fieldGarrisonDefender<T>(
    village: string,
    field: (slug: string) => Promise<T | null | undefined>,
): Promise<FieldedGarrison<T>> {
    const appointees = await loadAnbuAppointees(village);
    for (const slug of await garrisonRotation(village, appointees)) {
        const fielded = await field(slug);
        if (fielded == null) continue;
        // Stamp exactly the appointee who defends: a one-name roster makes
        // pickAnbuDefender choose (and timestamp) them, so the shared rotation
        // moves past them the same way it always has.
        await pickAnbuDefender(village, [slug]);
        return { ok: true, defender: { slug, byKage: false }, fielded, appointees };
    }
    const kage = await seatedKageOf(village);
    if (kage && !appointees.includes(kage)) {
        const fielded = await field(kage);
        if (fielded != null) return { ok: true, defender: { slug: kage, byKage: true }, fielded, appointees };
    }
    return { ok: false, reason: appointees.length > 0 || kage ? 'cannot-field' : 'no-defender' };
}

/**
 * The name the attacker sees for the garrison's defender. Masked like Anbu
 * Infiltration's own defender — the garrison represents the village's defence,
 * not a callout of which player it is — but numbered by roster position (owner
 * ruling) so a returning attacker can tell whether they face the same ANBU
 * again or a rotation. loadAnbuAppointees is order-preserving, so the number
 * is stable for as long as that ANBU stays appointed.
 */
export function maskedGarrisonDefenderName(
    village: string,
    defender: GarrisonDefender,
    appointees: readonly string[],
): string {
    const shortVillage = village.replace(/\s+Village$/i, '').trim() || 'Village';
    if (defender.byKage) return `The ${shortVillage} Kage`;
    const index = appointees.indexOf(defender.slug);
    return `${shortVillage} Anbu #${index >= 0 ? index + 1 : appointees.length}`;
}

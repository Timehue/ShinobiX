/*
 * Who holds a sector's garrison — the one answer all three win-conditions share.
 *
 * The Combat garrison already had this rule inline in api/village/sector-war.ts:
 * the defending village's appointed ANBU, or — when a village has not appointed
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
 */
import { kv } from './_storage.js';
import { safeName } from './_utils.js';
import { loadAnbuAppointees, pickAnbuDefender } from './_anbu-infiltration-store.js';

export interface GarrisonDefender {
    /** safeName slug of the player whose sealed kit defends this sector. */
    slug: string;
    /** True when no ANBU were appointed and the seated Kage stood in. */
    byKage: boolean;
}

function kageKey(village: string): string {
    return `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
}

/** The seated Kage of a village, or '' when the seat is empty. */
export async function seatedKageOf(village: string): Promise<string> {
    const st = await kv.get<{ seatedKage?: string }>(kageKey(village));
    return safeName(st?.seatedKage ?? '');
}

/**
 * Choose the player whose sealed kit defends `village`'s garrison, or null when
 * the village has neither appointed ANBU nor a seated Kage.
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

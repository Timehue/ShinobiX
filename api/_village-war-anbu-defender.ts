import { randomInt } from 'node:crypto';
import { loadAnbuAppointees, villageSlug, type AnbuSnapshot } from './_anbu-infiltration-store.js';
import { seatedKageOf, type FieldedGarrison } from './_sector-war-garrison-defender.js';
import { kv } from './_storage.js';
import { buildWarTeam } from './_pet-showdown/war-team.js';
import { augmentSaveWithForgedDefs } from './_forged-item-registry.js';
import { loadAdminCombatContent } from './_admin-content.js';
import { hydrateCharacterFromSave } from './pvp/session.js';

/** Existing village ANBU artwork, including its published cache revision. */
export const campaignAnbuAvatar = (village: string) => `/anbu/${villageSlug(village).replace(/village$/, '')}.webp?v=2`;

/** Seal the current player build for this assault, independently of daily vault copies. */
export async function sealCampaignAnbuCombat(slug: string): Promise<AnbuSnapshot | null> {
    const save = await augmentSaveWithForgedDefs(await kv.get<Record<string, unknown>>(`save:${slug}`));
    const character = save?.character as Record<string, unknown> | undefined;
    if (!character || typeof character !== 'object') return null;
    return { slug, name: String(character.name ?? slug), sealedAt: Date.now(),
        character: hydrateCharacterFromSave(character, {}, save, await loadAdminCombatContent()) };
}

/** Async village defenses are reusable copies, selected afresh for each assault. */
export async function fieldCampaignAnbu<T>(village: string, field: (slug: string) => Promise<T | null | undefined>,
    pickIndex: (length: number) => number = randomInt): Promise<FieldedGarrison<T>> {
    const appointees = await loadAnbuAppointees(village);
    const candidates = [...appointees];
    while (candidates.length) {
        const [slug] = candidates.splice(pickIndex(candidates.length), 1);
        const fielded = await field(slug);
        if (fielded != null) return { ok: true, defender: { slug, byKage: false }, fielded, appointees };
    }
    const kage = await seatedKageOf(village);
    if (kage && !appointees.includes(kage)) {
        const fielded = await field(kage);
        if (fielded != null) return { ok: true, defender: { slug: kage, byKage: true }, fielded, appointees };
    }
    return { ok: false, reason: appointees.length || kage ? 'cannot-field' : 'no-defender' };
}

/** AI copies may use pets whose real owners are breeding or on expeditions. */
export async function sealCampaignAnbuTeam(slug: string) {
    const save = await kv.get<{ character?: Record<string, unknown> }>(`save:${slug}`);
    if (!save?.character) return null;
    const snapshot = structuredClone(save.character);
    delete snapshot.petBreeding;
    if (Array.isArray(snapshot.pets)) snapshot.pets = snapshot.pets.map(pet => {
        if (!pet || typeof pet !== 'object') return pet;
        const copy = { ...pet }; delete copy.expedition; return copy;
    });
    return buildWarTeam(snapshot);
}

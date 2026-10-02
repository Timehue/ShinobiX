/*
 * Fight parity for slimmed player saves.
 *
 * Runs the REAL fighter-loading path every PvP and PvE mode uses — the forged
 * registry top-up (augmentSaveWithForgedDefs), hydrateCharacterFromSave and the
 * Tower/clan-boss sealer (sealTowerFighter) — on the original save and on its
 * slimmed form, plus the item resolver for every equipped and owned item id. A
 * slim is only allowed when every output is identical.
 *
 * Fields that differ between two runs on the ORIGINAL save (a timestamp or a
 * random value, if the loader ever stamps one) are baseline noise and excluded,
 * so the check reports only differences the slim itself caused.
 */
import { isDeepStrictEqual } from 'node:util';
import { augmentSaveWithForgedDefs } from '../_forged-item-registry.js';
import { hydrateCharacterFromSave } from '../pvp/session.js';
import { sealTowerFighter } from '../towers/_seal.js';
import { buildItemLookup } from '../pvp/_multipliers.js';
import { loadAdminCombatContent, type AdminCombatContent } from '../_admin-content.js';
import { SLIMMED_SHARED_FIELDS } from './_slim-player-save.js';

type SaveRecord = Record<string, unknown>;

export type SlimParity = { equal: boolean; diffs: string[] };

function ownedItemIds(character: Record<string, unknown>): string[] {
    const ids = new Set<string>();
    if (character.equipment && typeof character.equipment === 'object') {
        for (const value of Object.values(character.equipment as Record<string, unknown>)) if (typeof value === 'string' && value) ids.add(value);
    }
    if (Array.isArray(character.inventory)) for (const value of character.inventory) if (typeof value === 'string' && value) ids.add(value);
    if (Array.isArray(character.itemStacks)) {
        for (const stack of character.itemStacks) {
            const id = stack && typeof stack === 'object' ? (stack as Record<string, unknown>).itemId : undefined;
            if (typeof id === 'string' && id) ids.add(id);
        }
    }
    return [...ids].sort();
}

function changedKeys(a: Record<string, unknown>, b: Record<string, unknown>): Set<string> {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const out = new Set<string>();
    for (const key of keys) if (!isDeepStrictEqual(a[key], b[key])) out.add(key);
    return out;
}

async function loadFighters(record: SaveRecord, admin: AdminCombatContent) {
    const save = (await augmentSaveWithForgedDefs(structuredClone(record))) as SaveRecord;
    const character = save.character as Record<string, unknown>;
    return {
        hydrated: hydrateCharacterFromSave(structuredClone(character), {}, save, admin),
        sealed: sealTowerFighter(structuredClone(character), save, {}, admin),
        getItem: buildItemLookup(save.creatorItems, admin.items),
    };
}

/** Compare the fighter the original and slimmed saves load into every fight. */
export async function checkSlimParity(original: SaveRecord, slimmed: SaveRecord, admin: AdminCombatContent): Promise<SlimParity> {
    const character = original.character;
    if (!character || typeof character !== 'object') return { equal: true, diffs: [] };
    const [before, again, after] = await Promise.all([
        loadFighters(original, admin),
        loadFighters(original, admin),
        loadFighters(slimmed, admin),
    ]);
    const diffs: string[] = [];
    for (const kind of ['hydrated', 'sealed'] as const) {
        const noise = changedKeys(before[kind], again[kind]);
        for (const key of changedKeys(before[kind], after[kind])) {
            if (!noise.has(key)) diffs.push(`${kind}.${key}`);
        }
    }
    for (const id of ownedItemIds(character as Record<string, unknown>)) {
        if (!isDeepStrictEqual(before.getItem(id), after.getItem(id))) diffs.push(`item:${id}`);
    }
    return { equal: diffs.length === 0, diffs };
}

/**
 * True while the STORED row still carries the shared-content copies, i.e. this
 * save has never been slimmed. Only that first slim removes anything a loader
 * could conceivably have read; once a save is slim, later autosaves only drop
 * re-sent copies of catalog items the player does not hold, which resolve
 * identically by construction.
 */
export function isFirstSlim(stored: SaveRecord | null | undefined): boolean {
    if (!stored || typeof stored !== 'object') return false;
    return SLIMMED_SHARED_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(stored, field));
}

// Saves whose first slim failed parity (or whose loaders threw on it) in this
// process: kept full, logged once, and not re-checked on every autosave. A
// restart re-checks them.
const parityRefused = new Set<string>();

/**
 * The production gate for a save's FIRST slim: run the real fight loaders on
 * the record about to be committed, full and slimmed, and allow the slim only
 * when every fighter output is identical. Anything unexpected — a difference,
 * a loader error, the admin catalog unavailable — keeps the save full. The
 * check therefore runs once per player, on real data, with no switch to set.
 */
export async function firstSlimKeepsEveryFight(
    saveKey: string,
    full: SaveRecord,
    slimmed: SaveRecord,
    loadAdmin: () => Promise<AdminCombatContent> = loadAdminCombatContent,
): Promise<boolean> {
    if (parityRefused.has(saveKey)) return false;
    let admin: AdminCombatContent;
    try {
        admin = await loadAdmin();
    } catch (error) {
        // Not this save's fault (e.g. the admin catalog is briefly unavailable):
        // keep it full this time and try again on a later autosave.
        console.warn(`[slim-save] ${saveKey} kept full: admin content unavailable`, error instanceof Error ? error.message : error);
        return false;
    }
    try {
        const parity = await checkSlimParity(full, slimmed, admin);
        if (parity.equal) return true;
        parityRefused.add(saveKey);
        console.warn(`[slim-save] ${saveKey} kept full: the slim would change ${parity.diffs.slice(0, 10).join(', ')}`);
        return false;
    } catch (error) {
        parityRefused.add(saveKey);
        console.warn(`[slim-save] ${saveKey} kept full: parity check failed`, error instanceof Error ? error.message : error);
        return false;
    }
}

/** Test hook. */
export function __resetSlimParityRefusals(): void {
    parityRefused.clear();
}

/** Offline fixture validation only; never repairs or writes a player save. */
import { canonicalEquipmentSlot, EQUIPMENT_SLOTS, REFERENCE_EQUIPMENT_SLOTS } from '../api/_equipment-ownership.js';
import { maxLoadout } from '../api/_entitlements.js';
import { earnedForLevel, maxHpForLevel, maxChakraForLevel, maxStaminaForLevel, rankFromLevel, STAT_KEYS } from '../api/_xp-engine.js';
import { jutsuLevelCapForLevel, statCapForLevel } from '../api/combat-core/formulas.js';
import { ITEM_CATALOG } from '../api/pvp/_item-catalog.js';
import { JUTSU_CATALOG } from '../api/pvp/_jutsu-catalog.js';
import { carriedBloodlines, characterMayUseJutsu } from '../api/pvp/_bloodline-gate.js';
import { deriveBloodlineMultiplier } from '../api/pvp/_multipliers.js';
import { hydrateCharacterFromSave } from '../api/pvp/session.js';
import { effectiveItemLevelReq } from '../shared/item-level-gate.js';

type Row = Record<string, unknown>;
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
export type FixtureFailure = { code: string; path: string };
export type FixtureAuditOptions = { expectedBloodlineRank?: 'B Rank' | 'A Rank' | 'S Rank'; expectedMasteryCeiling?: number };

/** Sources are server catalogs/owned definitions, not client display fields.
 * Native nature access is reported separately: the authoritative server gate
 * intentionally accepts learned basic elements beyond awakened natures. */
export function auditPressureFixture(save: Row, level: number, options: FixtureAuditOptions = {}) {
    const c = record(save.character), failures: FixtureFailure[] = [], acquisitionWarnings: FixtureFailure[] = [];
    const fail = (code: string, path: string) => { failures.push({ code, path }); };
    if (!whole(level) || level < 1 || level > 100 || c.level !== level) fail('character-level', 'character.level');
    if (c.rankTitle !== rankFromLevel(level)) fail('character-rank', 'character.rankTitle');
    const stats = record(c.stats), statCap = statCapForLevel(level);
    let allocated = 0;
    for (const key of STAT_KEYS) {
        const value = stats[key];
        if (!whole(value) || value < 10 || value > statCap) fail('stat-rank-cap', `character.stats.${key}`);
        if (whole(value)) allocated += Math.max(0, value - 10);
    }
    const unspent = c.unspentStats ?? 0;
    if (!whole(c.earnedStatPoints) || !whole(unspent) || c.earnedStatPoints < earnedForLevel(level)
        || allocated + Number(unspent) !== c.earnedStatPoints) fail('earned-ledger', 'character.earnedStatPoints');
    const pools = { maxHp: maxHpForLevel(level), maxChakra: maxChakraForLevel(level), maxStamina: maxStaminaForLevel(level) };
    for (const [maximum, expected] of Object.entries(pools)) {
        const current = maximum === 'maxHp' ? 'hp' : maximum === 'maxChakra' ? 'chakra' : 'stamina';
        if (c[maximum] !== expected) fail('level-resource-pool', `character.${maximum}`);
        if (!whole(c[current]) || Number(c[current]) > expected) fail('current-resource-range', `character.${current}`);
    }

    const available = new Map<string, number>();
    for (const id of Array.isArray(c.inventory) ? c.inventory : []) if (typeof id === 'string') available.set(id, (available.get(id) ?? 0) + 1);
    for (const raw of Array.isArray(c.itemStacks) ? c.itemStacks : []) {
        const stack = record(raw);
        if (typeof stack.itemId === 'string' && whole(stack.count)) available.set(stack.itemId, (available.get(stack.itemId) ?? 0) + stack.count);
    }
    const equipment = record(c.equipment), slots = new Set<string>(), usedItems = new Set<string>();
    for (const [slot, raw] of Object.entries(equipment)) {
        const path = `character.equipment.${slot}`, id = typeof raw === 'string' ? raw : '', item = ITEM_CATALOG[id];
        const canonical = canonicalEquipmentSlot(slot);
        if (!EQUIPMENT_SLOTS.has(slot) || slots.has(canonical)) fail('equipment-slot', path);
        slots.add(canonical);
        if (!item) { fail('equipment-source', path); continue; }
        const kind = canonicalEquipmentSlot(item.slot);
        if (canonical !== kind && !(['item2', 'item3'].includes(canonical) && kind === 'item1')) fail('equipment-kind', path);
        if (canonical === 'aura' && id !== 'aura-sphere') fail('equipment-kind', path);
        if (usedItems.has(id)) fail('equipment-duplicate', path);
        usedItems.add(id);
        if ((available.get(id) ?? 0) < 1) fail('equipment-owned-count', path);
        if (!REFERENCE_EQUIPMENT_SLOTS.has(slot)) available.set(id, (available.get(id) ?? 0) - 1);
        if (effectiveItemLevelReq(item) > level) fail('equipment-level-gate', path);
    }

    const ids = Array.isArray(c.equippedJutsuIds) ? c.equippedJutsuIds : [], activeLoadoutLimit = maxLoadout(c);
    if (ids.length > activeLoadoutLimit || new Set(ids).size !== ids.length) fail('loadout-cap-or-duplicate', 'character.equippedJutsuIds');
    const mastery = new Map<string, Row>();
    for (const raw of Array.isArray(c.jutsuMastery) ? c.jutsuMastery : []) {
        const row = record(raw), id = typeof row.jutsuId === 'string' ? row.jutsuId : '';
        if (!id || mastery.has(id)) fail('mastery-identity', 'character.jutsuMastery');
        if (!whole(row.level) || row.level > jutsuLevelCapForLevel(level)
            || row.level > (options.expectedMasteryCeiling ?? Infinity)) fail('mastery-rank-cap', `character.jutsuMastery.${id}`);
        if (row.xp !== undefined && !whole(row.xp)) fail('mastery-xp', `character.jutsuMastery.${id}.xp`);
        mastery.set(id, row);
    }
    const elements = Array.isArray(c.elements) ? c.elements : [], natureLimit = level < 2 ? 0 : level < 20 ? 1 : 2;
    if (elements.length > natureLimit) acquisitionWarnings.push({ code: 'current-ui-nature-cardinality', path: 'character.elements' });
    for (const raw of ids) {
        const id = typeof raw === 'string' ? raw : '', path = `character.equippedJutsuIds.${id}`, jutsu = JUTSU_CATALOG[id];
        if (!mastery.has(id)) fail('jutsu-learned', path);
        // These benchmark fixtures claim built-in Academy moves; authored/admin
        // moves require a separate provenance fixture instead of a guessed kit.
        if (!jutsu) { fail('jutsu-source', path); continue; }
        if (!characterMayUseJutsu(c, save, jutsu)) fail('jutsu-access', path);
        if (jutsu.element && jutsu.element !== 'None' && !elements.includes(jutsu.element))
            acquisitionWarnings.push({ code: 'current-ui-nature-access', path });
    }
    const equippedBloodlineId = typeof c.equippedBloodlineId === 'string' ? c.equippedBloodlineId : '';
    const saved = (Array.isArray(save.savedBloodlines) ? save.savedBloodlines : []).map(record);
    const activeBloodline = saved.find(b => b.id === equippedBloodlineId);
    if (equippedBloodlineId && !carriedBloodlines(c, save).some(b => b.id === equippedBloodlineId)) fail('bloodline-owned', 'character.equippedBloodlineId');
    if (activeBloodline && !['B Rank', 'A Rank', 'S Rank'].includes(String(activeBloodline.rank))) fail('bloodline-rank', 'savedBloodlines.rank');
    if (options.expectedBloodlineRank && activeBloodline?.rank !== options.expectedBloodlineRank) fail('bloodline-expected-rank', 'savedBloodlines.rank');
    const expectedBloodlineMult = deriveBloodlineMultiplier(c.equippedBloodlineId, save.savedBloodlines);
    const hydrated = hydrateCharacterFromSave(c, {}, save, null);
    const sealedIds = (Array.isArray(hydrated.jutsu) ? hydrated.jutsu : []).map(raw => record(raw).id);
    if (ids.some(id => !sealedIds.includes(id))) fail('loadout-source-seal', 'character.equippedJutsuIds');
    if (hydrated.bloodlineMult !== expectedBloodlineMult) fail('bloodline-derived-multiplier', 'character.bloodlineMult');
    return { legal: failures.length === 0, level, failures, acquisitionWarnings, allocated, statCap, activeLoadoutLimit, natureLimit,
        bloodlineRank: activeBloodline?.rank ?? null, derivedBloodlineMult: hydrated.bloodlineMult, derivedArmorRawDR: hydrated.armorRawDR,
        pools, sealedJutsuCount: sealedIds.length };
}

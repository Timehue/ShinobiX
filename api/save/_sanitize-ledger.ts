import { STAT_CAP_FIELDS, statCapForLevel } from '../combat-core/formulas.js';
import { AURA_SPHERE_ITEM_ID } from '../pvp/_multipliers.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { FORGED_ITEM_ID } from './_forged-items.js';
import { meetsItemLevelReq } from '../../shared/item-level-gate.js';
import {
    ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS,
    SERVER_PAYOUT_CHARACTER_FIELDS,
    STRICT_SERVER_LEDGER_CHARACTER_FIELDS,
    SERVER_LEDGER_TOPLEVEL_FIELDS,
    SHARED_ADMIN_CONTENT_FIELDS,
} from './_state-ownership.js';
import { earnedStatPoints, earnedForLevel } from '../_xp-engine.js';
import { setSafeRecordValue } from '../_utils.js';
import { WORLD_GEO_VERSION } from '../../shared/sector-geo.js';

// ─── Save sanitization ────────────────────────────────────────────────────────
// Applied to every non-admin player save to prevent client-side economy cheating.
// Caps per-save *gains* rather than imposing hard ceilings, so legitimate large
// values (high-level players with lots of ryo) are preserved while exploit spikes
// (editing localStorage / fetch body) are clamped.

// Ordinary player saves may spend stored balances, but never originate gains.
// Every positive grant must be committed by an authenticated domain endpoint.
// CURRENCY_CAPS (all-zero gain caps) and SERVER_OWNED_CLAN_POINT_FIELDS now
// derive from the ownership manifest ('currency-zero-gain' / 'clan-points-char').
const LEVEL_CAP = 100;

const MAX_PROFESSION_RANK = 10;

// Healer uses 1.5× the baseline. Cumulative threshold to enter each rank,
// idx 1..10. Used to clamp client-reported rank against client-reported XP.
const PROFESSION_XP_BASELINE_THRESHOLDS = [0, 100, 350, 850, 1850, 3850, 7350, 12850, 20850, 32850];

const PROFESSION_XP_HEALER_THRESHOLDS = PROFESSION_XP_BASELINE_THRESHOLDS.map(v => Math.floor(v * 1.5));

function rankFromXp(profession: unknown, xp: number): number {
    const t = profession === 'healer' ? PROFESSION_XP_HEALER_THRESHOLDS : PROFESSION_XP_BASELINE_THRESHOLDS;
    let rank = 1;
    for (let i = 1; i <= MAX_PROFESSION_RANK; i += 1) {
        if (xp >= t[i]) rank = Math.min(MAX_PROFESSION_RANK, i + 1);
    }
    return Math.min(MAX_PROFESSION_RANK, rank);
}

// Server-side hospital downtime — clients can't skip it by editing localStorage.
const HOSPITAL_DURATION_MS = 60_000;

// Grace window after a server-authoritative discharge (api/player/heal.ts stamps
// character.lastDischargeAt on every checkout/heal-discharge). Within this window
// a client save that STILL asserts hospitalized:true is treated as a stale,
// pre-discharge write racing the discharge — and is ignored rather than
// re-admitting the just-released player with a fresh 60s timer. Without this,
// paying the discharge fee appeared not to work: the discharge landed, then an
// in-flight `hospitalized:true` autosave re-hospitalized the player (and reset
// the timer), so only waiting out the free timer ever reliably released them.
// Kept short so a genuine fresh KO seconds after leaving the hospital (which can
// only happen after navigating into and losing another fight — far longer than
// this) is still hospitalized normally.
const DISCHARGE_GRACE_MS = 12_000;

// ── Vitals gain cap (see the block in sanitizeCharacterSave) ─────────────
// Seconds of regen granted on top of the elapsed time since the stored
// `_saveAt`: covers clock / round-trip slack and the small client-only
// stamina grants (sector "Recover" +10..19, creator-event staminaReward).
const VITALS_GAIN_GRACE_SEC = 60;

type VitalKey = 'hp' | 'chakra' | 'stamina';

const VITAL_KEYS: ReadonlyArray<readonly [VitalKey, 'maxHp' | 'maxChakra' | 'maxStamina']> = [
    ['hp', 'maxHp'], ['chakra', 'maxChakra'], ['stamina', 'maxStamina'],
];

// Consumables the CLIENT applies itself (shinobij.client/src/screens/
// Inventory.tsx) — a pill removed from the inventory in the same save justifies
// exactly this much of a vitals rise. Keep the amounts in lock-step with that
// screen.
const CLIENT_CONSUMABLE_VITAL_CREDITS: Readonly<Record<string, { vital: VitalKey; amount: number }>> = {
    'Soldier Pill': { vital: 'stamina', amount: 25 },
    'Chakra Pill': { vital: 'chakra', amount: 25 },
};

/** Count of `itemId` across both inventory stores (`inventory[]` strings and
 *  `itemStacks[{itemId,count}]`), tolerant of the raw client shape. */
function countOwnedItem(character: Record<string, unknown>, itemId: string): number {
    let n = 0;
    if (Array.isArray(character.inventory)) {
        for (const entry of character.inventory as unknown[]) if (entry === itemId) n += 1;
    }
    if (Array.isArray(character.itemStacks)) {
        for (const stack of character.itemStacks as unknown[]) {
            if (!stack || typeof stack !== 'object') continue;
            const s = stack as Record<string, unknown>;
            if (s.itemId === itemId) n += Math.max(0, Math.floor(Number(s.count) || 0));
        }
    }
    return n;
}

// Baseline used to clamp a brand-new account's FIRST save. Without this, a
// fresh registration could submit a character at level 100 / millions of ryo /
// maxed stats because there's no `existing` baseline to diff against.
const FIRST_SAVE_BASELINE_CHARACTER: Record<string, unknown> = {
    level: 1,
    ryo: 100,
    xp: 0,
    stats: {
        strength: 10, speed: 10, intelligence: 10, willpower: 10,
        bukijutsuOffense: 10, bukijutsuDefense: 10,
        taijutsuOffense: 10, taijutsuDefense: 10,
        genjutsuOffense: 10, genjutsuDefense: 10,
        ninjutsuOffense: 10, ninjutsuDefense: 10,
    },
    unspentStats: 20,
    honorSeals: 0, fateShards: 0, boneCharms: 0, auraStones: 0,
    auraDust: 0, mythicSeals: 0,
    hospitalized: false, hospitalizedUntil: 0,
    // Profession progression — a fresh account must start at rank 1 with 0
    // XP. Without these baseline zeros, the cappedProfXp delta-against-existing
    // logic would let a brand-new save submit 5000 prof XP at registration
    // time, putting the player at rank ~4 from the gate.
    professionXp: 0, professionRank: 1,
    // Banked ryo and lifetime / leaderboard counters — first save can't
    // start with these populated.
    bankRyo: 0,
    totalPvpKills: 0, totalAiKills: 0, totalVillageRaids: 0,
    warsWon: 0, warMvpCount: 0, lifetimeWarDamage: 0,
    monthlyPvpKills: 0, dailyAiKills: 0,
    villageMerit: 0,
    inventory: ['rustfang-kunai', 'shinobi-vest'], itemStacks: [], jutsuMastery: [], pets: [], savedBloodlines: [], tileCards: [],
    equipment: {},
};

// STRICT_SERVER_LEDGER_CHARACTER_FIELDS / ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS /
// SERVER_PAYOUT_CHARACTER_FIELDS / SERVER_LEDGER_TOPLEVEL_FIELDS now derive from
// the ownership manifest (./_state-ownership.ts) — per-field rationale (patreon
// webhook-only, weaponElements core-endpoint-only, …) lives on the entries there.

const EQUIPMENT_SLOTS = new Set([
    // 'relic' holds story keepsakes/trinkets. It exists so they stop competing
    // with the Aura Sphere for 'aura'. A slot missing from THIS set is silently
    // stripped from equipment on every save write, so a new slot must be added
    // here as well as to the client's EquipmentSlot union.
    'aura', 'relic', 'hand', 'gloves', 'body', 'waist', 'legs', 'feet', 'head',
    'item', 'item1', 'item2', 'item3', 'thrown', 'potion',
    'weapon', 'armor', 'accessory',
]);

const REFERENCE_EQUIPMENT_SLOTS = new Set(['item', 'item1', 'item2', 'item3', 'thrown', 'potion']);

const ALLOCATABLE_STAT_FIELDS = new Set<string>(STAT_CAP_FIELDS);

const STARTER_BLOODLINE_JUTSU_IDS: Record<string, readonly string[]> = {
    'Ashen Eyes': ['ashen-eyes-blood-gaze', 'ashen-eyes-crimson-hall', 'ashen-eyes-hematoma-veil', 'ashen-eyes-vein-mirror'],
    'Inferno Cataclysm': ['inferno-cataclysm-crater-lance', 'inferno-cataclysm-lava-burst', 'inferno-cataclysm-molten-rain', 'inferno-cataclysm-obsidian-afterglow'],
    'Shadow Lotus': ['shadow-lotus-black-petal-guard', 'shadow-lotus-eclipse-wire', 'shadow-lotus-night-petal', 'shadow-lotus-umbra-senbon'],
    'Iron Fang': ['iron-fang-anvil-breath', 'iron-fang-ferrous-crash', 'iron-fang-magnet-knuckle', 'iron-fang-steel-maw'],
};

function strictRawSaveLedgerEnabled(): boolean {
    // This wider cutover is deliberately opt-in until every remaining legacy
    // progression writer and the forged-item backfill have been certified.
    // High-impact inventory/equipment minting is closed independently below.
    return process.env.STRICT_RAW_SAVE_LEDGER === '1';
}

function starterJutsuIdsForBloodline(raw: unknown): readonly string[] {
    const name = raw === 'Blue Blade Eyes' ? 'Ashen Eyes' : String(raw ?? '');
    return STARTER_BLOODLINE_JUTSU_IDS[name] ?? [];
}

function canonicalEquipmentSlot(slot: string): string {
    if (slot === 'weapon') return 'hand';
    if (slot === 'armor') return 'body';
    if (slot === 'accessory') return 'aura';
    if (slot === 'item') return 'item1';
    return slot;
}

function copyStoredField(target: Record<string, unknown>, stored: Record<string, unknown>, field: string): void {
    if (Object.prototype.hasOwnProperty.call(stored, field)) target[field] = stored[field];
    else delete target[field];
}

function addOwnedCount(counts: Map<string, number>, rawId: unknown, amount = 1): void {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id || amount <= 0) return;
    counts.set(id, (counts.get(id) ?? 0) + Math.floor(amount));
}

/**
 * Equipment validation that runs on EVERY save write, strict flag or not.
 *
 * Outside STRICT_RAW_SAVE_LEDGER the equipment map used to pass through
 * untouched, so a tampered save could equip built-in ids it never obtained
 * (full Mythic armor → 0.48 raw DR honored by every server fight). This is the
 * structural half of the strict branch made unconditional: slot names
 * whitelisted, duplicate ids and canonical-slot aliases collapsed, and every
 * equipped id required to exist somewhere the player already holds it — the
 * STORED backpack/equipment (server-granted items + already-equipped gear, so
 * nothing legitimate is ever unequipped). Incoming inventory is intentionally
 * not evidence of ownership: accepting it made a receiptless buy → equip POST
 * a combat-power mint even though the later inventory sanitizer dropped it.
 *
 * Presence, not count-consumption: the compatibility path still permits
 * representation changes for already-owned items. Strict mode replaces this
 * with the full count-consuming version in enforceRawSaveLedgerBoundary.
 *
 * Slot-kind: a BUILT-IN item may only occupy a slot its definition fits
 * (armor DR in _multipliers.ts sums per SLOT KEY, so a body plate parked in
 * `head` would stack DR the item never earned). Placements already present on
 * the stored save are grandfathered (same id, same slot) so no live loadout
 * changes; ids without a resolvable built-in definition (admin/creator items —
 * the admin catalog is async and this sanitizer is sync) skip the kind check,
 * combat's own resolution handles those.
 */
function slotAcceptsItemKind(equipSlot: string, itemSlot: string): boolean {
    const want = canonicalEquipmentSlot(equipSlot);
    const have = canonicalEquipmentSlot(String(itemSlot));
    if (want === have) return true;
    // The three combat-item slots all hold slot-'item' consumables.
    return (want === 'item2' || want === 'item3') && have === 'item1';
}

function enforceEquipmentOwnership(char: Record<string, unknown>, stored: Record<string, unknown>): void {
    const owned = new Set<string>();
    for (const id of Array.isArray(stored.inventory) ? stored.inventory : []) {
        if (typeof id === 'string' && id.trim()) owned.add(id.trim());
    }
    if (Array.isArray(stored.itemStacks)) {
        for (const raw of stored.itemStacks as Array<Record<string, unknown>>) {
            const itemId = raw && typeof raw === 'object' && typeof raw.itemId === 'string' ? raw.itemId.trim() : '';
            if (itemId && Math.floor(Number(raw.count) || 0) > 0) owned.add(itemId);
        }
    }
    const storedEquipment = stored.equipment && typeof stored.equipment === 'object'
        ? stored.equipment as Record<string, unknown>
        : {};
    for (const id of Object.values(storedEquipment)) {
        if (typeof id === 'string' && id.trim()) owned.add(id.trim());
    }
    const requestedEquipment = char.equipment && typeof char.equipment === 'object'
        ? char.equipment as Record<string, unknown>
        : {};
    const equipLevel = Math.max(1, Math.floor(Number(stored.level) || 1));
    const equipment: Record<string, string> = {};
    const equippedIds = new Set<string>();
    const occupiedCanonicalSlots = new Set<string>();
    for (const [slot, rawId] of Object.entries(requestedEquipment)) {
        const id = typeof rawId === 'string' ? rawId.trim() : '';
        const canonicalSlot = canonicalEquipmentSlot(slot);
        if (!EQUIPMENT_SLOTS.has(slot) || !id || equippedIds.has(id) || occupiedCanonicalSlots.has(canonicalSlot)) continue;
        if (!owned.has(id)) continue;
        // The aura slot belongs to the Aura Sphere ALONE — it is the one
        // forever-improving keystone, and its perks key off being equipped. Seven
        // keepsakes used to share this slot and silently evicted it; they now live
        // on `relic`. Deliberately NOT grandfathered: a save still holding a
        // keepsake here from before the relic slot existed gets it unequipped on
        // the next write (the item stays in the backpack), which self-heals the
        // slot instead of leaving the sphere permanently locked out.
        if (canonicalSlot === 'aura' && id !== AURA_SPHERE_ITEM_ID) continue;
        const grandfathered = String(storedEquipment[slot] ?? '') === id;
        const builtin = ITEM_CATALOG[id];
        if (!grandfathered && builtin && !slotAcceptsItemKind(slot, builtin.slot)) continue;
        // Gear level ladder (shared/item-level-gate.ts). Applied ONLY to a NEWLY
        // equipped piece: anything already in that slot is grandfathered, so a
        // ladder change can never strip a player's gear mid-session — it just
        // stops them equipping above their rank from here on.
        //
        // The level read is `stored.level`, not `char.level`: this runs before
        // applyDerivedLevel recomputes the level from the stat ledger, so the
        // incoming value is still client-supplied and untrusted. Stored is
        // server-owned and rise-only, so the gate is at most one save stale —
        // a player who just levelled equips on their next autosave. Using the
        // real level (rather than the ledger) also keeps the exam holds
        // meaningful: being frozen at 20 by the Genin exam should gate gear too.
        if (!grandfathered) {
            const gated = builtin ?? (FORGED_ITEM_ID.test(id) ? { rarity: 'named' as const } : null);
            if (gated && !meetsItemLevelReq(gated, equipLevel)) continue;
        }
        equipment[slot] = id;
        equippedIds.add(id);
        occupiedCanonicalSlots.add(canonicalSlot);
    }
    char.equipment = equipment;
}

function enforceRawSaveLedgerBoundary(
    char: Record<string, unknown>,
    stored: Record<string, unknown>,
    firstSave: boolean,
    requested: Record<string, unknown>,
): void {
    const requestedStats = requested.stats && typeof requested.stats === 'object'
        ? requested.stats as Record<string, unknown>
        : null;
    const requestedUnspentStats = requested.unspentStats;
    for (const field of ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS) copyStoredField(char, stored, field);
    for (const field of SERVER_PAYOUT_CHARACTER_FIELDS) copyStoredField(char, stored, field);

    if (firstSave) {
        for (const field of STRICT_SERVER_LEDGER_CHARACTER_FIELDS) copyStoredField(char, stored, field);
        const starterMastery: Array<{ jutsuId: string; level: number; xp: number }> = [];
        const seenStarterJutsu = new Set<string>();
        const allowedStarterJutsu = new Set(starterJutsuIdsForBloodline(char.bloodline));
        if (Array.isArray(char.jutsuMastery)) {
            for (const raw of char.jutsuMastery as Array<Record<string, unknown>>) {
                const jutsuId = typeof raw?.jutsuId === 'string' ? raw.jutsuId.trim().toLowerCase() : '';
                if ((allowedStarterJutsu.size > 0 && !allowedStarterJutsu.has(jutsuId)) || seenStarterJutsu.has(jutsuId)) continue;
                seenStarterJutsu.add(jutsuId);
                starterMastery.push({ jutsuId, level: 1, xp: 0 });
            }
        }
        char.jutsuMastery = starterMastery;
        const requestedLoadout = Array.isArray(char.equippedJutsuIds) ? char.equippedJutsuIds : [];
        char.equippedJutsuIds = [...new Set(requestedLoadout
            .filter((id): id is string => typeof id === 'string' && seenStarterJutsu.has(id)))].slice(0, 3);
        char.inventory = structuredClone(FIRST_SAVE_BASELINE_CHARACTER.inventory);
        char.itemStacks = [];
        char.pets = [];
        char.equipment = {};
        delete char.activePetId;
        delete char.activePetId2v2;
        return;
    }

    if (!strictRawSaveLedgerEnabled()) {
        enforceEquipmentOwnership(char, stored);
        return;
    }
    for (const field of STRICT_SERVER_LEDGER_CHARACTER_FIELDS) copyStoredField(char, stored, field);

    const storedMastery = Array.isArray(stored.jutsuMastery) ? stored.jutsuMastery : [];
    char.jutsuMastery = storedMastery;
    const learnedJutsuIds = new Set((storedMastery as Array<Record<string, unknown>>)
        .map((entry) => String(entry?.jutsuId ?? '')).filter(Boolean));
    for (const id of Array.isArray(stored.equippedJutsuIds) ? stored.equippedJutsuIds : []) {
        if (typeof id === 'string' && id) learnedJutsuIds.add(id);
    }
    const requestedLoadout = Array.isArray(char.equippedJutsuIds)
        ? char.equippedJutsuIds
        : (Array.isArray(stored.equippedJutsuIds) ? stored.equippedJutsuIds : []);
    char.equippedJutsuIds = [...new Set(requestedLoadout
        .filter((id): id is string => typeof id === 'string' && learnedJutsuIds.has(id)))].slice(0, 15);

    const exStats = stored.stats && typeof stored.stats === 'object'
        ? stored.stats as Record<string, unknown>
        : {};
    let exUnspent = Math.max(0, Math.floor(Number(stored.unspentStats) || 0));
    // Complete the one-time XP-era -> stat-ledger migration inside the strict
    // boundary. The earlier sanitizer pass computes the same top-up, but this
    // function intentionally rebuilds stats/unspentStats from the stored
    // entitlement and would otherwise discard it before the latch could stick.
    if (stored.levelLedgerMigrated !== true) {
        const storedLevel = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(stored.level) || 1)));
        const earnedNow = earnedStatPoints({ ...stored, unspentStats: exUnspent });
        exUnspent += Math.max(0, earnedForLevel(storedLevel) - earnedNow);
        char.levelLedgerMigrated = true;
    }
    const requestedPool = Number(requestedUnspentStats);
    let allocationBudget = Number.isSafeInteger(requestedPool) && requestedPool >= 0
        ? Math.min(exUnspent, Math.max(0, exUnspent - requestedPool))
        : 0;
    const nextStats: Record<string, number> = {};
    const cap = statCapForLevel(Number(stored.level) || 1);
    for (const [key, rawStored] of Object.entries(exStats)) {
        const current = Math.max(0, Math.floor(Number(rawStored) || 0));
        if (!ALLOCATABLE_STAT_FIELDS.has(key)) {
            setSafeRecordValue(nextStats, key, current);
            continue;
        }
        const desiredRaw = requestedStats?.[key];
        const desired = Number.isFinite(Number(desiredRaw))
            ? Math.max(current, Math.min(cap, Math.floor(Number(desiredRaw))))
            : current;
        const applied = Math.min(allocationBudget, Math.max(0, desired - current));
        setSafeRecordValue(nextStats, key, current + applied);
        allocationBudget -= applied;
    }
    const allocated = Object.entries(nextStats).reduce((sum, [key, value]) => {
        const current = Math.max(0, Math.floor(Number(exStats[key]) || 0));
        return sum + Math.max(0, value - current);
    }, 0);
    char.stats = nextStats;
    char.unspentStats = exUnspent - allocated;

    const available = new Map<string, number>();
    for (const id of Array.isArray(stored.inventory) ? stored.inventory : []) addOwnedCount(available, id);
    if (Array.isArray(stored.itemStacks)) {
        for (const raw of stored.itemStacks as Array<Record<string, unknown>>) {
            if (raw && typeof raw === 'object') addOwnedCount(available, raw.itemId, Math.max(0, Math.floor(Number(raw.count) || 0)));
        }
    }
    const storedEquipment = stored.equipment && typeof stored.equipment === 'object'
        ? stored.equipment as Record<string, unknown>
        : {};
    const countedStoredSlots = new Set<string>();
    for (const [slot, id] of Object.entries(storedEquipment)) {
        if (!EQUIPMENT_SLOTS.has(slot) || REFERENCE_EQUIPMENT_SLOTS.has(slot)) continue;
        const canonicalSlot = canonicalEquipmentSlot(slot);
        if (countedStoredSlots.has(canonicalSlot)) continue;
        countedStoredSlots.add(canonicalSlot);
        addOwnedCount(available, id);
    }

    const remaining = new Map(available);
    const proposedInventory = Array.isArray(requested.inventory)
        ? requested.inventory
        : (Array.isArray(stored.inventory) ? stored.inventory : []);
    const inventory: string[] = [];
    for (const raw of proposedInventory) {
        const id = typeof raw === 'string' ? raw.trim() : '';
        const left = remaining.get(id) ?? 0;
        if (!id || left <= 0) continue;
        inventory.push(id);
        remaining.set(id, left - 1);
    }
    char.inventory = inventory;

    const proposedStacks = Array.isArray(requested.itemStacks)
        ? requested.itemStacks as Array<Record<string, unknown>>
        : (Array.isArray(stored.itemStacks) ? stored.itemStacks as Array<Record<string, unknown>> : []);
    const stacks: Array<{ itemId: string; count: number }> = [];
    const seenStackIds = new Set<string>();
    for (const raw of proposedStacks) {
        if (!raw || typeof raw !== 'object') continue;
        const itemId = typeof raw.itemId === 'string' ? raw.itemId.trim() : '';
        if (!itemId || seenStackIds.has(itemId)) continue;
        const count = Math.min(Math.max(0, Math.floor(Number(raw.count) || 0)), remaining.get(itemId) ?? 0);
        if (count <= 0) continue;
        seenStackIds.add(itemId);
        stacks.push({ itemId, count });
        remaining.set(itemId, (remaining.get(itemId) ?? 0) - count);
    }
    char.itemStacks = stacks;
    const retainedBackpackIds = new Set([...inventory, ...stacks.map((stack) => stack.itemId)]);

    const pets = Array.isArray(stored.pets) ? stored.pets : [];
    char.pets = pets;
    const petIds = new Set((pets as Array<Record<string, unknown>>).map((pet) => String(pet?.id ?? '')).filter(Boolean));
    for (const field of ['activePetId', 'activePetId2v2'] as const) {
        const requested = typeof char[field] === 'string' ? char[field] as string : '';
        if (requested && petIds.has(requested)) char[field] = requested;
        else copyStoredField(char, stored, field);
    }

    const requestedEquipment = requested.equipment && typeof requested.equipment === 'object'
        ? requested.equipment as Record<string, unknown>
        : storedEquipment;
    const equipment: Record<string, string> = {};
    const equippedIds = new Set<string>();
    const occupiedCanonicalSlots = new Set<string>();
    for (const [slot, rawId] of Object.entries(requestedEquipment)) {
        const id = typeof rawId === 'string' ? rawId.trim() : '';
        const canonicalSlot = canonicalEquipmentSlot(slot);
        if (!EQUIPMENT_SLOTS.has(slot) || !id || equippedIds.has(id) || occupiedCanonicalSlots.has(canonicalSlot)) continue;
        if (REFERENCE_EQUIPMENT_SLOTS.has(slot)) {
            if (!retainedBackpackIds.has(id)) continue;
        } else {
            const left = remaining.get(id) ?? 0;
            if (left <= 0) continue;
            remaining.set(id, left - 1);
        }
        equipment[slot] = id;
        equippedIds.add(id);
        occupiedCanonicalSlots.add(canonicalSlot);
    }
    char.equipment = equipment;
}

/**
 * Give every jutsu in the player's OWN validated bloodlines a level-1 mastery
 * row if it doesn't have one.
 *
 * Mastery rows are server-owned: a generic save can never ADD one (see the
 * jutsuMastery block above, which rebuilds the list from the stored rows). That
 * is correct for trained power, but it silently broke the bloodline forge:
 * BloodlineMaker grants level-1 mastery for the new bloodline's jutsu
 * client-side, the save discards those rows, and after a refresh the jutsu the
 * player just paid to forge are missing from the loadout picker — which reads
 * as "my bloodline didn't load". The player could recover only by running the
 * free 0→1 training on each jutsu individually.
 *
 * Granting them here is safe because it hands out nothing the player could not
 * already get for free: `api/training/_jutsu-ryo.ts` makes the 0→1 step free and
 * immediate, and these are the player's own bloodline jutsu, so the bloodline
 * gate (api/pvp/_bloodline-gate.ts) admits them anyway. It cannot be forged into
 * power either — a bloodline id with no pending forge entitlement is discarded
 * by normalizeBloodlineArray before this runs, the per-jutsu numbers are clamped
 * and point-budgeted there, and this only ever writes level 1 / xp 0 (never
 * touching an existing row's trained progress).
 */
function grantOwnedBloodlineJutsuMastery(char: Record<string, unknown>, savedBloodlines: unknown): void {
    if (!Array.isArray(savedBloodlines) || savedBloodlines.length === 0) return;
    const mastery = Array.isArray(char.jutsuMastery)
        ? [...(char.jutsuMastery as Array<Record<string, unknown>>)]
        : [];
    const known = new Set(mastery.map((row) => String(row?.jutsuId ?? '')));
    for (const bloodline of savedBloodlines) {
        if (!bloodline || typeof bloodline !== 'object') continue;
        const jutsus = (bloodline as Record<string, unknown>).jutsus;
        if (!Array.isArray(jutsus)) continue;
        for (const jutsu of jutsus) {
            if (!jutsu || typeof jutsu !== 'object') continue;
            const jutsuId = String((jutsu as Record<string, unknown>).id ?? '').trim();
            if (!jutsuId || known.has(jutsuId) || mastery.length >= 200) continue;
            known.add(jutsuId);
            mastery.push({ jutsuId, level: 1, xp: 0 });
        }
    }
    if (mastery.length !== (Array.isArray(char.jutsuMastery) ? char.jutsuMastery.length : 0)) {
        char.jutsuMastery = mastery;
    }
}

/** Top-level authority applies even to partial saves with no character blob. */
function preserveServerTopLevelFields(
    out: Record<string, unknown>,
    existing: Record<string, unknown> | null,
    adminContentSlot = false,
): void {
    for (const field of SERVER_LEDGER_TOPLEVEL_FIELDS) {
        if (adminContentSlot && SHARED_ADMIN_CONTENT_FIELDS.includes(field)) continue;
        if (existing && Object.prototype.hasOwnProperty.call(existing, field)) out[field] = existing[field];
        else delete out[field];
    }
    if (out.currentSector === undefined) out.currentSector = 40;
    // Protect the migration stamp on partial saves too: rewinding it would
    // remap a protected sector on the next owner read.
    out.worldGeoV = existing && Object.prototype.hasOwnProperty.call(existing, 'worldGeoV')
        ? existing.worldGeoV
        : WORLD_GEO_VERSION;
}

export { FIRST_SAVE_BASELINE_CHARACTER, preserveServerTopLevelFields, enforceRawSaveLedgerBoundary, grantOwnedBloodlineJutsuMastery, strictRawSaveLedgerEnabled, rankFromXp, LEVEL_CAP, VITALS_GAIN_GRACE_SEC, CLIENT_CONSUMABLE_VITAL_CREDITS, countOwnedItem, VITAL_KEYS, copyStoredField, DISCHARGE_GRACE_MS, HOSPITAL_DURATION_MS };
export type { VitalKey };

import { safeLogValue } from '../_safe-log.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { WORLD_GEO_VERSION } from '../../shared/sector-geo.js';
import { petStatCeil } from '../_pet-stat-ceil.js';
import { enforceBloodlineBudget, bloodlinePoints, type RawJutsu } from '../_jutsu-points.js';
import { sanitizeJutsuVisualEffect } from '../_jutsu-visuals.js';
import { normalizeMasteryFocus } from '../../shared/activity-spine.js';
import { PROGRESSION_EXAM_HOLDS } from '../../shared/progression-holds.js';
import { budgetItemBonuses } from '../_item-budget.js';
import { ITEM_CATALOG } from '../pvp/_item-catalog.js';
import { AURA_SPHERE_ITEM_ID } from '../pvp/_multipliers.js';
import { safeName, mergePreservingImages, cors, parseJsonBody, setSafeRecordValue } from '../_utils.js';
import { verifyPlayerPassword } from '../player-auth.js';
import { authedPlayerOrAdmin, isAdmin, isFullAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { validateClanSaveWrite } from '../_clan-save-validate.js';
import { sanitizeUserText, isCleanText, isAllowedCustomTitle, TEXT_LIMITS } from '../_text-moderation.js';
import { isKnownEarnedTitle, isServerCreditedTitle, normalizeTitleKey, appendCustomTitleLog, TITLE_STYLE_IDS, TITLE_ICON_SET } from '../_titles-registry.js';
import { legacyEnabled } from '../_legacy-track.js';
import { KNOWN_TAG_NAMES, canonicalTagName } from '../pvp/_tags.js';
import { combatMissionByKey } from '../missions/_mission-catalog.js';
import {
    preserveEntitledStringArray,
    preserveOwnedItems,
} from './_entitlement-guard.js';
import { parseBaseSaveVersion, saveVersionTelemetryKey, isVersionlessPlayerSave, matchesStoredSaveVersion, nextSaveVersion } from './_save-version.js';
import {
    PUBLIC_CHAR_FIELDS,
    PUBLIC_TOPLEVEL_FIELDS,
    PUBLIC_COMBAT_TOPLEVEL_FIELDS,
    SHARED_ADMIN_CONTENT_FIELDS,
    COMBAT_STRIP_CHAR_FIELDS,
    COMBAT_STRIP_TOPLEVEL_FIELDS,
    STRICT_SERVER_LEDGER_CHARACTER_FIELDS,
    ALWAYS_SERVER_LEDGER_CHARACTER_FIELDS,
    SERVER_PAYOUT_CHARACTER_FIELDS,
    SERVER_LEDGER_TOPLEVEL_FIELDS,
    SERVER_OWNED_CLAN_POINT_FIELDS,
    CURRENCY_CAPS,
    LIFETIME_COUNTERS,
    SERVER_MIRRORED_CHARACTER_FIELDS,
    PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS,
    SERVER_ARRAY_LEDGER_CHARACTER_FIELDS,
    BOOLEAN_LATCH_CHARACTER_FIELDS,
    DAILY_CLAIM_DATE_FIELDS,
    MONOTONIC_DATE_CHARACTER_FIELDS,
    FORBIDDEN_CREATOR_CHARACTER_FIELDS,
    PET_IDENTITY_FIELDS,
} from './_state-ownership.js';
import { shouldWriteRegistry } from './_registry-throttle.js';
import { activeBreedingParentIds } from '../pet/_pet-busy.js';
import { CARD_COLLECTION_CAP, trimChronicleCardsToPackableCap } from '../card-clash/_collection-cap.js';
import {
    CHRONICLE_PROGRESSION_CARD_IDS,
    isChronicleProgressionCardId,
} from '../card-clash/_progression-cards.js';
import { REGISTRY_KEY, buildPublicPlayerIndexEntry } from '../player/_public-index.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { mirrorSlotContent } from '../_content-store.js';
import { syncCurrencyLedger } from '../_currency-ledger.js';
import { captureServerProductEvent } from '../_product-analytics.js';
import { settleSaveRecordForRead } from '../_elapsed-state.js';
import { applyCanonicalFirstSave } from './_first-save-baseline.js';
import { preserveStatPointEntitlement } from './_stat-entitlement.js';
import { applyDerivedLevel, earnedForLevel, earnedStatPoints } from '../_xp-engine.js';
import { parseBloodlineForgeRank, readPendingBloodlineForges } from '../bloodlines/_forge.js';
import { STAT_CAP_FIELDS, statCapForLevel } from '../combat-core/formulas.js';
import { activeCarriedPetIds, maxLoadout, maxPets, isPatreonSubscriber, isPresetAvatar, isOwnAvatarReference } from '../_entitlements.js';
import {
    CHRONICLE_RULES_VERSION,
    CHRONICLE_STARTER_GRANT_IDS,
    countChronicleCardsWithStarter,
    validateDeckIds,
} from '../../shared/chronicle-duel.js';

/** Coarse authenticated ingress budget for ordinary save POSTs. This is
 * deliberately six times the fastest successful-save cadence (20/minute): it
 * absorbs conflict recovery, reset-pending retries, and short multi-tab bursts
 * while bounding requests that would otherwise enter the per-save lock. */
export const PLAYER_SAVE_ATTEMPT_LIMIT = 120;
export const PLAYER_SAVE_ATTEMPT_WINDOW_MS = 60_000;

// Non-owner reads use an explicit ALLOWLIST at BOTH the root and character
// level (see buildPublicSaveDTO). A blacklist is not the boundary anymore: the
// old projection spread the entire top-level save into the response and only
// allowlisted `character`, so every root-level field (savedBloodlines,
// creatorJutsus/Items/Ais/…, activeTraining, missionProgress, currentSector,
// triggeredEvents, _saveVersion, and any field added later) leaked to any
// logged-in player. The allowlist below is private-by-default: a newly added
// top-level or character field is NOT public unless it is explicitly listed.

// The public / combat-public field allowlists now derive from the canonical
// ownership manifest (./_state-ownership.ts — boundaries 'public-char' and
// 'public-combat-toplevel'). The rationale comments moved with them.

// ── Shared admin-authored game content ──────────────────────────────────────
// The `admin1` / `admin2` save slots double as the store for admin-authored
// GLOBAL game content — custom jutsu, items, AIs, events, missions, raids,
// Chronicle cards, pet kits, and the VN/event-gate configs. Every client pulls
// those two slots on login (App.tsx pullSharedAdminContent) to hydrate content
// that is meant to be visible to everyone.
//
// The private-by-default DTO above correctly strips all root fields from a
// foreign read — which silently broke that hydration for ordinary players: they
// got `{ character }` and no content at all. (It looked fine in testing because
// anyone who had logged in before the allowlist landed still had a locally
// merged copy persisted in their own save.)
//
// So: these specific root fields, and ONLY from the two admin content slots,
// are public. They are authored game content, not player data. Everything else
// on those slots (the admin's own character, currencies, progress) stays behind
// the same allowlist as any other player.
const ADMIN_CONTENT_SLOTS = new Set<string>(['admin1', 'admin2']);
// SHARED_ADMIN_CONTENT_FIELDS: imported from the ownership manifest
// (boundary 'shared-admin-content').

/** True when `name` is one of the two admin slots that hold shared game content. */
export function isAdminContentSlot(name: string): boolean {
    return ADMIN_CONTENT_SLOTS.has(name);
}

export function isReleaseSafeCreatorEvent(raw: unknown): boolean {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const event = raw as Record<string, unknown>;
    if (event.eventKind !== 'visualNovel' || event.kageFinale === true) return false;
    for (const field of ['xpReward', 'ryoReward', 'staminaReward']) {
        if (Number(event[field] ?? 0) !== 0) return false;
    }
    if (event.currencyRewards && typeof event.currencyRewards === 'object') {
        if (Object.values(event.currencyRewards as Record<string, unknown>).some((value) => Number(value ?? 0) !== 0)) return false;
    }
    if (Array.isArray(event.vnPages)) {
        for (const page of event.vnPages as Array<Record<string, unknown>>) {
            if (Array.isArray(page?.choices) && (page.choices as Array<Record<string, unknown>>).some((choice) => choice?.battle)) return false;
        }
    }
    return true;
}

// Build the non-owner response: an explicit allowlist DTO. Nothing from the
// stored save reaches a foreign reader unless it is named here — no top-level
// spread, no internal metadata (_saveVersion / _saveAt), and future fields are
// private until deliberately added.
export function buildPublicSaveDTO(data: Record<string, unknown>, opts: { combat: boolean; sharedContent?: boolean }): Record<string, unknown> {
    const char = data.character as Record<string, unknown> | undefined;
    const projectedChar: Record<string, unknown> = {};
    if (char && typeof char === 'object') {
        for (const k of PUBLIC_CHAR_FIELDS) {
            if (k in char) projectedChar[k] = char[k];
        }
    }
    const out: Record<string, unknown> = { character: projectedChar };
    for (const k of PUBLIC_TOPLEVEL_FIELDS) {
        if (k in data) out[k] = data[k];
    }
    if (opts.combat) {
        for (const k of PUBLIC_COMBAT_TOPLEVEL_FIELDS) {
            if (k in data) out[k] = data[k];
        }
    }
    // Admin content slots only — see SHARED_ADMIN_CONTENT_FIELDS.
    if (opts.sharedContent) {
        for (const k of SHARED_ADMIN_CONTENT_FIELDS) {
            // Creator missions and raids currently have no authoritative
            // published-catalog settlement. Do not advertise claim/start
            // buttons that the server must reject or whose authored rewards it
            // ignores. Keep them editable on the owning admin slot.
            if (k === 'creatorMissions' || k === 'creatorRaids') continue;
            if (k in data) out[k] = data[k];
        }
        // Narrative-only events remain publishable. Any rewardful or
        // battle-bearing creator event stays admin-preview-only until it has a
        // receipt-backed settlement path.
        if (Array.isArray(out.creatorEvents)) out.creatorEvents = out.creatorEvents.filter(isReleaseSafeCreatorEvent);
        // A player-forged item is NEVER shared game content. One that reaches an
        // admin slot (see stripForgedItems) would otherwise be handed to every
        // client, which merges shared content into its own `creatorItems` and
        // persists it — that is exactly how one forged weapon ended up mirrored
        // into 88 unrelated saves. Filtering on the way OUT also neutralizes any
        // copy already stored on a slot, with no data migration.
        if (Array.isArray(out.creatorItems)) out.creatorItems = stripForgedItems(out.creatorItems);
    }
    return out;
}

/** Content admin is limited to the two explicit admin content save records. */
export function adminSaveTargetAllowed(targetName: string, fullAdmin: boolean, anyAdmin: boolean): boolean {
    if (fullAdmin) return true;
    return anyAdmin && (targetName === 'admin1' || targetName === 'admin2');
}

// Character-level fields stripped under ?combatOnly=1 — none of these affect
// combat resolution (only meta progression / cosmetic / lifetime counters).
// Whitelisting was considered but a blacklist is safer here since combat
// touches many character fields and a missed whitelist entry would silently
// break opponent rendering. Both strip lists derive from the ownership
// manifest (boundaries 'combat-strip-char' / 'combat-strip-toplevel').

// Exported for the ownership golden-master characterization tests only —
// the handler remains the sole runtime caller.
export function combatProjection(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...data };
    for (const f of COMBAT_STRIP_TOPLEVEL_FIELDS) delete out[f];
    const char = out.character as Record<string, unknown> | undefined;
    if (char && typeof char === 'object') {
        const trimmed = { ...char };
        for (const f of COMBAT_STRIP_CHAR_FIELDS) delete trimmed[f];
        out.character = trimmed;
    }
    return out;
}

// How long the cached player:registry `lastSeen` may drift before a save
// rewrites it even when no identity field changed. kv.hset re-serializes the
// entire registry row (one hot row holding every player) on each call — a
// full-row write + WAL image + row-lock contention point that every autosave
// (~1/3s per active player) otherwise hits. Refreshing at most once a minute
// keeps roster/UserHub "last seen" accurate within a minute (its display is
// "X ago" granularity, so the throttle is invisible) while cutting registry
// writes by ~20× for an actively-saving player.
const REGISTRY_REFRESH_MS = 60_000;

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

// Rolling 60-second gain windows. Anything above these caps is rejected with
// a 429. These are server-side rate limits independent of the per-save caps;
// they catch a stream of small but legitimate-looking saves that, in
// aggregate, are obviously farming.
const GAIN_WINDOW_MS = 60_000;
const MAX_RYO_PER_MINUTE = 5_000_000;
const MAX_STAT_PER_MINUTE = 1500; // any single stat
const MAX_XP_PER_MINUTE = 1_000_000;
// Per-minute caps for premium + power-material currencies. The per-save
// CURRENCY_CAPS above bound a SINGLE save; without a rolling window a tampered
// client autosaving every ~3s could mint the per-save cap repeatedly and bank an
// unbounded pile over a minute. Set generously (~10× the per-save cap) so no
// legit faucet trips them — this is anti-TAMPER, not a rarity nerf; the goal is
// only to block sustained minting. auraDust is extra-generous (events can grant
// >100/save, see the CURRENCY_CAPS note).
const MAX_CURRENCY_PER_MINUTE: Record<string, number> = {
    fateShards: 500,
    boneCharms: 500,
    auraStones: 500,
    auraDust: 2000,
    mythicSeals: 0,
    honorSeals: 2000,
    hollowShards: 2000,
};

type GainsWindow = { startedAt: number; ryo: number; stat: Record<string, number>; xp: number; currency: Record<string, number> };

async function readGainsWindow(name: string): Promise<GainsWindow | null> {
    try {
        return await kv.get<GainsWindow>(`ratelimit:save:${name}:gains`);
    } catch (e) {
        // best-effort — but log: a silent read failure resets the anti-farm
        // window to "fresh", quietly weakening the per-minute gain caps.
        console.error(`[save gains-window] read failed for ${name}:`, e);
        return null;
    }
}

async function writeGainsWindow(name: string, w: GainsWindow): Promise<void> {
    try {
        await kv.set(`ratelimit:save:${name}:gains`, w, { ex: Math.ceil(GAIN_WINDOW_MS / 1000) * 2 });
    } catch (e) {
        // best-effort — but log: dropping the window write degrades the anti-farm
        // limiter invisibly.
        console.error(`[save gains-window] write failed for ${name}:`, e);
    }
}

function freshWindow(): GainsWindow {
    return { startedAt: Date.now(), ryo: 0, stat: {}, xp: 0, currency: {} };
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

// Ids that ONLY the server can mint: api/craft/named.ts writes a forged piece
// into the player's top-level `creatorItems` as `named-<kind>-<uuid>`
// (api/craft/_named.ts buildNamedItem, kind = 'weapon' | 'armor').
//
// The uuid is accepted with OR without dashes. buildNamedItem strips them today
// (`randomUUID().replace(/-/g, '')`), but every forged item currently in the
// database predates that and carries the dashed form — matching only the
// stripped shape would protect none of the live gear.
export const FORGED_ITEM_ID = /^named-(weapon|armor)-[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * Drop every server-forged item from a `creatorItems` array.
 *
 * Forged gear is PERSONAL: `api/craft/named.ts` mints it into one player's own
 * array and its definition belongs nowhere else. The `Admin 1` / `Admin 2`
 * accounts are ordinary player saves that double as the shared-content store, so
 * a client that still held a personal `creatorItems` state when it saved as an
 * admin published that forged item to every player — the client merges shared
 * admin content into its own array and persists it. Admin content and forged
 * gear must therefore never mix.
 */
export function stripForgedItems(list: unknown): unknown[] {
    if (!Array.isArray(list)) return [];
    return list.filter((item) => {
        if (!item || typeof item !== 'object') return true;
        return !FORGED_ITEM_ID.test(String((item as Record<string, unknown>).id ?? ''));
    });
}

/**
 * Re-attach server-forged items the incoming save omits.
 *
 * `creatorItems` is normally replaced wholesale by the client's copy, which is
 * fine for the admin-content mirror that makes up the rest of the array. It is
 * NOT fine for a forged named weapon/armor: that definition exists nowhere else
 * (no ITEM_CATALOG entry, not on the admin slots), so a POST from a client that
 * had not yet seen the forge silently erased it while its id stayed in
 * `character.equipment` — leaving gear that resolves to nothing and is dropped
 * from every fight. The `_baseSaveVersion` guard rejects most such writes; this
 * closes the rest.
 *
 * Deliberately narrow: only ids matching the server-minted pattern are revived,
 * and only when absent from the incoming array. Everything else keeps
 * replace-semantics, so an admin-deleted item still disappears normally and the
 * array cannot grow without bound.
 */
export function preserveForgedItems(sanitized: unknown, stored: unknown, cap: number): unknown {
    if (!Array.isArray(sanitized) || !Array.isArray(stored)) return sanitized;
    const present = new Set(
        (sanitized as Array<Record<string, unknown>>)
            .map((item) => (item && typeof item === 'object' ? String(item.id ?? '') : ''))
            .filter(Boolean),
    );
    const missingForged = (stored as Array<Record<string, unknown>>).filter((item) => {
        if (!item || typeof item !== 'object') return false;
        const id = String(item.id ?? '');
        return FORGED_ITEM_ID.test(id) && !present.has(id);
    });
    if (missingForged.length === 0) return sanitized;
    // Forged pieces go first so the cap can never be what drops them.
    return [...missingForged, ...(sanitized as unknown[])].slice(0, cap);
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

export function sanitizeCharacterSave(
    incoming: Record<string, unknown>,
    existing: Record<string, unknown> | null,
    // True when the target is `save:admin1` / `save:admin2` — the player saves
    // that double as the shared-content store. Forged gear is stripped rather
    // than preserved there: it is personal, and anything on those slots is
    // published to every client. Defaults false, so ordinary player saves are
    // unaffected.
    opts: { adminContentSlot?: boolean } = {},
): Record<string, unknown> {
    const isFirstSave = existing == null;
    const inChar = incoming.character as Record<string, unknown> | undefined;
    // First-save case (no existing): clamp against a fresh baseline so a brand-
    // new account can't submit absurd starting values.
    const exChar = (existing?.character as Record<string, unknown> | undefined)
        ?? applyCanonicalFirstSave(FIRST_SAVE_BASELINE_CHARACTER);
    if (!inChar || typeof inChar !== 'object') return incoming;
    if (!exChar || typeof exChar !== 'object') return incoming;

    const char: Record<string, unknown> = { ...inChar };

    // Optional, presentation-only recommendation preference. Unknown or retired
    // values safely fall back to Auto; older saves remain sparse until a player
    // actually chooses a focus.
    const savedMasteryFocus = char.masteryFocus ?? exChar.masteryFocus;
    if (savedMasteryFocus === undefined) delete char.masteryFocus;
    else char.masteryFocus = normalizeMasteryFocus(savedMasteryFocus);

    // ── Free-form user text moderation ──────────────────────────────
    // The DISPLAY name is player-authored too, and was capped nowhere: `safeName`
    // bounds the derived slug used in keys, but `character.name` rode through raw.
    // It renders in OTHER players' UI (leaderboards, sector nameplates, chat, clan
    // rosters), so an unbounded one breaks layout for everyone but its owner — a
    // griefing vector on a public launch. Registration now rejects over-long names
    // with a message; this is the authoritative backstop against a tampered client,
    // so it truncates silently rather than erroring. Length only: the name is NOT
    // re-derived from the slug, because a display name legitimately differs from it
    // ("Michael Corben" → michaelcorben).
    if (typeof char.name === 'string' && char.name.length > TEXT_LIMITS.playerName) {
        char.name = char.name.slice(0, TEXT_LIMITS.playerName);
    }
    // customTitle is the other character-level field a player can put
    // arbitrary text into. Mask profanity, redact PII, cap length so a
    // tampered save can't park a slur as their public title or stuff
    // a 10 KB string into the field. On top of the profanity mask
    // (docs/legacy-system-plan.md §11.4):
    //  • reserved authority/impersonation terms ("Admin", "Kage", "Server
    //    First", …) are rejected outright — the title clears to '';
    //  • EARNED-title strings ("Season Champion", legacy titles, era titles)
    //    are wearable only by players who actually own them — ownership is
    //    checked against the STORED character.legacy.titles (server-owned)
    //    plus earnedTitles (achievement grants, same trust level as
    //    achievements themselves).
    if (typeof char.customTitle === 'string' && char.customTitle.trim()) {
        // OLD behavior (always, every build): profanity mask + length cap.
        const masked = sanitizeUserText(char.customTitle, TEXT_LIMITS.customTitle);
        const storedTitle = String((existing?.character as Record<string, unknown> | undefined)?.customTitle ?? '');
        // NEW moderation (reserved terms + earned-title ownership) applies ONLY
        // when the Legacy system is live AND the title actually CHANGED. This
        // keeps flag-off behavior byte-identical, and — critically — never
        // re-confiscates a title a player already wears (an existing, unchanged
        // "Kage Slayer" is not re-evaluated). Verification finding.
        const titleChanged = masked !== storedTitle;
        const norm = normalizeTitleKey(masked);
        if (titleChanged && isServerCreditedTitle(masked)) {
            // ALWAYS-ON (deliberate flag-off exception): the legacy/era title
            // strings are server-granted only, and the changed-only grandfather
            // above is permanent — so a title squatted while ENABLE_LEGACY is
            // still off would survive the flag flip forever. A CHANGED title
            // can claim one of these strings only if the stored server-owned
            // vault already contains it. Verification finding.
            const storedLegacy = (existing?.character as Record<string, unknown> | undefined)?.legacy as { titles?: string[] } | undefined;
            const storedServer = (existing?.character as Record<string, unknown> | undefined)?.serverTitles;
            // Server-owned ownership: stored legacy.titles ∪ serverTitles
            // (both re-injected by this sanitizer, never client-mutable).
            const serverOwned = new Set([
                ...(Array.isArray(storedLegacy?.titles) ? storedLegacy!.titles! : []),
                ...(Array.isArray(storedServer) ? (storedServer as string[]) : []),
            ].map((t) => normalizeTitleKey(String(t))));
            char.customTitle = serverOwned.has(norm) ? masked : '';
        } else if (titleChanged && isKnownEarnedTitle(masked)) {
            // Achievement-title impersonation is blocked in every release flag
            // state. Only the stored server-synced vault can authorize it.
            const storedServer = (existing?.character as Record<string, unknown> | undefined)?.serverTitles;
            const owned = new Set([
                ...(Array.isArray(exChar.earnedTitles) ? (exChar.earnedTitles as string[]) : []).map((t) => normalizeTitleKey(String(t))),
                ...(Array.isArray(storedServer) ? (storedServer as string[]) : []).map((t) => normalizeTitleKey(String(t))),
            ]);
            char.customTitle = owned.has(norm) ? masked : '';
        } else if (legacyEnabled() && titleChanged) {
            char.customTitle = isAllowedCustomTitle(masked) ? masked : '';
        } else {
            char.customTitle = masked;
        }
    } else if (char.customTitle !== undefined && typeof char.customTitle !== 'string') {
        // Non-string tamper (array/object) would skip the whole gate above and
        // render raw client-controlled content — clear it. Verification finding.
        char.customTitle = '';
    }

    // Server-owned title vault (era Herald + any future server grant). Like
    // character.legacy, the STORED copy always wins so a tampered save can't
    // self-grant one; unlockEra (api/_era.ts) is the only writer.
    {
        const exServer = (existing?.character as Record<string, unknown> | undefined)?.serverTitles;
        if (Array.isArray(exServer)) char.serverTitles = exServer;
        else delete char.serverTitles;
    }

    // Custom-title cosmetics — allowlist only (TITLE_STYLE_IDS/TITLE_ICON_SET
    // in _titles-registry.ts, mirroring the client's lib/legacy.ts). Cosmetic;
    // anything off-list clamps to ''. Legacy-wave feature: while ENABLE_LEGACY
    // is off the fields are inert — the stored copy wins, so flag-off stays
    // byte-identical for saves that never had them and a temporary kill-switch
    // toggle can't strip an already-purchased style. Verification finding.
    if (legacyEnabled()) {
        if ('customTitleStyle' in char) {
            char.customTitleStyle = (typeof char.customTitleStyle === 'string' && TITLE_STYLE_IDS.has(char.customTitleStyle)) ? char.customTitleStyle : '';
        }
        if ('customTitleIcon' in char) {
            char.customTitleIcon = (typeof char.customTitleIcon === 'string' && TITLE_ICON_SET.has(char.customTitleIcon)) ? char.customTitleIcon : '';
        }
    } else {
        const exChar = existing?.character as Record<string, unknown> | undefined;
        if (typeof exChar?.customTitleStyle === 'string') char.customTitleStyle = exChar.customTitleStyle;
        else delete char.customTitleStyle;
        if (typeof exChar?.customTitleIcon === 'string') char.customTitleIcon = exChar.customTitleIcon;
        else delete char.customTitleIcon;
    }

    // ── Legacy (server-owned) ───────────────────────────────────────
    // character.legacy is written ONLY by the server (api/legacy/sage.ts /
    // api/legacy/trial.ts / api/admin/legacy.ts). Whatever the client
    // autosaves, the STORED copy wins — a tampered save can neither claim a
    // legacy, move a stage, nor grant itself legacy titles. (Admin saves
    // bypass this sanitizer like everything else here.)
    {
        const exLegacy = (existing?.character as Record<string, unknown> | undefined)?.legacy;
        if (exLegacy !== undefined) char.legacy = exLegacy;
        else delete char.legacy;
    }

    // ── Nindo (player-authored profile creed) ──────────────────────
    // BBCode subset, rendered SAFELY client-side by lib/nindo-bbcode (never raw
    // HTML). Server job here is storage hygiene: strip control chars, cap length,
    // and blank the whole creed if its visible text (tags stripped) trips the
    // profanity gate. We always WRITE a string when `nindo` is present in the
    // incoming save — so clearing it (empty string) actually persists through the
    // image-preserving merge instead of being treated as "field omitted".
    if ('nindo' in char) {
        const NINDO_MAX_LEN = 2000;
        let v = typeof char.nindo === 'string' ? char.nindo : '';
        v = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, NINDO_MAX_LEN);
        const visibleText = v.replace(/\[\/?[a-z*]{1,8}(?:=[^\]\n]{0,256})?\]/gi, ' ');
        if (v.trim() && !isCleanText(visibleText)) v = '';
        char.nindo = v;
    }

    // Nindo banner preset — allowlist only (mirror lib/nindo-backgrounds
    // NINDO_BACKGROUND_IDS). Cosmetic; reject anything else to ''.
    if ('nindoBg' in char) {
        const NINDO_BG_IDS = new Set(['', 'ember', 'frost', 'verdant', 'shadow', 'royal', 'sakura']);
        char.nindoBg = (typeof char.nindoBg === 'string' && NINDO_BG_IDS.has(char.nindoBg)) ? char.nindoBg : '';
    }

    const strictLedger = strictRawSaveLedgerEnabled();

    // Character XP is retired (leveling-without-xp map): `xp` is FROZEN — always
    // re-asserted from the stored save (kept only as pre-wipe rollback ballast) —
    // and `level` is no longer client-writable AT ALL: it is recomputed
    // server-side from the validated stat ledger after the stat-entitlement step
    // below. The old +5-levels / +100-xp per-save allowances are gone with the
    // trust surface they bounded.
    char.xp = Math.max(0, Number(exChar.xp ?? 0));
    if (exChar.experience !== undefined) {
        char.experience = Math.max(0, Number(exChar.experience) || 0);
    } else delete char.experience;

    // Wallet values may decrease through existing client-side sinks, but all
    // increases must already exist in the stored save from a domain command.
    // This is intentionally unconditional. The old compatibility window
    // allowed a client-originated positive ryo delta when
    // STRICT_RAW_SAVE_LEDGER was absent; that made a deployment flag part of
    // the security boundary. Generic saves are now never a currency faucet.
    const exRyo = Math.max(0, Number(exChar.ryo ?? 0));
    const inRyo = Math.max(0, Number(char.ryo ?? 0));
    char.ryo = isFirstSave ? inRyo : Math.min(inRyo, exRyo);

    // Bank principal and its interest clock are server-owned. Deposits,
    // withdrawals, and interest claims all mutate the versioned save under its
    // lock, so an ordinary autosave may only re-assert the stored values.
    char.bankRyo = Math.max(0, Math.floor(Number(exChar.bankRyo) || 0));
    char.lastBankInterestAt = Math.max(0, Math.floor(Number(exChar.lastBankInterestAt) || 0));

    // Premium/material currencies: decreases pass, increases do not.
    for (const [key, maxGain] of Object.entries(CURRENCY_CAPS)) {
        const exVal = Math.max(0, Number(exChar[key] ?? 0));
        const inVal = Math.max(0, Number(char[key] ?? 0));
        char[key] = Math.min(inVal, exVal + maxGain);
    }

    // Personal Clan Points are server-issued only. Activity endpoints and the
    // Clan Exchange purchase path write these fields under the save lock and
    // bump _saveVersion; normal player autosaves may only re-assert the stored
    // values. This prevents both minting and stale autosaves erasing a reward.
    for (const field of SERVER_OWNED_CLAN_POINT_FIELDS) {
        if (exChar[field] !== undefined) char[field] = exChar[field];
        else delete char[field];
    }

    // Hollow Gate Shrine Attunement: node ranks. Anti-tamper — clamp every rank
    // to its catalog maxRank (mirrors ATTUNEMENT_NODES in
    // shinobij.client/src/lib/hollow-gate-attunement.ts) and drop unknown node
    // ids, so a forged save can't over-rank a node (e.g. Extra Dive past its +1
    // daily run, or Seasoned Delver past its +2 starting keys). Keep this map in
    // sync if a node's maxRank changes in the catalog.
    if (char.hollowGateAttunement && typeof char.hollowGateAttunement === 'object') {
        const HG_ATTUNEMENT_MAX_RANK: Record<string, number> = {
            'seasoned-delver': 2, 'reiki-reserves': 2, 'cartographer': 1,
            'greedy-hands': 3, 'extra-dive': 1, 'key-forge': 1,
        };
        const att = char.hollowGateAttunement as Record<string, unknown>;
        const clamped: Record<string, number> = {};
        for (const k of Object.keys(att)) {
            const max = HG_ATTUNEMENT_MAX_RANK[k];
            if (max === undefined) continue; // unknown node — drop it
            const v = Math.max(0, Math.min(max, Math.floor(Number(att[k]) || 0)));
            if (v > 0) clamped[k] = v;
        }
        char.hollowGateAttunement = clamped;
    }

    // Account creation timestamp — backfill if missing so anti-alt checks
    // have a stable reference. Existing characters get a "now" stamp the
    // first time they save after this lands; new characters set it client-
    // side at creation.
    if (!exChar.createdAt && !char.createdAt) {
        char.createdAt = Date.now();
    } else if (exChar.createdAt) {
        // Once stamped, the value is immutable — clients can't claim a fake old age.
        char.createdAt = exChar.createdAt;
    }

    // Profession: lock the profession choice (the server-side picker and its
    // one-time respec flow write it via /api/profession/choose), reject client
    // XP gains, and recompute rank from XP so a malicious client can't claim a
    // higher rank than its XP earns.
    //
    // Two-state lockdown:
    //   • exChar HAS a profession  → preserve it (only the dedicated endpoint
    //     may spend the one-time change and replace it).
    //   • exChar has NO profession → ALSO preserve `undefined`. The dedicated
    //     /api/profession/choose endpoint is the only path that may set the
    //     initial value. Without this branch a fresh-account save POST could
    //     self-grant `profession: 'vanguard'` and immediately unlock the
    //     Vanguard discount path on jutsu/speedup / train-with-seals, or
    //     profession: 'healer' to unlock cross-village healing, etc.
    char.profession = exChar.profession;
    const exProfXp = Math.max(0, Number(exChar.professionXp ?? 0));
    const inProfXp = Math.max(0, Number(char.professionXp ?? 0));
    const cappedProfXp = Math.min(inProfXp, exProfXp);
    char.professionXp = cappedProfXp;
    if (char.profession) {
        char.professionRank = rankFromXp(char.profession, cappedProfXp);
    } else {
        // No profession yet → strip any client-supplied rank too.
        char.professionRank = 0;
    }

    // Profession mastery: clamp the allocation to the budget the player's mastery
    // LEVEL allows (derived from profession XP past rank 10), legal node ranks, and
    // satisfied capstone gates. Anti-tamper — a forged masterySpec can't grant
    // unearned capstones or over-spend. PvE/utility effects only.
    //
    // (#17 ordering) This MUST run AFTER char.profession is locked to exChar's
    // value and char.professionXp is capped above — otherwise masteryBudget()
    // would see the still-raw client professionXp and validate an over-spent
    // tree (or a forged profession). Reads char.professionXp (the capped value).
    if (!isFirstSave) {
        if (exChar.masterySpec !== undefined) char.masterySpec = exChar.masterySpec;
        else delete char.masterySpec;
    }
    if (!isFirstSave) {
        for (const field of ['customTitle', 'customTitleStyle', 'customTitleIcon'] as const) {
            if (exChar[field] !== undefined) char[field] = exChar[field]; else delete char[field];
        }
    }

    // Stat points are an entitlement, not a client-authored gain. Ordinary
    // saves may spend the stored unspent pool or perform the paid full respec,
    // but training/combat must credit new points directly to the stored save.
    const existingStatKeys = exChar.stats && typeof exChar.stats === 'object'
        ? Object.keys(exChar.stats as Record<string, unknown>)
        : [];
    if (!strictLedger && existingStatKeys.length < STAT_CAP_FIELDS.length) {
        char.stats = inChar.stats;
        char.unspentStats = Math.max(0, Math.min(Number(inChar.unspentStats) || 0, Number(exChar.unspentStats) || 0));
    } else {
        const statEntitlement = preserveStatPointEntitlement(char, exChar);
        char.stats = statEntitlement.stats;
        char.unspentStats = statEntitlement.unspentStats;
    }
    // ── Stat-derived level (leveling-without-xp map) ────────────────────────
    // One-time ledger migration: an XP-era save whose earned points don't yet
    // cover its stored level gets the difference as pool points, so nobody
    // de-levels and nobody's progress silently stalls until earned catches up.
    // Computed from the STORED level + the entitlement-validated ledger only.
    if (!exChar.levelLedgerMigrated) {
        const storedLevel = Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(exChar.level) || 1)));
        const earnedNow = earnedStatPoints(char);
        const need = earnedForLevel(storedLevel);
        if (earnedNow < need) {
            char.unspentStats = Math.max(0, Math.floor(Number(char.unspentStats) || 0)) + (need - earnedNow);
        }
    }
    // The migration only "sticks" when its effect does. Under strictLedger,
    // enforceRawSaveLedgerBoundary re-copies level/stats/unspentStats from the
    // stored save further down and throws the top-up away — so latching the flag
    // here would burn the one-time migration without ever applying it, stalling
    // that player's leveling permanently.
    char.levelLedgerMigrated = strictLedger ? exChar.levelLedgerMigrated === true : true;
    // Level is a pure function of the validated ledger, clamped by the exam
    // holds; the client-supplied level is ignored entirely (forge-proof). The
    // rise-only recompute is seeded from the STORED level, so a save write can
    // only move level the way the server's own grant endpoints would.
    {
        // SECURITY: seed the exam list from the STORED save, never from `char`.
        // `char` is still the raw client body here — examsPassed is not validated
        // until the exam block ~440 lines below — and examLevelCap() reads it to
        // decide the level ceiling. Seeding from `char` would let a forged
        // `examsPassed: ['genin','chunin']` mint a level past both exam holds,
        // and because the recompute is rise-only that level would then be
        // permanent even after the honest exam list is restored.
        const seeded = {
            ...char,
            examsPassed: Array.isArray(exChar.examsPassed) ? exChar.examsPassed : [],
            level: Math.max(1, Math.min(LEVEL_CAP, Math.floor(Number(exChar.level) || 1))),
        };
        const derived = applyDerivedLevel(seeded) as Record<string, unknown>;
        char.level = derived.level;
        char.rankTitle = derived.rankTitle ?? char.rankTitle;
        char.maxHp = derived.maxHp ?? char.maxHp;
        char.maxChakra = derived.maxChakra ?? char.maxChakra;
        char.maxStamina = derived.maxStamina ?? char.maxStamina;
        char.hp = derived.hp ?? char.hp;
        char.chakra = derived.chakra ?? char.chakra;
        char.stamina = derived.stamina ?? char.stamina;
    }
    char.totalStatsTrained = Math.max(0, Math.floor(Number(exChar.totalStatsTrained) || 0));
    // Server-owned redemption ledgers (idempotency receipts): the stored array
    // always wins — a generic save can neither clear nor forge one. Advanced
    // only by their domain endpoints (training, shop, craft, story, pets, …).
    for (const field of SERVER_ARRAY_LEDGER_CHARACTER_FIELDS) {
        if (Array.isArray(exChar[field])) char[field] = exChar[field];
        else delete char[field];
    }
    // Server-mirrored domain state (exploration/chest daily caps, achievements,
    // Endless Tower): copy-if-defined from stored on every save. Advanced only
    // by /api/world/explore, /api/world/open-chest, /api/achievements/sync,
    // /api/endless/run respectively.
    for (const field of SERVER_MIRRORED_CHARACTER_FIELDS) {
        if (exChar[field] !== undefined) char[field] = exChar[field];
        else delete char[field];
    }
    // Main-story progression and its redemption ledger are advanced only by
    // /api/story/settle after an exact next-boss AI token is consumed. Generic
    // saves may reassert UI state but cannot skip chapters or replay rewards.
    char.storyProgress = Math.max(0, Math.min(9, Math.floor(Number(exChar.storyProgress) || 0)));
    // One-time payout latches (Academy spar via /api/story/settle, starter pet,
    // Chronicle Scribe codex via /api/card-clash/claim-starter): kept only when
    // the STORED save says true.
    for (const field of BOOLEAN_LATCH_CHARACTER_FIELDS) {
        if (exChar[field] === true) char[field] = true;
        else delete char[field];
    }
    // These progression fields are written by dedicated, proof-bearing server
    // flows. Generic saves may mirror them but cannot mint achievement or combat
    // entitlement by increasing them.
    if (!isFirstSave) {
        // 'apexWeekClaimed' is the ONLY thing stopping a Hunter-Rank-5 player from
        // re-claiming the 8,000-ryo Apex purse every save: claim-mission stamps it
        // with the settled ISO week, so a client-writable copy could just be reset.
        for (const field of PROGRESSION_ENTITLEMENT_CHARACTER_FIELDS) {
            if (exChar[field] !== undefined) char[field] = exChar[field];
            else delete char[field];
        }
    }
    // Jutsu mastery is advanced only by server training endpoints. The retired
    // client per-cast XP path is not trusted by generic saves. Character creation
    // may seed level-one rows, but cannot bootstrap trained levels or stored XP.
    if (isFirstSave) {
        const seen = new Set<string>();
        char.jutsuMastery = (Array.isArray(inChar.jutsuMastery) ? inChar.jutsuMastery : [])
            .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
            .map((row) => String(row.jutsuId ?? '').trim().toLowerCase())
            .filter((id) => /^[a-z0-9][a-z0-9-]{1,63}$/.test(id) && !seen.has(id) && Boolean(seen.add(id)))
            .slice(0, 100)
            .map((jutsuId) => ({ jutsuId, level: 1, xp: 0 }));
    } else {
        const storedMastery = Array.isArray(exChar.jutsuMastery)
            ? exChar.jutsuMastery as Array<Record<string, unknown>>
            : [];
        const requestedMastery = Array.isArray(char.jutsuMastery)
            ? char.jutsuMastery as Array<Record<string, unknown>>
            : [];
        const requestedById = new Map(requestedMastery.map((row) => [String(row?.jutsuId ?? ''), row]));
        char.jutsuMastery = storedMastery.map((storedRow) => {
            if (strictLedger) return storedRow;
            const proposed = requestedById.get(String(storedRow?.jutsuId ?? ''));
            const sameLevel = Number(proposed?.level) === Number(storedRow.level);
            const xpGain = Number(proposed?.xp) - Number(storedRow.xp ?? 0);
            return proposed && sameLevel && xpGain >= 0 && xpGain <= 100
                ? { ...storedRow, xp: Number(proposed.xp) }
                : storedRow;
        });
    }

    // HP / chakra / stamina must not exceed their own max fields.
    if (Number(char.hp ?? 0) > Number(char.maxHp ?? char.hp)) char.hp = char.maxHp;
    if (Number(char.chakra ?? 0) > Number(char.maxChakra ?? char.chakra)) char.chakra = char.maxChakra;
    if (Number(char.stamina ?? 0) > Number(char.maxStamina ?? char.stamina)) char.stamina = char.maxStamina;

    // Lifetime / leaderboard counters: per-save delta cap. Hall of Legends
    // and achievement gates read these directly, so a tampered client could
    // jump `totalPvpKills` from 0 → 999999 in one save. Cap each at a
    // generous-but-bounded delta per save cycle. The 60s rolling-window
    // limiter further bounds aggregate growth. Counters can never decrease
    // (clients legitimately don't reset these).
    // LIFETIME_COUNTERS (all zero-delta) derives from the ownership manifest
    // ('lifetime-counter-char'); per-counter rationale lives on the entries.
    for (const [field, maxDelta] of Object.entries(LIFETIME_COUNTERS)) {
        const inV = Math.max(0, Number((char as Record<string, unknown>)[field] ?? 0));
        const exV = Math.max(0, Number((exChar as Record<string, unknown>)[field] ?? 0));
        // Disallow shrinking the counter, and clamp growth to maxDelta.
        const clamped = Math.max(exV, Math.min(inV, exV + maxDelta));
        (char as Record<string, unknown>)[field] = clamped;
    }

    // ── Monthly clan contribution counters ─────────────────────────────────
    // clanBattleContrib / clanEventContrib / clanMissionContrib feed the
    // clan-roster leaderboard and the "Clan Patriot" achievement (500 battle
    // contrib), so a tampered save could otherwise jump 0 → 999K in one POST.
    // These are MONTHLY counters (the client resets them when clanContribMonth
    // ticks over), so we cannot disallow decreases like the lifetime counters
    // above — instead we clamp the absolute value to a generous monthly max
    // AND cap upward delta per save. A new-month reset arrives as a DECREASE
    // (handled), and within a month the value can only grow by maxDelta/save.
    const MONTHLY_CLAN_CONTRIB_CAPS: Record<string, { absMax: number; maxDelta: number }> = {
        // +1 per PvP win → 30 days × 20 fights/day = 600/month upper bound;
        // 1500 leaves comfortable headroom for the most-active legit player.
        clanBattleContrib: { absMax: 1500, maxDelta: 0 },
        // Treasury donations can grant variable amounts (ryo / 1000 or 1-per-
        // donation depending on currency) — a bit higher cap and delta.
        clanEventContrib:  { absMax: 5000, maxDelta: 0 },
        // +1 per completed clan mission; ~5/save tracks the totalMissionsCompleted pacing.
        clanMissionContrib: { absMax: 1000, maxDelta: 0 },
    };
    for (const [field, { absMax, maxDelta }] of Object.entries(MONTHLY_CLAN_CONTRIB_CAPS)) {
        const inV = Math.max(0, Number((char as Record<string, unknown>)[field] ?? 0));
        const exV = Math.max(0, Number((exChar as Record<string, unknown>)[field] ?? 0));
        // Allow decreases freely (monthly reset). On the way up, cap at
        // min(absMax, exV + maxDelta).
        const upperBound = Math.min(absMax, exV + maxDelta);
        const clamped = inV <= exV ? Math.min(inV, absMax) : Math.min(inV, upperBound);
        (char as Record<string, unknown>)[field] = clamped;
    }

    // ── rankedRating / petRankedRating: server-authoritative ──────────────
    // (audit #7 / Stage 3, final step.) These ratings are now credited ONLY by
    // the server — pvp/claim-rewards (player) and pet/battle-result (pet) — under
    // the SAME lock:save:<name> the autosave takes, so by the time an updated
    // client's autosave runs the stored value already reflects the credit and
    // the autosave is a no-op RE-ASSERT. The read-back client only displays +
    // re-asserts the returned value; it no longer mints the delta. So a
    // client-driven INCREASE via the save blob is illegitimate (the old ±200
    // swing clamp merely rate-limited minting — it didn't stop it). Reject
    // increases by reverting to the stored value; allow a re-assert (equal) and
    // a DECREASE (the server lowers a loser's rating, and a stale tab
    // re-asserting an older/lower value is harmless — the next server credit
    // re-raises it). Admin saves skip this whole sanitizer (the `!isAdminSave`
    // gate at the call site), so admin tooling can still set ratings directly.
    // NOTE: assumes the read-back client is live — a pre-activation client that
    // self-applied a win WITHOUT the server crediting will have that increase
    // reverted here and must refresh to the current client.
    for (const ratingField of ['rankedRating', 'petRankedRating'] as const) {
        const inV = Number((char as Record<string, unknown>)[ratingField] ?? 1000);
        const exV = Number((exChar as Record<string, unknown>)[ratingField] ?? 1000);
        if (Number.isFinite(inV) && Number.isFinite(exV)) {
            (char as Record<string, unknown>)[ratingField] = inV > exV ? exV : inV;
        }
    }

    // Pet roster cap: a tampered client cannot grow the carried roster beyond
    // its entitlement. Subscriber-aware (Patreon perk): 4 for the base tier,
    // 6 for subscribers. Read the entitlement from the authoritative stored
    // character, never the incoming save payload.
    //
    // NON-DESTRUCTIVE downgrade: never truncate BELOW the already-stored roster,
    // so a lapsed subscriber (or a legacy larger roster) keeps every pet — the
    // cap only prevents GROWING past it. A legit base-tier roster is <=4, so a
    // tampered save still can't grow the roster past 4.
    const existingPets = Array.isArray(exChar.pets) ? exChar.pets as Array<Record<string, unknown>> : [];
    const PET_CAP = Math.max(maxPets(exChar), existingPets.length);
    const existingPetById = new Map(existingPets.map((pet) => [String(pet?.id ?? ''), pet]));
    const submittedPets = Array.isArray(char.pets) ? char.pets as Array<Record<string, unknown>> : [];
    // PET_IDENTITY_FIELDS derives from the ownership manifest ('pet-identity'):
    // combat progression, timers, paid identity, and gear are all committed by
    // dedicated pet endpoints. A generic save cannot add/remove ownership or
    // train, feed, rename, equip, or fabricate expedition state.
    // Once strict settlement is enabled, pet identity and progression must
    // come from dedicated endpoints. Compatibility mode retains bounded legacy
    // pet rewards until every caller has migrated.
    char.pets = submittedPets
        .filter((pet) => {
            if (existingPetById.has(String(pet?.id ?? ''))) return true;
            if (strictLedger || existingPets.length > 0) return false;
            const stats = ['hp', 'attack', 'defense', 'speed'].map((field) => Number(pet?.[field]));
            return typeof pet?.id === 'string'
                && stats.every((value) => Number.isFinite(value) && value >= 1 && value <= 100)
                && !Array.isArray(pet.jutsus)
                && pet.level === undefined
                && pet.xp === undefined;
        })
        .map((pet) => {
            const stored = existingPetById.get(String(pet.id));
            if (!stored) return pet;
            const next = { ...pet };
            for (const field of PET_IDENTITY_FIELDS) {
                if (stored[field] !== undefined) next[field] = stored[field];
                else delete next[field];
            }
            return next;
        });
    // Defense in depth for older partial-save callers: a breeding parent stays
    // server-locked until readyAt. The authoritative rebuild below preserves all
    // owned pets; this also restores locked selections before that rebuild.
    const breedingLockedIds = activeBreedingParentIds(exChar, Date.now());
    if (breedingLockedIds.size > 0) {
        const keptIds = new Set((char.pets as Array<Record<string, unknown>>).map((pet) => String(pet.id ?? '')));
        for (const storedPet of existingPets) {
            const id = String(storedPet.id ?? '');
            if (breedingLockedIds.has(id) && !keptIds.has(id)) {
                (char.pets as Array<Record<string, unknown>>).push(storedPet);
                keptIds.add(id);
            }
        }
        for (const field of ['activePetId', 'activePetId2v2'] as const) {
            if (breedingLockedIds.has(String(char[field] ?? ''))) copyStoredField(char, exChar, field);
        }
    }
    // Generic, partial, or stale saves may neither remove nor reorder owned
    // pets. Roster membership/order changes only through dedicated pet and
    // Sanctuary endpoints, which can safely coordinate the ownership move.
    if (existingPets.length > 0) {
        const retainedById = new Map(
            (char.pets as Array<Record<string, unknown>>)
                .map((pet) => [String(pet?.id ?? ''), pet] as const)
                .filter(([id]) => Boolean(id)),
        );
        char.pets = existingPets.map((storedPet) =>
            retainedById.get(String(storedPet?.id ?? '')) ?? storedPet,
        );
    }
    const inPets = char.pets as Array<Record<string, unknown>>;
    if (inPets && inPets.length > PET_CAP) {
        const activeId = String(char.activePetId ?? '');
        const active = activeId ? inPets.find(p => String(p?.id) === activeId) : null;
        const others = inPets.filter(p => String(p?.id) !== activeId);
        const kept = active ? [active, ...others.slice(0, PET_CAP - 1)] : others.slice(0, PET_CAP);
        char.pets = kept;
    }
    // A generic save cannot rotate lapsed/legacy overflow into the current-use
    // 4/6 projection by changing active ids. Keep valid prior selections; swaps
    // happen by depositing/withdrawing through the Sanctuary.
    const eligibleStoredPetIds = new Set(activeCarriedPetIds(exChar, existingPets));
    const retainedPetIds = new Set(
        (char.pets as Array<Record<string, unknown>>)
            .map((pet) => String(pet?.id ?? ''))
            .filter(Boolean),
    );
    for (const field of ['activePetId', 'activePetId2v2'] as const) {
        const requestedId = String(char[field] ?? '');
        if (requestedId && eligibleStoredPetIds.has(requestedId) && retainedPetIds.has(requestedId)) continue;
        const previousId = String(exChar[field] ?? '');
        if (previousId && eligibleStoredPetIds.has(previousId) && retainedPetIds.has(previousId)) char[field] = previousId;
        else delete char[field];
    }

    // Pet stat ceiling: HP/ATK/DEF/SPD are uncapped client-side by design (training
    // builds them to the level-100 ceiling ≈ base*4.96), so the only guard against a
    // tampered save injecting absurd values into the deterministic ranked pet ladder
    // is a server clamp. Per-rarity at base*8 (~1.6x the legit all-in max) — well
    // above any legit build (native or evolved), far below the old flat 100k that
    // let a ~300x pet through. See _pet-stat-ceil.ts.
    if (Array.isArray(char.pets)) {
        for (const p of char.pets as Array<Record<string, unknown>>) {
            if (!p || typeof p !== 'object') continue;
            for (const k of ['hp', 'attack', 'defense', 'speed'] as const) {
                const v = Number(p[k]);
                if (Number.isFinite(v)) p[k] = Math.max(1, Math.min(petStatCeil(p.rarity, k), Math.round(v)));
            }
        }
    }

    // Inventory + tile-card collection size caps. A tampered client could
    // submit thousands of items, both bloating KV and inflating foreign-read
    // payloads. 500 is well above any realistic veteran's working inventory
    // and matches what the client UI can scroll through cleanly.
    const INVENTORY_CAP = 500;
    if (Array.isArray(char.inventory) && (char.inventory as unknown[]).length > INVENTORY_CAP) {
        char.inventory = (char.inventory as unknown[]).slice(0, INVENTORY_CAP);
    }
    // Counted stacks for bulk consumables (client lib/inventory.ts moves
    // stackable ids out of inventory[] into here, which is what keeps the cap
    // above from overflowing for hoarders). Validate structurally so a tampered
    // client can't bloat the save: dedupe by id, floor + clamp each count, drop
    // non-positive entries, and cap the number of distinct stack keys.
    const ITEM_STACK_MAX = 9999;
    const ITEM_STACK_KEY_CAP = 200;
    if (Array.isArray(char.itemStacks)) {
        const counts = new Map<string, number>();
        for (const s of char.itemStacks as unknown[]) {
            if (!s || typeof s !== 'object') continue;
            const itemId = String((s as Record<string, unknown>).itemId ?? '');
            if (!itemId) continue;
            const n = Math.max(0, Math.floor(Number((s as Record<string, unknown>).count ?? 0)));
            if (n <= 0) continue;
            counts.set(itemId, Math.min(ITEM_STACK_MAX, (counts.get(itemId) ?? 0) + n));
        }
        // Hollow Gate Keys are forged/crafted client-side (Key Forge 80 shards, or
        // the Crafter recipe). Cap the per-save GAIN so a forged save can't mint a
        // huge stack with no shard/material spend (a legit full run yields ~3). The
        // 'hollow-gate-key' literal mirrors HOLLOW_GATE_KEY_ID in
        // shinobij.client/src/constants/game.ts.
        const HG_KEY_ID = 'hollow-gate-key';
        const HG_KEY_PER_SAVE_GAIN = 10;
        if (counts.has(HG_KEY_ID)) {
            const exKeys = Array.isArray(exChar.itemStacks)
                ? Math.max(0, Number((exChar.itemStacks as Array<Record<string, unknown>>)
                    .find(s => s?.itemId === HG_KEY_ID)?.count ?? 0))
                : 0;
            counts.set(HG_KEY_ID, Math.min(counts.get(HG_KEY_ID)!, exKeys + HG_KEY_PER_SAVE_GAIN));
        }
        char.itemStacks = [...counts.entries()]
            .slice(0, ITEM_STACK_KEY_CAP)
            .map(([itemId, count]) => ({ itemId, count }));
    }
    const ownedItems = preserveOwnedItems(char.inventory, char.itemStacks, exChar.inventory, exChar.itemStacks);
    char.inventory = ownedItems.inventory;
    char.itemStacks = ownedItems.itemStacks;
    // All item ownership is server-issued. Conserve the combined inventory +
    // counted-stack entitlement so load-time array→stack migration remains
    // lossless while arbitrary additions in either representation are dropped.
    // ─── examsPassed validation ───────────────────────────────────────────────
    // Genin and Chunin gate level progression. Jonin and Special Jonin are
    // optional prestige stamps, but all four keys remain server-owned. A forged save could POST
    // examsPassed:["genin","chunin","jonin","specialJonin"] to skip every
    // exam and falsify its record. Rules:
    //   - Only the 4 known exam keys are accepted
    //   - Cap length at 4 (one of each)
    //   - Dedupe
    //   - Level-gate: genin needs level ≥20, chunin needs level ≥39
    //   - Don't shrink an existing entry (legitimate veterans keep their list)
    const KNOWN_EXAMS = new Set(['genin', 'chunin', 'jonin', 'specialJonin']);
    const EXAM_LEVEL_GATES_SERVER = Object.fromEntries(
        PROGRESSION_EXAM_HOLDS.map(({ exam, level }) => [exam, level]),
    ) as Record<string, number>;
    // Server-side requirement FLOOR (gameplay-loop audit L-1). The full exam
    // checklist (elements, stat-training, jutsu mastery, clan, boss defeats) is
    // evaluated client-side; here we additionally enforce the subset backed by
    // the rate-limited lifetime counters clamped above, so a tampered client
    // can't just append an exam key at the level threshold and skip the grind.
    // We ONLY check counters the sanitizer itself bounds (expensive to forge)
    // and FAIL OPEN on every requirement we can't verify here — a legit player
    // who passed client-side always carries these counters (same character
    // state the client gated on), so this can never softlock a real player.
    // max(totalMissionsCompleted, clanMissionContrib) mirrors the client's
    // `?? clanMissionContrib` fallback so the server is never stricter.
    const examCounter = (field: string): number => Math.max(0, Number((char as Record<string, unknown>)[field] ?? 0));
    const examMissionsDone = Math.max(examCounter('totalMissionsCompleted'), examCounter('clanMissionContrib'));
    const EXAM_COUNTER_REQUIREMENTS_MET: Record<string, boolean> = {
        genin: examCounter('totalAiKills') >= 20 && examMissionsDone >= 20 && examCounter('totalTilesExplored') >= 50,
        chunin: examMissionsDone >= 50 && examCounter('totalTilesExplored') >= 100,
        jonin: examCounter('totalPvpKills') >= 10 && examCounter('totalVillageRaids') >= 20,
        specialJonin: examCounter('totalPvpKills') >= 100,
    };
    const exExams = Array.isArray(exChar.examsPassed) ? (exChar.examsPassed as unknown[]).map(String) : [];
    const inExams = Array.isArray(char.examsPassed) ? (char.examsPassed as unknown[]).map(String) : [];
    const charLevel = Number(char.level ?? exChar.level ?? 1);
    const validatedExams: string[] = [];
    const seenExams = new Set<string>();
    // Preserve every exam already on the existing save (don't penalize legit veterans).
    for (const e of exExams) {
        if (KNOWN_EXAMS.has(e) && !seenExams.has(e)) {
            validatedExams.push(e);
            seenExams.add(e);
        }
    }
    // Accept NEW exam additions only if they pass the level gate AND the
    // server-trackable requirement floor. Exams absent from the map fail open.
    for (const e of inExams) {
        if (!KNOWN_EXAMS.has(e) || seenExams.has(e)) continue;
        const required = EXAM_LEVEL_GATES_SERVER[e];
        if (required != null && charLevel < required) continue;
        if (e in EXAM_COUNTER_REQUIREMENTS_MET && !EXAM_COUNTER_REQUIREMENTS_MET[e]) continue;
        validatedExams.push(e);
        seenExams.add(e);
    }
    char.examsPassed = validatedExams.slice(0, 4);
    // Final authority boundary: the dedicated /api/exams/pass flow evaluates
    // the complete checklist (including mastery, clan, named AI defeats, and
    // live Kage/ANBU leadership). Generic saves only preserve its committed list.
    if (!isFirstSave) char.examsPassed = exExams.filter((exam, index) => KNOWN_EXAMS.has(exam) && exExams.indexOf(exam) === index).slice(0, 4);

    // ─── pendingCombatMissionClaims validation ────────────────────────────────
    // Combat-mission claims are server-owned by the queue and claim endpoints.
    // A player save may preserve an already-stored flag, but it may not mint a
    // new one or clear a server-queued one.
    // Without this, a tampered save could add a valid catalog key and claim combat
    // rewards without winning the fight.
    if (char.pendingCombatMissionClaims !== undefined) {
        const PENDING_COMBAT_CLAIMS_CAP = 50;
        const rawPending = Array.isArray(exChar.pendingCombatMissionClaims)
            ? (exChar.pendingCombatMissionClaims as unknown[])
            : [];
        const validatedPending: string[] = [];
        const seenPending = new Set<string>();
        for (const raw of rawPending) {
            const key = String(raw ?? '');
            if (!key || seenPending.has(key)) continue;
            const def = combatMissionByKey(key);
            if (!def) continue;                  // not a real catalog mission key
            if (charLevel < def.min) continue;   // below the mission's level gate
            validatedPending.push(key);
            seenPending.add(key);
            if (validatedPending.length >= PENDING_COMBAT_CLAIMS_CAP) break;
        }
        char.pendingCombatMissionClaims = validatedPending;
    }

    // ─── savedBloodlines normalization ────────────────────────────────────────
    // Players author custom bloodlines client-side; without server validation
    // a forged save can POST bloodlines with jutsus { effectPower: 9999, ap: 0,
    // cooldown: 0 } that the equip path then makes usable in combat.
    // Rules:
    //   - Cap savedBloodlines.length at 5 (client UI keeps 1, but be generous
    //     for migration / multi-bloodline rosters)
    //   - For each bloodline: cap jutsus at 15, clamp per-jutsu numerics
    //   - Strip inline data:image/svg URIs from the bloodline image (SVG can
    //     carry <script>; only the /api/images endpoint is supposed to enforce
    //     this and inline saves bypass it)
    const BLOODLINE_CAP = 5;
    const JUTSU_PER_BLOODLINE_CAP = 15;
    const RAW_BLOODLINE_IMAGE_MAX_BYTES = 250_000;  // 250 KB inline cap
    const KNOWN_BLOODLINE_RANKS = new Set(['B Rank', 'A Rank', 'S Rank']);
    const BLOODLINE_RANK_ORDER: Record<string, number> = { 'B Rank': 0, 'A Rank': 1, 'S Rank': 2 };
    // sub-3: bloodline acquisition/rank entitlement. Existing bloodlines are
    // grandfathered by stable id at their stored rank. A new bloodline—or an
    // upward rank change—requires a one-use entitlement issued only by
    // POST /api/bloodlines/forge after its material cost is debited under the
    // player-save lock. Generic save payloads cannot create, edit, or replay the
    // top-level pendingBloodlineForges field; this sanitizer preserves the stored
    // list and consumes at most one exact-rank entitlement per accepted forge.
    const pendingBloodlineForges = readPendingBloodlineForges(existing?.pendingBloodlineForges);
    const consumedBloodlineForgeIds = new Set<string>();
    // sub-1: enforce the bloodline POINT BUDGET server-side (the core PvP-balance
    // knob). BloodlineMaker already applies this exact budget, so honest content
    // is unchanged while forged extra tags are stripped deterministically.
    const normalizeBloodlineArray = (arr: unknown, existingArr: unknown, mayConsumeForge = false): unknown[] => {
        if (!Array.isArray(arr)) return arr as unknown[];
        const existingRankById = new Map<string, string>();
        if (Array.isArray(existingArr)) {
            for (const eb of existingArr as Array<Record<string, unknown>>) {
                if (eb && typeof eb === 'object') {
                    const eid = String(eb.id ?? '');
                    const er = String(eb.rank ?? '');
                    if (eid && KNOWN_BLOODLINE_RANKS.has(er)) existingRankById.set(eid, er);
                }
            }
        }
        let acceptedEntitledNew = 0;
        let rejectedUnentitledNew = false;
        const normalized = (arr as Array<Record<string, unknown>>).slice(0, BLOODLINE_CAP).map((bl) => {
            if (!bl || typeof bl !== 'object') return {};
            const out: Record<string, unknown> = { ...bl };
            // Existing ids may retain or lower their stored rank. New ids and rank
            // upgrades must consume an exact-rank forge purchase. With no purchase,
            // a new entry is discarded rather than silently granting free B rank.
            const rawRank = String(out.rank ?? '');
            let rank = KNOWN_BLOODLINE_RANKS.has(rawRank) ? rawRank : 'B Rank';
            const blId = String(out.id ?? '');
            const storedRank = blId ? existingRankById.get(blId) : undefined;
            const isUpgrade = storedRank !== undefined
                && (BLOODLINE_RANK_ORDER[rank] ?? 0) > (BLOODLINE_RANK_ORDER[storedRank] ?? 0);
            if (!storedRank || isUpgrade) {
                const requestedRank = parseBloodlineForgeRank(rawRank);
                const forge = mayConsumeForge && requestedRank
                    ? pendingBloodlineForges.find((entry) => entry.rank === requestedRank && !consumedBloodlineForgeIds.has(entry.id))
                    : undefined;
                if (forge) {
                    consumedBloodlineForgeIds.add(forge.id);
                    acceptedEntitledNew += 1;
                    rank = forge.rank;
                } else if (!storedRank) {
                    rejectedUnentitledNew = true;
                    return null;
                } else {
                    rank = storedRank;
                }
            }
            out.rank = rank;
            // Strip inline SVG / oversized image data — let shared image
            // storage host real images via the /api/images allowlist.
            if (typeof out.image === 'string') {
                const img = out.image;
                if (/^data:image\/svg/i.test(img) || img.length > RAW_BLOODLINE_IMAGE_MAX_BYTES) {
                    out.image = undefined;
                }
            }
            // Numeric totalPoints — informational; the equip-side math
            // doesn't rely on it but clamp anyway so leaderboards/UI don't
            // see absurd values.
            out.totalPoints = Math.max(0, Math.min(20, Number(out.totalPoints ?? 0) || 0));
            // Bloodline name + lore are free-form, player-authored, and shown
            // publicly in the bloodline gallery (the name also appears in PvP
            // battle-log flavor). They bypassed the moderation customTitle gets,
            // so run them through the same sanitizer + length caps (audit #16).
            if (typeof out.name === 'string') out.name = sanitizeUserText(out.name, TEXT_LIMITS.storyName);
            if (typeof out.lore === 'string') out.lore = sanitizeUserText(out.lore, TEXT_LIMITS.description);
            // Jutsus list — cap count + clamp per-jutsu numerics.
            const rawJutsus = Array.isArray(out.jutsus) ? out.jutsus as Array<Record<string, unknown>> : [];
            out.jutsus = rawJutsus.slice(0, JUTSU_PER_BLOODLINE_CAP).map((j) => {
                if (!j || typeof j !== 'object') return j;
                const jOut: Record<string, unknown> = { ...j };
                if (jOut.effectPower != null) {
                    // Bloodline jutsu effectPower is ALWAYS one of {0 (40-AP
                    // utility), 40 (standard 60-AP), 50 (the single Nuke)} — see
                    // BloodlineMaker / lib/bloodline-templates.ts:87. The old
                    // [0,200] clamp let a forged save POST inject a ~4x-damage
                    // "nuke" (effectPower 200) that the PvP engine applies as raw
                    // base damage (audit #3). Clamp to the legit ceiling of 50:
                    // no honest bloodline jutsu exceeds it, so this is behavior-
                    // preserving for real players and neutralizes the injection.
                    jOut.effectPower = Math.max(0, Math.min(50, Number(jOut.effectPower) || 0));
                }
                if (jOut.ap != null) {
                    // Legit bloodline jutsu AP is 40 / 60 / 80 — never below 40.
                    // Floor at 40 (was 20) so a forged ap:1 can't make the nuke
                    // castable ~5x/turn (audit #14); the upper bound is unchanged.
                    jOut.ap = Math.max(40, Math.min(200, Number(jOut.ap) || 40));
                }
                if (jOut.cooldown != null) {
                    jOut.cooldown = Math.max(0, Math.min(50, Number(jOut.cooldown) || 0));
                }
                if (jOut.chakraCost != null) {
                    jOut.chakraCost = Math.max(0, Math.min(1000, Number(jOut.chakraCost) || 0));
                }
                if (jOut.staminaCost != null) {
                    jOut.staminaCost = Math.max(0, Math.min(1000, Number(jOut.staminaCost) || 0));
                }
                if (jOut.range != null) {
                    jOut.range = Math.max(0, Math.min(30, Number(jOut.range) || 1));
                }
                // Player-authored jutsu name + battleDescription are shown in the
                // gallery and the PvP battle log (api/pvp/move.ts) — moderate them
                // the same way as the bloodline name/lore above (audit #16).
                if (typeof jOut.name === 'string') jOut.name = sanitizeUserText(jOut.name, TEXT_LIMITS.storyName);
                if (typeof jOut.battleDescription === 'string') jOut.battleDescription = sanitizeUserText(jOut.battleDescription, TEXT_LIMITS.description);
                const visualEffect = sanitizeJutsuVisualEffect(jOut.visualEffect, jOut.ap, jOut.target);
                if (visualEffect) jOut.visualEffect = visualEffect;
                else delete jOut.visualEffect;
                return jOut;
            });
            // sub-1: enforce the bloodline point budget across the now numeric-clamped
            // jutsu. Strips the lowest-point tags down to the rank budget; clamp,
            // never reject. Honest within-budget bloodlines are unchanged. Uses
            // the entitlement-clamped out.rank set above.
            if (Array.isArray(out.jutsus)) {
                const blRank = typeof out.rank === 'string' ? out.rank : null;
                out.jutsus = enforceBloodlineBudget(out.jutsus as RawJutsu[], blRank) as unknown[];
                out.totalPoints = Math.min(20, bloodlinePoints(out.jutsus as RawJutsu[], blRank));
            }
            return out;
        }).filter((bl): bl is Record<string, unknown> => bl !== null);

        // Atomic replacement safety: the base-tier client stores one custom
        // bloodline and submits `[newDraft]` when replacing it. If that draft
        // has no forge entitlement, accepting the now-empty normalized array
        // would erase the valid stored bloodline. Reject that whole replacement
        // and preserve the stored roster. A genuinely entitled new bloodline is
        // still allowed to replace the old one in the same request.
        if (mayConsumeForge && rejectedUnentitledNew && acceptedEntitledNew === 0 && Array.isArray(existingArr) && existingArr.length > 0) {
            return structuredClone((existingArr as unknown[]).slice(0, BLOODLINE_CAP));
        }
        return normalized;
    };
    // The live client persists savedBloodlines at the TOP LEVEL of the save
    // record; older/admin shapes nest it under character. Normalize whichever is
    // present so the per-jutsu numeric clamp (effectPower/ap/cooldown/range) + name
    // moderation actually run on real saves — the block previously read only the
    // nested copy, which is empty for live payloads. (PvP re-clamps at session
    // create, so this closes a defense-in-depth / false-confidence gap, not a live
    // hole.) The top-level copy is normalized into the return object below.
    if (Array.isArray(char.savedBloodlines)) char.savedBloodlines = normalizeBloodlineArray(char.savedBloodlines, (exChar as Record<string, unknown>).savedBloodlines, false);

    // ─── endlessTowerRun shape validation ─────────────────────────────────────
    // Run state is client-tracked then collected via save. Forged saves can
    // POST {wave: 9999, bankedRyo: 999999999, bankedXp: 999999999}. The
    // existing per-save ryo cap catches absurd ryo on the COLLECT step but
    // XP only has a rolling-window guard. Clamp the in-flight banked values
    // so the collect step can't ever credit more than these ceilings.
    const ET_BANKED_RYO_CAP = 100_000;
    const ET_BANKED_XP_CAP = 50_000;
    const ET_WAVE_CAP = 200;
    if (char.endlessTowerRun && typeof char.endlessTowerRun === 'object') {
        const run = char.endlessTowerRun as Record<string, unknown>;
        if (run.bankedRyo != null) run.bankedRyo = Math.max(0, Math.min(ET_BANKED_RYO_CAP, Number(run.bankedRyo) || 0));
        if (run.bankedXp != null) run.bankedXp = Math.max(0, Math.min(ET_BANKED_XP_CAP, Number(run.bankedXp) || 0));
        if (run.wave != null) run.wave = Math.max(0, Math.min(ET_WAVE_CAP, Math.floor(Number(run.wave) || 0)));
    }

    // ─── hollowGateRun shape bounds ───────────────────────────────────────────
    // Defense-in-depth on the persisted projection: bound absurd presentation
    // values even though the authoritative KV run owns the exact entry snapshot,
    // resources, event state, and settlement ledger.
    // A generic save cannot clear or replace an active server token. Otherwise a
    // browser could keep immediately committed run rewards while evading the
    // eventual extract/death reconciliation. Domain endpoints clear the stored
    // run directly after consuming the authoritative KV token.
    const storedHollowGateRun = exChar.hollowGateRun && typeof exChar.hollowGateRun === 'object'
        ? exChar.hollowGateRun as Record<string, unknown>
        : null;
    const storedHollowGateToken = typeof storedHollowGateRun?.runToken === 'string'
        ? storedHollowGateRun.runToken
        : '';
    const incomingHollowGateRun = char.hollowGateRun && typeof char.hollowGateRun === 'object'
        ? char.hollowGateRun as Record<string, unknown>
        : null;
    if (storedHollowGateToken && incomingHollowGateRun?.runToken !== storedHollowGateToken) {
        char.hollowGateRun = { ...storedHollowGateRun };
    } else if (storedHollowGateToken && incomingHollowGateRun) {
        for (const field of [
            'runToken', 'serverSeed', 'augmentOffers', 'chosenAugment',
            'entryCurrencies', 'keys', 'torch', 'threat', 'wardSteps',
            'secondWindArmed',
        ]) {
            if (storedHollowGateRun && field in storedHollowGateRun) incomingHollowGateRun[field] = storedHollowGateRun[field];
            else delete incomingHollowGateRun[field];
        }
    }
    if (exChar.lastHollowGateStart !== undefined) char.lastHollowGateStart = exChar.lastHollowGateStart;
    else delete char.lastHollowGateStart;

    if (char.hollowGateRun && typeof char.hollowGateRun === 'object') {
        const run = char.hollowGateRun as Record<string, unknown>;
        if (run.floor != null) run.floor = Math.max(0, Math.min(50, Math.floor(Number(run.floor) || 0)));
        if (run.keys != null) run.keys = Math.max(0, Math.min(99, Math.floor(Number(run.keys) || 0)));
        // This object is a bounded client projection of the live run. Token
        // identity, resources, movement, encounters, and its exact reward ledger
        // remain server-owned; generic saves cannot replace those fields.
        if (run.runToken != null) run.runToken = String(run.runToken).slice(0, 64);
        if (run.serverSeed != null) run.serverSeed = String(run.serverSeed).slice(0, 64);
        if (run.earnedXp != null) run.earnedXp = Math.max(0, Math.min(200_000, Math.floor(Number(run.earnedXp) || 0)));
        if (run.earnedFragments != null) run.earnedFragments = Math.max(0, Math.min(40, Math.floor(Number(run.earnedFragments) || 0)));
        if (run.earnedVeils != null) run.earnedVeils = Math.max(0, Math.min(25, Math.floor(Number(run.earnedVeils) || 0)));
        if (run.activeCombat && typeof run.activeCombat === 'object') {
            const active = run.activeCombat as Record<string, unknown>;
            const kind = String(active.kind ?? '');
            run.activeCombat = {
                runId: String(active.runId ?? '').slice(0, 96),
                nodeId: String(active.nodeId ?? '').slice(0, 96),
                floor: Math.max(1, Math.min(50, Math.floor(Number(active.floor) || 1))),
                kind: ['battle', 'elite', 'ambush', 'beast', 'boss'].includes(kind) ? kind : 'battle',
            };
        }
        if (Array.isArray(run.augmentOffers) && (run.augmentOffers as unknown[]).length > 8) {
            run.augmentOffers = (run.augmentOffers as unknown[]).slice(0, 8);
        }
    }

    // ─── Battle Towers progress array length caps ─────────────────────────────
    // These are display/convenience ledgers — the real reward gating is
    // server-side in api/towers/settle.ts (NX receipts + recompute), so a forged
    // array can't actually claim rewards. Cap length so it can't bloat KV.
    const BATTLE_TOWER_ARRAY_CAP = 500;
    for (const f of ['battleTowerClearedFloors', 'battleTowerClaimedRewards', 'battleTowerAssistRewardsClaimed']) {
        const arr = (char as Record<string, unknown>)[f];
        if (Array.isArray(arr) && arr.length > BATTLE_TOWER_ARRAY_CAP) {
            (char as Record<string, unknown>)[f] = arr.slice(0, BATTLE_TOWER_ARRAY_CAP);
        }
    }

    // ─── defeatedAiIds length cap ─────────────────────────────────────────────
    // Drives "AI Hunter" achievement variants. Hard cap so a forged save
    // can't push the array to enormous lengths and bloat KV.
    const DEFEATED_AI_IDS_CAP = 5000;
    if (Array.isArray(char.defeatedAiIds) && (char.defeatedAiIds as unknown[]).length > DEFEATED_AI_IDS_CAP) {
        char.defeatedAiIds = (char.defeatedAiIds as unknown[]).slice(-DEFEATED_AI_IDS_CAP);
    }

    // Pack inventory is bounded separately at 1,200. Progression records are
    // unique, non-packable entitlements and must survive a later client save,
    // even when earned after the pack inventory is already full.
    const TILE_CARD_CAP = CARD_COLLECTION_CAP + CHRONICLE_STARTER_GRANT_IDS.length + CHRONICLE_PROGRESSION_CARD_IDS.length;
    if (Array.isArray(char.tileCards) && (char.tileCards as unknown[]).length > TILE_CARD_CAP) {
        char.tileCards = (char.tileCards as unknown[]).slice(0, TILE_CARD_CAP);
    }
    const entitledTileCards = preserveEntitledStringArray(char.tileCards, exChar.tileCards, () => true);
    // Older clients did not always include the Chronicle field in a full-save
    // payload. Absence is not an explicit request to consume the collection:
    // retain the stored cards so a legacy tab cannot erase server-earned
    // records merely by saving another part of the character.
    const tileCardsToKeep = entitledTileCards ?? (Array.isArray(exChar.tileCards)
        ? (exChar.tileCards as unknown[]).filter((id): id is string => typeof id === 'string')
        : null);
    if (tileCardsToKeep) {
        // Generic saves may consume ordinary cards, but a stale tab, recovery
        // draft, or forged client must never erase a server-earned Chronicle
        // record. Keep one copy of every existing progression entitlement and
        // reserve the independent 1,200-card budget for packable inventory.
        const nextCards: string[] = [];
        const keptProgression = new Set<string>();
        for (const id of tileCardsToKeep) {
            if (isChronicleProgressionCardId(id)) {
                if (!keptProgression.has(id)) {
                    keptProgression.add(id);
                    nextCards.push(id);
                }
            } else nextCards.push(id);
        }
        if (Array.isArray(exChar.tileCards)) {
            for (const raw of exChar.tileCards) {
                if (typeof raw !== 'string' || !isChronicleProgressionCardId(raw) || keptProgression.has(raw)) continue;
                keptProgression.add(raw);
                nextCards.push(raw);
            }
        }
        char.tileCards = trimChronicleCardsToPackableCap(nextCards);
    }

    // A stale deck is preserved until the player explicitly saves a legal
    // current-rules replacement. Forged, malformed or unowned submissions can
    // never overwrite the last valid deck.
    if ('cardClashDeck' in char) {
        const requestedDeck = Array.isArray(char.cardClashDeck)
            ? char.cardClashDeck.filter((id): id is string => typeof id === 'string')
            : [];
        const ownedCards = countChronicleCardsWithStarter(
            Array.isArray(char.tileCards)
                ? char.tileCards.filter((id): id is string => typeof id === 'string')
                : [],
        );
        if (validateDeckIds(requestedDeck, ownedCards).valid) {
            char.cardClashDeck = requestedDeck;
        } else if (Array.isArray(exChar.cardClashDeck)) {
            char.cardClashDeck = structuredClone(exChar.cardClashDeck);
        } else {
            delete char.cardClashDeck;
        }
    }
    if ('cardClashTutorialVersion' in char) {
        char.cardClashTutorialVersion = Math.max(
            0,
            Math.min(
                CHRONICLE_RULES_VERSION,
                Math.floor(Number(char.cardClashTutorialVersion) || 0),
            ),
        );
    }

    // ─── battleHistory caps ───────────────────────────────────────────────────
    // Display-only "recent fights" reflection log (Profile → Battles). Carries no
    // rewards, so it needs no reward gating — just bound the size so a forged
    // save can't bloat KV: cap the number of battles kept and the actions per
    // battle. Keep the newest entries (client stores newest-first).
    const BATTLE_HISTORY_CAP = 10;
    const BATTLE_ACTIONS_CAP = 120;
    if ('battleHistory' in char) {
        if (!Array.isArray(char.battleHistory)) {
            delete (char as Record<string, unknown>).battleHistory;
        } else {
            char.battleHistory = (char.battleHistory as Array<Record<string, unknown>>)
                .slice(0, BATTLE_HISTORY_CAP)
                .map((b) => {
                    if (b && Array.isArray((b as { actions?: unknown }).actions) && (b.actions as unknown[]).length > BATTLE_ACTIONS_CAP) {
                        return { ...b, actions: (b.actions as unknown[]).slice(-BATTLE_ACTIONS_CAP) };
                    }
                    return b;
                });
        }
    }

    // Admin-only "creator" content (jutsus / items / AIs / missions / events /
    // cards / raids) should NEVER live on a player save. The legitimate
    // source of truth is save:admin*. If a tampered client tries to inject
    // these fields into a non-admin save, strip them outright so they can't
    // round-trip into anyone's gameplay state.
    for (const field of FORBIDDEN_CREATOR_CHARACTER_FIELDS) delete char[field];

    // Daily-claim date stamps (claimedVillageAgendaDate / claimedMapControlDate)
    // gate once-per-UTC-day rewards on the client. If the client could write
    // any string here, a player rolling their system clock could "claim,
    // unclaim, claim again" by setting the stamp to a different date. Lock
    // these to the server's actual UTC today: incoming may either be empty
    // (no claim today) or exactly the server's date string. Any other value
    // (a future date, last week, "1970-01-01", etc.) is forced back to
    // whatever was previously stored, so the legitimate-today claim still
    // survives but backdating doesn't.
    const SERVER_UTC_DATE = new Date().toISOString().slice(0, 10);
    // warGroundBountyDate gates the once-per-UTC-day War Ground bounty (+500
    // ryo, +1 Fate Shard — see App.tsx). Same backdating risk as the other
    // daily-claim stamps: setting it to a different date re-opens the bounty.
    // Locked to the server's UTC today by the same rule below. (audit #12)
    // DAILY_CLAIM_DATE_FIELDS derives from the ownership manifest
    // ('daily-claim-date-char').
    for (const field of DAILY_CLAIM_DATE_FIELDS) {
        const incomingDate = char[field];
        if (typeof incomingDate !== 'string' || incomingDate === '') continue;
        if (incomingDate !== SERVER_UTC_DATE) {
            // Either a forged future date or a backdated reset. Revert to
            // the existing server-side value (which itself can only have
            // been set by a legit prior pass through this same check).
            char[field] = exChar[field] ?? '';
        }
    }

    // War-Ground bounty server floor (audit #21). The bounty (+500 ryo, +1 Fate
    // Shard) is gated client-side by warGroundBountyDate. The date-stamp lock
    // above stops BACKDATING the stamp, but a tampered client could keep the
    // stamp at today AND re-add the +500 ryo / +1 fate shard to its wallet on a
    // later autosave — a within-day re-mint. Defense-in-depth: if the SERVER-
    // stored save already shows the bounty claimed today
    // (exChar.warGroundBountyDate === SERVER_UTC_DATE), ryo and fateShards may
    // not GROW from this save (mirrors the dailyHollowGateRuns / dailyMissions-
    // Completed monotonic-floor pattern, but in the can't-grow direction — the
    // bounty already paid out today). Decreases (spending) pass through freely.
    // On a real new day exChar's stamp != today so this is skipped and the
    // fresh bounty claim is untouched. NOTE: legit non-bounty ryo/fateShard
    // gains (mission/fight rewards) that land in the SAME save as a duplicate
    // bounty attempt are also held to the stored value here — but those
    // currencies flow through server-authoritative endpoints under the save lock
    // (claim-mission, pvp/claim-rewards), so by the time an autosave runs the
    // stored value already reflects them and this clamp is a no-op re-assert for
    // honest play.
    if (exChar.warGroundBountyDate === SERVER_UTC_DATE) {
        const exRyoFloor = Math.max(0, Number(exChar.ryo ?? 0));
        char.ryo = Math.min(Math.max(0, Number(char.ryo) || 0), exRyoFloor);
        const exFateFloor = Math.max(0, Number(exChar.fateShards ?? 0));
        char.fateShards = Math.min(Math.max(0, Number(char.fateShards) || 0), exFateFloor);
    }

    // Hollow Gate daily run cap (dailyHollowGateRuns) is gated client-side via
    // lastDailyReset. Defense-in-depth: if the SERVER-stored save was last written
    // today (exChar.lastDailyReset === SERVER_UTC_DATE), the run count can only go
    // UP within the day — so a forged save can't reset it to 0 to farm extra runs.
    // On a real new day exChar.lastDailyReset != today, the floor is 0, and the
    // legit daily reset is untouched. (A determined tamper that ALSO backdates
    // lastDailyReset resets all the player's other daily counters too, so it is
    // self-limiting; a fully server-authoritative cap would need a dedicated
    // server-stamped HG date field.)
    if (exChar.lastDailyReset === SERVER_UTC_DATE) {
        const floorRuns = Math.max(0, Math.floor(Number(exChar.dailyHollowGateRuns ?? 0)));
        const incomingRuns = Math.max(0, Math.floor(Number(char.dailyHollowGateRuns ?? 0)));
        char.dailyHollowGateRuns = Math.max(incomingRuns, floorRuns);
    }

    // Daily-reset stamps (lastDailyReset / lastHuntReset) gate the per-day
    // mission / hunt / AI-kill / fate-spin counters. They only ever ADVANCE — a
    // real day roll moves them forward. A tampered save that BACKDATES one resets
    // every daily counter it gates (re-opening the claim-mission daily cap [audit
    // #1] and, via lastDailyReset, the Hollow Gate run cap [audit #7]). Force them
    // monotonic-forward: an incoming date older than the stored one is reverted to
    // the stored value, so the backdate can't persist. A forward move to a newer
    // date (the legit midnight reset) is untouched, as is the first-ever set.
    for (const field of MONOTONIC_DATE_CHARACTER_FIELDS) {
        const stored = typeof exChar[field] === 'string' ? (exChar[field] as string) : '';
        const incoming = typeof char[field] === 'string' ? (char[field] as string) : '';
        if (stored && incoming && incoming < stored) char[field] = stored;
    }

    // Daily mission / hunt completion counters are the ONLY thing bounding the
    // server-authoritative claim-mission payouts (api/missions/claim-mission.ts),
    // which write ryo + premium currency directly under the save lock — bypassing
    // this endpoint's per-save ryo/currency caps. So if the client could zero
    // these mid-day it could re-claim the highest-value missions unbounded (audit
    // #1). Floor them at the server-stored value within the same UTC day
    // (monotonic-up, exactly like dailyHollowGateRuns above); the legit midnight
    // reset is preserved because on a real new day exChar's stamp != today, so
    // the floor is skipped and the counter is free to drop to 0.
    if (exChar.lastDailyReset === SERVER_UTC_DATE) {
        const floorM = Math.max(0, Math.floor(Number(exChar.dailyMissionsCompleted ?? 0)));
        const inM = Math.max(0, Math.floor(Number(char.dailyMissionsCompleted ?? 0)));
        char.dailyMissionsCompleted = Math.max(inM, floorM);
        // dailyPetWins is the same shape of guard for the pet-arena ryo faucet:
        // api/pet/battle-result.ts and api/pet/showdown.ts read this counter
        // straight off the save to decide whether the 100/day cap is spent, so a
        // save carrying a lower value re-opens the cap for another hundred wins.
        // It does not even take a tampered client — a second tab holding a stale
        // count zeroes it on its next autosave.
        const floorP = Math.max(0, Math.floor(Number(exChar.dailyPetWins ?? 0)));
        const inP = Math.max(0, Math.floor(Number(char.dailyPetWins ?? 0)));
        char.dailyPetWins = Math.max(inP, floorP);
    }
    if (exChar.lastHuntReset === SERVER_UTC_DATE) {
        const floorH = Math.max(0, Math.floor(Number(exChar.dailyHuntsCompleted ?? 0)));
        const inH = Math.max(0, Math.floor(Number(char.dailyHuntsCompleted ?? 0)));
        char.dailyHuntsCompleted = Math.max(inH, floorH);
    }

    // academy-trial is a one-time onboarding claim (claim-mission academy-trial
    // path, off the daily cap). Latch it: once the server-stored save has it
    // claimed, a forged save can't flip it back to false to re-claim. (audit #1)
    if (exChar.academyTrialClaimed === true) char.academyTrialClaimed = true;

    // Hospital timer enforcement.
    //   - If save flips hospitalized false → true, server stamps both
    //     hospitalizedUntil AND hospitalizedAt. The latter is read by
    //     api/player/heal.ts to award the +50% Healer raid-assist XP
    //     bonus when a Healer reaches a freshly-hospitalized friendly.
    //   - If save flips hospitalized true → false before the timer expires, revert
    //     (with HP at zero — exactly the state they were in when admitted).
    //   - Discharge (genuine or rejected) always goes through api/player/heal,
    //     not this validator — see Hospital.tsx::discharge(). This validator
    //     is the fallback that catches client-only attempts to flip the flag.
    const exHosp = !!exChar.hospitalized;
    const inHosp = !!char.hospitalized;
    const exHospUntil = Number(exChar.hospitalizedUntil ?? 0);
    const exHospAt = Number(exChar.hospitalizedAt ?? 0);
    if (!exHosp && inHosp) {
        const now = Date.now();
        // Discharge-race guard: if the server JUST discharged this player
        // (heal / paid skip / free checkout, all via api/player/heal.ts, which
        // stamps lastDischargeAt), an incoming save still flagged hospitalized
        // is a stale pre-discharge replay racing the discharge. Honor the
        // discharge instead of re-admitting them with a fresh timer.
        const lastDischargeAt = Number(exChar.lastDischargeAt ?? 0);
        if (lastDischargeAt > 0 && now - lastDischargeAt < DISCHARGE_GRACE_MS) {
            char.hospitalized = false;
            char.hospitalizedUntil = 0;
            char.hospitalizedAt = 0;
            // Preserve the marker so any further stale saves in the same window
            // are caught too (mergePreservingImages would keep it anyway, but be
            // explicit — char is what the rest of the validator reasons about).
            char.lastDischargeAt = lastDischargeAt;
        } else {
            char.hospitalizedUntil = now + HOSPITAL_DURATION_MS;
            char.hospitalizedAt = now;
        }
    } else if (exHosp && !inHosp) {
        if (exHospUntil && Date.now() < exHospUntil) {
            // Reject early discharge — force the player to wait out the timer
            // or go through /api/player/heal (which charges ryo server-side
            // when paySkip=true, or applies the Healer rank-shortened timer).
            char.hospitalized = true;
            char.hospitalizedUntil = exHospUntil;
            char.hospitalizedAt = exHospAt;
            // Snap HP back to 0 so they can't farm hp during the lockout.
            char.hp = 0;
        } else {
            // Timer expired or unset — allow discharge and clear both stamps.
            char.hospitalizedUntil = 0;
            char.hospitalizedAt = 0;
        }
    } else if (exHosp && inHosp) {
        // Preserve the original stamps and the KO itself. The client has an
        // idle-vitals clock, so a stale or modified client can otherwise send
        // hospitalized:true with regenerated HP and autosave its way off zero
        // while it is still admitted.
        char.hospitalizedUntil = exHospUntil || char.hospitalizedUntil;
        char.hospitalizedAt = exHospAt || char.hospitalizedAt;
        char.hp = 0;
    }

    // ─── creatorItems normalization (top-level, persisted) ─────────────────────
    // Player-forged Named Weapons / armor live on the save at the TOP LEVEL
    // (incoming.creatorItems), NOT under .character — so the character sanitizer
    // above never touched them and they round-tripped UNVALIDATED. A forged save
    // could store a Named Weapon with weaponEp 999999 / arbitrary tags, and the
    // weapon name (echoed into the public PvP battle log) bypassed the moderation
    // the bloodline/jutsu names get. Clamp numerics, whitelist tags/element/
    // quality, moderate player text, strip inline SVG / oversized images —
    // mirroring the savedBloodlines normalizer above + sanitizePvpItems. (PvP
    // also re-clamps these at session-create, so this is storage-side defense in
    // depth + name moderation.) The `delete char.creatorItems` above only strips
    // an admin-content injection from the .character sub-object; players
    // legitimately own this top-level array, so it is kept (sanitized).
    const CREATOR_ITEM_CAP = 500;
    const VALID_WEAPON_ELEMENTS = new Set(['', 'Earth', 'Wind', 'Water', 'Lightning', 'Fire', 'Yin', 'Yang']);
    const VALID_WEAPON_EFFECT_TARGETS = new Set(['self', 'opponent', 'enemy', 'both']);
    const KNOWN_ARMOR_QUALITIES = new Set(['Standard', 'Reinforced', 'Rare', 'Elite', 'Legendary', 'Mythic']);
    let sanitizedCreatorItems: unknown;
    if (Array.isArray(incoming.creatorItems)) {
        sanitizedCreatorItems = (incoming.creatorItems as Array<Record<string, unknown>>)
            .slice(0, CREATOR_ITEM_CAP)
            .map((item) => {
                if (!item || typeof item !== 'object') return {};
                const out: Record<string, unknown> = { ...item };
                // Player-authored text — moderate + length-cap (the name appears
                // in the public PvP battle log; description/flavor in tooltips).
                if (typeof out.name === 'string') out.name = sanitizeUserText(out.name, TEXT_LIMITS.storyName);
                if (typeof out.description === 'string') out.description = sanitizeUserText(out.description, TEXT_LIMITS.description);
                if (typeof out.flavorText === 'string') out.flavorText = sanitizeUserText(out.flavorText, TEXT_LIMITS.description);
                // Strip inline SVG / oversized images — same rule as bloodlines
                // (shared image storage hosts real images via /api/images). A
                // normal small data-URL / reference is preserved.
                if (typeof out.image === 'string') {
                    const img = out.image;
                    if (/^data:image\/svg/i.test(img) || img.length > RAW_BLOODLINE_IMAGE_MAX_BYTES) out.image = undefined;
                }
                // Weapon numerics — match sanitizePvpItems bounds (api/pvp/session.ts).
                // Match the authoritative PvP item ceiling. Named weapons roll
                // 30-35 EP, so 60 preserves legitimate/custom headroom while
                // preventing a persisted 600-EP item from dominating PvE modes.
                if (out.weaponEp != null) out.weaponEp = Math.max(0, Math.min(60, Number(out.weaponEp) || 0));
                if (out.weaponRange != null) out.weaponRange = Math.max(0, Math.min(30, Number(out.weaponRange) || 0));
                if (out.weaponCooldown != null) out.weaponCooldown = Math.max(0, Math.min(30, Number(out.weaponCooldown) || 0));
                if (out.apCost != null) out.apCost = Math.max(0, Math.min(200, Number(out.apCost) || 40));
                if (out.weaponEffectValue != null) out.weaponEffectValue = Math.max(0, Math.min(100, Number(out.weaponEffectValue) || 0));
                if (out.restoreChakra != null) out.restoreChakra = Math.max(0, Math.min(5000, Number(out.restoreChakra) || 0));
                if (out.restoreStamina != null) out.restoreStamina = Math.max(0, Math.min(5000, Number(out.restoreStamina) || 0));
                // weaponTags — whitelist + clamp + cap (same as sanitizePvpItems).
                if (out.weaponTags != null) {
                    const rawTags = Array.isArray(out.weaponTags) ? out.weaponTags : [];
                    out.weaponTags = (rawTags as unknown[])
                        .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
                        .filter((t) => typeof t.name === 'string' && KNOWN_TAG_NAMES.has(String(t.name)))
                        .map((t) => {
                            const tag: Record<string, unknown> = { name: canonicalTagName(String(t.name)) };
                            if (t.percent != null) tag.percent = Math.max(0, Math.min(100, Number(t.percent) || 0));
                            return tag;
                        })
                        .slice(0, 10);
                }
                // Whitelisted enums — drop a single bad field, not the whole item.
                if (out.weaponEffect != null) {
                    if (KNOWN_TAG_NAMES.has(String(out.weaponEffect))) out.weaponEffect = canonicalTagName(String(out.weaponEffect));
                    else delete out.weaponEffect;
                }
                if (out.weaponElement != null && !VALID_WEAPON_ELEMENTS.has(String(out.weaponElement))) delete out.weaponElement;
                if (out.weaponEffectTarget != null && !VALID_WEAPON_EFFECT_TARGETS.has(String(out.weaponEffectTarget))) delete out.weaponEffectTarget;
                if (out.armorQuality != null && !KNOWN_ARMOR_QUALITIES.has(String(out.armorQuality))) delete out.armorQuality;
                // Bonus stat grants — clamp each numeric to a sane ceiling so a
                // forged item can't ship a 999999 stat (PvP also caps total stats
                // at MAX_STAT, this is storage hygiene).
                if (out.bonuses && typeof out.bonuses === 'object') {
                    // sub-5: clamp custom-item bonuses to the maximum legitimate
                    // built-in/Named-Armor envelope. Honest forge rolls are no-ops;
                    // forged passives, shields, vitals, and specialty totals are bounded.
                    return budgetItemBonuses(out);
                }
                return out;
            });
    }

    const finalChar = isFirstSave ? applyCanonicalFirstSave(char) : char;
    enforceRawSaveLedgerBoundary(finalChar, exChar, isFirstSave, inChar);

    // ── Patreon subscriber perk caps (authoritative) ──────────────────────────
    // Runs AFTER the ledger boundary, so finalChar.patreon is the stored,
    // un-forgeable flag and these caps are the final word regardless of
    // STRICT_RAW_SAVE_LEDGER. The base tier is intentionally lower than the
    // subscriber tier (see api/_entitlements.ts):
    //   • jutsu loadout: 12 (base) / 15 (subscriber). The legacy 16th slot is a
    //     separate additive field and is unaffected.
    //   • custom avatar: subscribers only. A non-subscriber may keep an already-
    //     stored avatar (grandfathered), switch to a preset, or carry the
    //     reference URL for their OWN published shared image, but a NEW custom
    //     value is reverted to the stored one (avatarImage is otherwise
    //     unvalidated on write). The own-reference carve-out is load-bearing:
    //     without it the client's hydrated "/api/img?id=avatar:<name>" pointer
    //     read as a new custom upload and was deleted on EVERY save, so no
    //     non-subscriber's save ever carried an avatar and their own UI fell
    //     back to initials until the shared-image manifest happened to land.
    // (Pet roster growth is capped above via maxPets(exChar), while an already-
    // stored larger roster is preserved non-destructively.)
    {
        const fc = finalChar as Record<string, unknown>;
        if (Array.isArray(fc.equippedJutsuIds)) {
            const cap = maxLoadout(fc);
            fc.equippedJutsuIds = [...new Set(
                (fc.equippedJutsuIds as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0),
            )].slice(0, cap);
        }
        if (!isPatreonSubscriber(fc)) {
            const incomingAvatar = fc.avatarImage;
            const storedAvatar = (exChar as Record<string, unknown>).avatarImage;
            const allowedWithoutSub = isPresetAvatar(incomingAvatar)
                || isOwnAvatarReference(incomingAvatar, fc.name);
            if (typeof incomingAvatar === 'string' && !allowedWithoutSub && incomingAvatar !== storedAvatar) {
                if (typeof storedAvatar === 'string') fc.avatarImage = storedAvatar;
                else delete fc.avatarImage;
            }
        }
    }

    const out: Record<string, unknown> = { ...incoming, character: finalChar };
    // Stat training is server-created and server-cleared. A generic autosave
    // cannot forge, replace, or replay the top-level session descriptor.
    if (!isFirstSave) out.activeTraining = existing?.activeTraining ?? null;
    if (!isFirstSave) out.activeJutsuTraining = existing?.activeJutsuTraining ?? null;
    if (Array.isArray(incoming.savedBloodlines)) out.savedBloodlines = normalizeBloodlineArray(incoming.savedBloodlines, existing?.savedBloodlines, true);
    grantOwnedBloodlineJutsuMastery(finalChar, out.savedBloodlines);
    // Server-owned, single-use purchase ledger. Incoming copies are ignored.
    out.pendingBloodlineForges = pendingBloodlineForges.filter((entry) => !consumedBloodlineForgeIds.has(entry.id));
    // On an admin content slot the rule inverts: strip forged gear instead of
    // preserving it, so the shared-content store can never accumulate (or
    // re-acquire) a personal item that would then be published to everyone.
    // Admin authoring remains writable in strict release mode; strict raw-save
    // ownership applies to player economy, not the authenticated content store.
    if (opts.adminContentSlot) out.creatorItems = stripForgedItems(sanitizedCreatorItems ?? existing?.creatorItems);
    else if (isFirstSave) out.creatorItems = [];
    else if (strictLedger) out.creatorItems = Array.isArray(existing?.creatorItems) ? existing.creatorItems : [];
    else if (sanitizedCreatorItems !== undefined) out.creatorItems = preserveForgedItems(sanitizedCreatorItems, existing?.creatorItems, CREATOR_ITEM_CAP);
    for (const field of SERVER_LEDGER_TOPLEVEL_FIELDS) {
        if (opts.adminContentSlot && SHARED_ADMIN_CONTENT_FIELDS.includes(field)) continue;
        if (existing && Object.prototype.hasOwnProperty.call(existing, field)) out[field] = existing[field];
        else delete out[field];
    }
    if (!opts.adminContentSlot) {
        delete out.creatorMissions;
        delete out.creatorRaids;
        if (Array.isArray(out.creatorEvents)) out.creatorEvents = out.creatorEvents.filter(isReleaseSafeCreatorEvent);
    }
    // World-geography version (the 2026-07 sector renumbering) is server-owned:
    // carry the stored stamp, and stamp brand-new saves current (they are born
    // post-reorg). A pre-reorg record is only ever POSTed after a GET migrated
    // it (api/_elapsed-state.ts settleSaveRecord), so an unstamped `existing`
    // means "new world" here, never "needs remap".
    out.worldGeoV = existing && Object.prototype.hasOwnProperty.call(existing, 'worldGeoV')
        ? existing.worldGeoV
        : WORLD_GEO_VERSION;
    return out;
}

// ── Clan / village identity lockdown ──────────────────────────────────────
// Three character fields gate critical permissions and were previously
// trusted blindly from the client save POST:
//   - `clanFounder` is read by api/clan/seal-pool/distribute.ts to authorise
//     pool drains. A client POST with { clanFounder: true, clan: "TARGET" }
//     used to be enough to take over any clan's distribution.
//   - `clan` decides which clan you contribute to, vote in, and donate to.
//   - `village` decides which sealed pools, kage finales, and same-village
//     gates apply to you.
//
// We can't lock these outright — there are legitimate transitions (joining /
// founding / leaving a clan) — so this helper cross-checks any change
// against the canonical `save:clan-<slug>` record and the originating
// village. Async because it reads other KV keys; called AFTER the sync
// sanitizer so all other fields are already clamped.
function clanRecordSlug(name: string): string {
    return 'clan-' + name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// #14 telemetry — count player saves that arrive WITHOUT a `_baseSaveVersion`
// stamp (old/stale clients; the current client always echoes it on its
// own-save autosave paths). Best-effort daily counter so an operator can watch
// the per-day total trend toward zero before making the multi-tab guard
// mandatory. This key has the `telemetry:` prefix, so it lives on the BASE
// store (Supabase/pg `public.kv_store`), NOT the disk overlay — the /api/kv
// proxy reads only the disk overlay and would always return null for it, so do
// NOT read it there. Read the base store directly, e.g.
//   SELECT value FROM public.kv_store WHERE key = 'telemetry:save-noversion:<UTC-date>';
// RMW is non-atomic (kv has no incr) — fine for a trend signal — and only runs
// on the missing path, so steady-state overhead is zero once clients roll over.
const SAVE_NOVERSION_TELEMETRY_TTL_SEC = 45 * 24 * 60 * 60; // 45 days
async function recordMissingSaveVersion(playerName: string): Promise<void> {
    try {
        const key = saveVersionTelemetryKey(new Date().toISOString());
        const cur = (await kv.get<{ count?: number }>(key)) ?? {};
        await kv.set(
            key,
            { count: Number(cur.count ?? 0) + 1, lastPlayer: playerName, lastAt: Date.now() },
            { ex: SAVE_NOVERSION_TELEMETRY_TTL_SEC },
        );
    } catch {
        // Telemetry is best-effort and MUST NOT affect the save outcome.
    }
}

type MinimalClanRec = { name?: string; founderName?: string; members?: Array<{ name?: string }> };

async function validateClanAndVillageIdentity(
    safeIncoming: Record<string, unknown>,
    existing: Record<string, unknown> | null,
    playerName: string,
): Promise<Record<string, unknown>> {
    const inChar = safeIncoming.character as Record<string, unknown> | undefined;
    if (!inChar) return safeIncoming;
    const exChar = (existing?.character as Record<string, unknown> | undefined) ?? {};
    const out: Record<string, unknown> = { ...inChar };

    // Village: locked. Set at registration; no relocation flow exists today.
    // If the client tries to change village post-registration, revert to the
    // server-side value. (If a relocate endpoint is ever added, it should
    // mutate the save server-side and this check will still pass because
    // exChar.village will already reflect the new value.)
    if (exChar.village && out.village !== exChar.village) {
        out.village = exChar.village;
    }

    // Clan / clanFounder cross-validation.
    const exClan = String(exChar.clan ?? '').trim();
    const inClan = String(out.clan ?? '').trim();
    const exFounder = !!exChar.clanFounder;
    const inFounder = !!out.clanFounder;

    if (inClan === exClan) {
        // Clan unchanged — but founder flag may still be flipping. A client
        // can't unilaterally promote itself to founder of its existing clan.
        if (inFounder !== exFounder) {
            if (inFounder && inClan) {
                const rec = await kv.get<MinimalClanRec>(`save:${clanRecordSlug(inClan)}`);
                // playerName is the safeName slug; founderName is a stored
                // display name — canonicalize it through safeName to compare.
                const isFounder = safeName(rec?.founderName ?? '') === playerName;
                if (!isFounder) out.clanFounder = exFounder;
            } else {
                // Demoting self (inFounder=false): always allowed.
            }
        }
    } else if (!inClan) {
        // Leaving — always allowed; force founder false.
        out.clan = undefined;
        out.clanFounder = false;
    } else {
        // Joining or switching — require the target clan record to exist
        // AND list this player among its members. The clan flow writes
        // membership server-side BEFORE the character flip, so a legit
        // join will pass; a forged save POST will not.
        const rec = await kv.get<MinimalClanRec>(`save:${clanRecordSlug(inClan)}`);
        // playerName is already the safeName slug; member/founder names are
        // stored display names, so canonicalize them through safeName to compare.
        const slug = playerName;
        const isMember = !!rec?.members?.some(m => safeName(m?.name ?? '') === slug);
        if (!isMember) {
            // Reject the clan change entirely.
            out.clan = exClan || undefined;
            out.clanFounder = exFounder;
        } else {
            // Membership confirmed. Founder flag is authoritative from the
            // clan record, not the client.
            out.clanFounder = safeName(rec?.founderName ?? '') === slug;
        }
    }

    return { ...safeIncoming, character: out };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();

    // Player saves must NEVER be cached. The GET is authed via custom headers
    // (x-player-name / x-player-password) that Cloudflare doesn't treat as a
    // cache-bypass signal, so a broad edge cache rule could otherwise serve a
    // stale save (training set on one device missing on another) — or worse,
    // serve one player's save to another keyed only on the URL. no-store on
    // every response (GET reads, POST/DELETE writes) closes that off.
    res.setHeader('Cache-Control', 'no-store');

    const name = safeName(String(req.query.name ?? ''));
    if (!name) return res.status(400).json({ error: 'Invalid name.' });

    const key = `save:${name}`;
    // Clan saves use `save:clan-<slug>` keys — they're shared per-clan, so any
    // logged-in player may read/write them. Admin actions still flow through
    // ?signal=1 which requires admin auth.
    const isClanSave = name.startsWith('clan-');

    if (req.method === 'GET') {
        // Reads require *some* auth — stops anonymous bots from scraping every
        // player's save by guessing names. Logged-in players can still read
        // other players' saves (needed for PvP opponent loading, clan record
        // lookups, etc.) but at least we know who's doing it.
        // Sensitive economy fields (ryo, inventory, etc.) are stripped for non-owners.
        const identity = await authedPlayerOrAdmin(req, name);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        const stored = await kv.get<Record<string, unknown>>(key);
        if (stored === null) return res.status(404).end();

        // Who is reading decides whether the settle is WRITTEN BACK.
        const adminCanReadTarget = identity.admin
            && adminSaveTargetAllowed(name, isFullAdmin(req), isAdmin(req));
        const isOwner = adminCanReadTarget || isClanSave || (!identity.admin && identity.name === name);

        // Settling projects elapsed time (vitals regen, travel leases, an expired
        // Hollow Gate run) and persisting it BUMPS `_saveVersion`.
        //
        // Only persist for the OWNER. Any logged-in player may read any save — PvP
        // scouting and profile views both do — and vitals tick every second, so a
        // foreign read of a save that was below full HP reliably wrote a new version
        // for a player who was not part of the request and got no notification. Their
        // very next autosave then echoed a now-stale `_baseSaveVersion`, took a 409,
        // and the client's conflict recovery discarded local progress: an opponent
        // opening your profile could roll your game back. It scaled with player count.
        //
        // `persist: false` still RETURNS the settled projection, so a foreign reader
        // sees correct regen — only the durable write is skipped, and the owner's own
        // next read or save persists it.
        const data = isClanSave
            ? stored
            : (await settleSaveRecordForRead(name, stored, { persist: isOwner })).record;

        // Project the save by reader.
        // - Owners + authorized admins + clan saves: full save (combatOnly just
        //   trims combat-irrelevant fields for bandwidth).
        // - Anyone else: an explicit ROOT + CHARACTER allowlist DTO
        //   (buildPublicSaveDTO). Nothing leaks unless it is named there —
        //   closing the old spread that shipped every top-level field
        //   (savedBloodlines, creator*, activeTraining, missionProgress,
        //   currentSector, triggeredEvents, _saveVersion, and any future field)
        //   to any logged-in player. The server hydrates real opponent combat
        //   data from save:<name> directly when PvP sessions are created, so a
        //   foreign reader never needs the private loadout.
        //
        // ?combatOnly=1 additionally exposes the minimal combat-scouting fields
        // the live client's fetchPlayerCombatSave consumes (see
        // PUBLIC_COMBAT_TOPLEVEL_FIELDS) and, for owners, trims mission /
        // achievement / lifetime-counter fields combat never reads.
        // identity.name and `name` are both safeName slugs, so a direct compare
        // correctly recognises the owner.
        const combatOnly = req.query.combatOnly === '1';
        let payload: Record<string, unknown>;
        if (isOwner) {
            payload = combatOnly ? combatProjection(data) : data;
        } else {
            // Admin content slots additionally expose the shared authored-content
            // root fields, which every client needs to hydrate custom jutsu /
            // items / events / cards. See SHARED_ADMIN_CONTENT_FIELDS.
            payload = buildPublicSaveDTO(data, { combat: combatOnly, sharedContent: isAdminContentSlot(name) });
        }
        return res.status(200).json(payload);
    }

    if (req.method === 'POST') {
        try {
            // Body size guard. We strip image fields server-side post-parse,
            // but a multi-MB body still has to be parsed (synchronous work
            // on a tight Vercel cold-start budget). Cap incoming payloads at
            // 1 MB — any legit save is under ~100 KB after image stripping
            // and the client already strips embedded images before POSTing.
            const contentLengthHeader = req.headers['content-length'];
            const contentLength = Array.isArray(contentLengthHeader) ? Number(contentLengthHeader[0]) : Number(contentLengthHeader);
            if (Number.isFinite(contentLength) && contentLength > 1_000_000) {
                return res.status(413).json({ error: 'Save payload too large. Strip embedded images and retry.' });
            }
            const resetSignalKey = `reset-signal:${name.toLowerCase()}`;
            const adminLockKey = `admin-lock:${name.toLowerCase()}`;
            if (req.query.ack === '1') {
                // Ack just clears two short-lived keys for this player.
                const ackIdentity = await authedPlayerOrAdmin(req, name);
                if (!ackIdentity) return res.status(401).json({ error: 'Authentication required.' });
                if (ackIdentity.admin && !adminSaveTargetAllowed(name, isFullAdmin(req), isAdmin(req))) {
                    return res.status(403).json({ error: 'Full admin authentication required for that save.' });
                }
                if (!ackIdentity.admin && !isClanSave && ackIdentity.name !== name) {
                    return res.status(403).json({ error: 'Cannot ack another player.' });
                }
                await Promise.all([
                    kv.del(resetSignalKey),
                    kv.del(adminLockKey),
                ]);
                return res.status(200).json({ ok: true });
            }

            const isAdminSave = req.query.signal === '1';
            const parsed = parseJsonBody(req.body);
            if (!parsed.ok) return res.status(400).json({ error: parsed.error });
            const incoming = parsed.body;
            if (!incoming || typeof incoming !== 'object') {
                return res.status(400).json({ error: 'Invalid save payload.' });
            }

            // Admin-flagged writes require admin auth (constant-time compare in isAdmin).
            let identityName: string | null = null;
            if (isAdminSave) {
                if (!adminSaveTargetAllowed(name, isFullAdmin(req), isAdmin(req))) {
                    return res.status(401).json({ error: 'Admin authentication required.' });
                }
            } else {
                // Non-admin saves: player can save their own; clan saves are
                // gated by clan membership (the actor's character.clan must
                // match the clan-<slug> being written).
                const identity = await authedPlayerOrAdmin(req, name);
                if (!identity) return res.status(401).json({ error: 'Authentication required.' });
                if (identity.admin && !adminSaveTargetAllowed(name, isFullAdmin(req), isAdmin(req))) {
                    return res.status(403).json({ error: 'Full admin authentication required for that save.' });
                }
                if (!identity.admin && !isClanSave && identity.name !== name) {
                    return res.status(403).json({ error: 'Cannot save another player.' });
                }
                if (!identity.admin && isClanSave) {
                    // Verify the actor belongs to this clan before letting them
                    // mutate the shared clan record. The clan slug here is
                    // whatever follows "clan-" in the key path.
                    try {
                        const targetClanSlug = name.replace(/^clan-/, '').trim().toLowerCase();
                        const actorSave = await kv.get<Record<string, unknown>>(`save:${identity.name}`);
                        const actorChar = (actorSave?.character ?? null) as Record<string, unknown> | null;
                        const actorClan = String(actorChar?.clan ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
                        if (!actorClan || actorClan !== targetClanSlug) {
                            // Membership check failed — but allow the write
                            // through if the clan record doesn't yet exist
                            // AND the incoming body declares this player as
                            // its founder. This covers two legitimate cases
                            // the membership check would otherwise reject:
                            //
                            //   • First-time creation via "Create Clan" —
                            //     the clan record is written before the
                            //     character's clan field syncs server-side.
                            //   • Reclaim after a server reset wiped the
                            //     previous save:clan-<slug> record.
                            //
                            // First-claimer-wins semantics. Once a record
                            // exists, the membership check is the only path.
                            const existingClan = await kv.get<Record<string, unknown>>(key);
                            const incomingBody = incoming as Record<string, unknown>;
                            const bodyFounder = safeName(String(incomingBody?.founderName ?? ''));
                            const allowCreate = !existingClan && bodyFounder && bodyFounder === identity.name;

                            // Non-member self-join-request carve-out. A player
                            // who isn't in this clan must still be able to send a
                            // join REQUEST — otherwise "Request Join" is
                            // impossible, since the only way the client records a
                            // request is by appending to the clan's shared
                            // joinRequests array (this very POST). The per-field
                            // validator (validateClanSaveWrite) already permits a
                            // non-member to add ONLY their own joinRequests entry
                            // and suppresses every other field, but it never ran
                            // because this membership gate rejected the write
                            // first. Allow the write through only when it's a
                            // bona-fide self-join-request: the clan already
                            // exists, the caller appears in the incoming
                            // joinRequests, and the caller is NOT in the incoming
                            // members — so this path can't be abused to self-add
                            // to the roster (which the validator's "self add"
                            // rule would otherwise let through, bypassing the
                            // leader/elder approval flow).
                            const matchesCaller = (entry: unknown) =>
                                safeName(String((entry as Record<string, unknown> | null)?.name ?? '')) === identity.name;
                            const callerInRequests = Array.isArray(incomingBody?.joinRequests)
                                && (incomingBody.joinRequests as unknown[]).some(matchesCaller);
                            const callerInMembers = Array.isArray(incomingBody?.members)
                                && (incomingBody.members as unknown[]).some(matchesCaller);
                            const allowJoinRequest = !!existingClan && callerInRequests && !callerInMembers;

                            if (!allowCreate && !allowJoinRequest) {
                                return res.status(403).json({ error: 'Only members of this clan can write its shared record.' });
                            }
                            if (allowCreate) {
                                // Per-player rate limit on first-time clan creation
                                // to stop name-squatting / spam after a server
                                // reset. 3 new clans per hour is plenty for
                                // legitimate "I created the wrong name" recovery.
                                if (!(await enforceRateLimitKv(req, res, 'clan-create', 3, 60 * 60_000, identity.name))) return;
                            } else {
                                // Per-player rate limit on join requests so a
                                // non-member can't spam every clan's shared
                                // record. 20/hour is far above any legitimate
                                // join-request cadence.
                                if (!(await enforceRateLimitKv(req, res, 'clan-join-request', 20, 60 * 60_000, identity.name))) return;
                            }
                        }
                    } catch {
                        return res.status(500).json({ error: 'Unable to verify clan membership.' });
                    }
                }
                identityName = identity.admin ? null : identity.name;

            }

            // Bound every authenticated ordinary-save attempt BEFORE it can
            // acquire the per-record lock or touch missing-version/conflict
            // telemetry. This intentionally has its own generous bucket:
            // reset-pending and stale responses count as ingress attempts, but
            // they do not consume `save-burst`, and only actual version
            // conflicts consume `save-conflict`. A client can therefore fetch
            // the authoritative version and retry immediately without being
            // throttled by either post-guard budget.
            if (!isAdminSave && identityName && !(await enforceRateLimitKv(
                req,
                res,
                'save-attempt',
                PLAYER_SAVE_ATTEMPT_LIMIT,
                PLAYER_SAVE_ATTEMPT_WINDOW_MS,
                identityName,
                { strict: true },
            ))) return;

            // If a reset-signal is pending (admin edit in-flight) and this is NOT the admin save,
            // silently drop the client auto-save so it can't overwrite admin changes.
            // Speculatively fetch the existing save in parallel with the signal checks —
            // saves one round-trip on every auto-save (the common path).
            if (!isAdminSave) {
                // ── Atomicity (finding 14) ─────────────────────────────────
                // Serialize the read-modify-write through withKvLock on the SAME
                // key the currency endpoints use: withKvLock('save:<name>') maps to
                // the lock key 'lock:save:<name>'. Sharing the helper means the save
                // path and every bank / seal-pool / treasury / daily-agenda /
                // weekly-boss / pvp-reward writer use IDENTICAL TTL (5s default),
                // retry+backoff, and release semantics on the one key — closing the
                // early-expiry window the old hand-rolled 2s TTL re-opened (a slow
                // save could outlive its 2s lock mid-op, a withKvLock currency
                // writer slips in, and the save's later release deletes the NEW
                // holder's lock). Clan saves serialize through it too.
                //
                // failClosed: under sustained contention withKvLock retries 5× with
                // backoff and then THROWS LockContendedError rather than running the
                // RMW unlocked; we catch it below and return the SAME 429 the
                // hand-rolled lock did (so the observable contention response is
                // unchanged — only now a brief overlap is absorbed by the retry
                // instead of failing the autosave immediately). Release is handled
                // by withKvLock's own finally — no manual kv.del here.
                //
                // The inner `return res...(...)` calls SEND the response as a side
                // effect and return out of the locked closure; the `return` after
                // the await then exits the handler. The RMW body below is unchanged.
                try {
                    await withKvLock(`save:${name.toLowerCase()}`, async () => {
                    const [pendingSignal, adminLock, existing] = await Promise.all([
                        kv.get(resetSignalKey),
                        kv.get(adminLockKey),
                        kv.get(key),
                    ]);
                    // Reset signal / admin edit in flight — drop the write so it
                    // can't overwrite the admin's changes. Say so explicitly:
                    // a bare 200 read as "saved" to the client, which then cleared
                    // its dirty flag and stopped retrying, so everything the player
                    // did during the (up to 5 minute) lock was silently discarded.
                    // Still a 200 — this is expected, not an error — but
                    // `persisted:false` tells the client to keep the state dirty
                    // and retry.
                    if (pendingSignal || adminLock) {
                        return res.status(200).json({ ok: false, persisted: false, reason: 'reset-pending' });
                    }

                    // Validate optimistic concurrency before sanitization, logs, or
                    // rolling gain-window accounting. A rejected stale write must be
                    // observationally read-only: it cannot consume rate-limit budget,
                    // enqueue title-review telemetry, or run identity lookups for a
                    // payload that will never be committed.
                    //
                    // Each stored player save carries `_saveVersion`, bumped on every
                    // successful write. Current clients echo that exact value as
                    // `_baseSaveVersion`. Both older and forged-future versions are
                    // conflicts. Clan saves use their separate shared-write validator;
                    // authenticated admin writes are allowed to omit the client stamp.
                    const existingObj = (existing as Record<string, unknown> | null) ?? null;
                    const storedVersion = Number(existingObj?._saveVersion ?? 0);
                    const incomingBody = incoming as Record<string, unknown>;
                    const baseVersion = parseBaseSaveVersion(incomingBody?._baseSaveVersion);

                    if (isVersionlessPlayerSave(isClanSave, identityName, baseVersion)) {
                        // This telemetry is deliberately part of the rejection path:
                        // it measures obsolete clients without touching gameplay state.
                        console.warn('[save-version] REJECT player save missing _baseSaveVersion (client too old):', identityName);
                        await recordMissingSaveVersion(identityName!);
                        return res.status(426).json({
                            error: 'Your game client is out of date. Please refresh the page to keep saving.',
                            code: 'CLIENT_REFRESH_REQUIRED',
                        });
                    }

                    if (!isClanSave && baseVersion !== null && !matchesStoredSaveVersion(baseVersion, storedVersion)) {
                        // Conflicts have a separate abuse bucket so a hostile stale
                        // client cannot hammer the locked read path, while a normal
                        // corrected retry keeps its one-per-3s successful-save slot.
                        if (!(await enforceRateLimitKv(req, res, 'save-conflict', 20, 60_000, identityName, { strict: true }))) {
                            return; // 429 already written
                        }
                        return res.status(409).json({
                            error: 'Save conflict — another tab or device wrote first.',
                            currentVersion: storedVersion,
                        });
                    }

                    // Charge the successful-save burst budget only after exact
                    // version authority is established. This keeps a conflict and
                    // its immediate corrected retry from self-throttling.
                    if (!isClanSave && !(await enforceRateLimitKv(req, res, 'save-burst', 1, 3_000, identityName))) {
                        return; // 429 already written
                    }

                    // Sanitize before merge: caps per-save gains to prevent exploit spikes.
                    // Clan saves go through a different validator (field-level
                    // role gating + per-call deltas) instead of the player-save
                    // sanitizer because the blob has different fields.
                    // For brand-new accounts (no existing), sanitize against a zeroed
                    // baseline so a fresh registration can't submit absurd values.
                    let safeIncoming: unknown;
                    if (isClanSave) {
                        const { next, suppressed } = validateClanSaveWrite(
                            (existing as Record<string, unknown> | null) ?? null,
                            incoming as Record<string, unknown>,
                            {
                                callerName: identityName ?? '',
                                isAdmin: identityName === null,
                            },
                        );
                        safeIncoming = next;
                        if (suppressed.length > 0) {
                            console.warn('[save POST clan] suppressed:', identityName ?? 'admin', name, suppressed.join('; '));
                        }
                    } else {
                        safeIncoming = sanitizeCharacterSave(
                            incoming as Record<string, unknown>,
                            (existing as Record<string, unknown> | null) ?? null,
                            { adminContentSlot: isAdminContentSlot(name) },
                        );
                        // Cross-validate clan / clanFounder / village against
                        // canonical clan records. This is the gate that stops
                        // a forged save POST from promoting itself to
                        // clanFounder of any clan (and then draining its
                        // seal pool via clan/seal-pool/distribute).
                        if (identityName) {
                            safeIncoming = await validateClanAndVillageIdentity(
                                safeIncoming as Record<string, unknown>,
                                (existing as Record<string, unknown> | null) ?? null,
                                identityName,
                            );
                        }
                    }

                    // Do not silently turn an unauthorized currency increase
                    // into an apparently successful save. Returning the
                    // authoritative balance lets the client repair its local
                    // state and retry normal gameplay without an autosave loop.
                    if (!isAdminSave && identityName && existing && !isClanSave) {
                        const storedCharacter = (existing as Record<string, unknown>).character as Record<string, unknown> | undefined;
                        const requestedCharacter = (incoming as Record<string, unknown>).character as Record<string, unknown> | undefined;
                        const storedRyo = Math.max(0, Number(storedCharacter?.ryo ?? 0));
                        const requestedRyo = Math.max(0, Number(requestedCharacter?.ryo ?? 0));
                        if (requestedRyo > storedRyo) {
                            console.warn('[save] blocked client-originated ryo increase', { player: identityName, storedRyo, requestedRyo });
                            return res.status(409).json({
                                error: 'Ryo is server-authoritative. Refresh your balance and retry.',
                                code: 'RYO_SERVER_AUTHORITY',
                                authoritativeRyo: storedRyo,
                                _saveVersion: Number((existing as Record<string, unknown>)._saveVersion ?? 0),
                            });
                        }
                    }

                    // Custom-title review log (§11.4): every NEW free-text
                    // title a save adopts is recorded for post-hoc admin
                    // review + revoke. Fire-and-forget; earned titles skipped.
                    // Gated on the Legacy flag so flag-off writes no new KV.
                    if (legacyEnabled() && !isClanSave && identityName) {
                        const exTitle = String(((existing as Record<string, unknown> | null)?.character as Record<string, unknown> | undefined)?.customTitle ?? '');
                        const inTitle = String(((safeIncoming as Record<string, unknown>).character as Record<string, unknown> | undefined)?.customTitle ?? '');
                        if (inTitle && inTitle !== exTitle && !isKnownEarnedTitle(inTitle)) {
                            void appendCustomTitleLog(identityName, inTitle);
                        }
                    }

                    // ── Rolling-window gain caps (finding 6) ──────────────────
                    // Track ryo / stat / xp gain over the last 60 seconds for
                    // this account. If a save would push cumulative gains over
                    // the threshold, reject with 429. Clan saves skipped.
                    if (existing && !isClanSave && identityName) {
                        const exChar = (existing as Record<string, unknown>).character as Record<string, unknown> | undefined;
                        const inChar = (safeIncoming as Record<string, unknown>).character as Record<string, unknown> | undefined;
                        if (exChar && inChar) {
                            const exRyo = Math.max(0, Number(exChar.ryo ?? 0));
                            const inRyo = Math.max(0, Number(inChar.ryo ?? 0));
                            const ryoDelta = Math.max(0, inRyo - exRyo);
                            const exXp = Math.max(0, Number(exChar.xp ?? exChar.experience ?? 0));
                            const inXp = Math.max(0, Number(inChar.xp ?? inChar.experience ?? 0));
                            const xpDelta = Math.max(0, inXp - exXp);
                            const exStats = (exChar.stats ?? {}) as Record<string, number>;
                            const inStats = (inChar.stats ?? {}) as Record<string, number>;
                            const statDelta: Record<string, number> = {};
                            for (const k of Object.keys(inStats)) {
                                const ex = Number(exStats[k] ?? 0);
                                const inv = Number(inStats[k] ?? 0);
                                const d = Math.max(0, inv - ex);
                                if (d > 0) statDelta[k] = d;
                            }
                            // Premium / power-material currency deltas (anti-tamper window).
                            const currencyDelta: Record<string, number> = {};
                            for (const k of Object.keys(MAX_CURRENCY_PER_MINUTE)) {
                                const d = Math.max(0, Number(inChar[k] ?? 0) - Number(exChar[k] ?? 0));
                                if (d > 0) currencyDelta[k] = d;
                            }

                            const win = (await readGainsWindow(identityName)) ?? freshWindow();
                            const ageMs = Date.now() - win.startedAt;
                            const cur = (ageMs > GAIN_WINDOW_MS) ? freshWindow() : win;

                            const nextRyo = cur.ryo + ryoDelta;
                            const nextXp = cur.xp + xpDelta;
                            const nextStat: Record<string, number> = { ...cur.stat };
                            for (const [k, d] of Object.entries(statDelta)) nextStat[k] = (nextStat[k] ?? 0) + d;
                            // Old windows (written before this field existed) lack `currency`.
                            const nextCurrency: Record<string, number> = { ...(cur.currency ?? {}) };
                            for (const [k, d] of Object.entries(currencyDelta)) nextCurrency[k] = (nextCurrency[k] ?? 0) + d;

                            if (nextRyo > MAX_RYO_PER_MINUTE) {
                                return res.status(429).json({
                                    error: `Ryo gain rate-limited (over ${MAX_RYO_PER_MINUTE} / 60s).`,
                                });
                            }
                            if (nextXp > MAX_XP_PER_MINUTE) {
                                return res.status(429).json({
                                    error: `XP gain rate-limited (over ${MAX_XP_PER_MINUTE} / 60s).`,
                                });
                            }
                            for (const [k, total] of Object.entries(nextStat)) {
                                if (total > MAX_STAT_PER_MINUTE) {
                                    return res.status(429).json({
                                        error: `Stat ${k} gain rate-limited (over ${MAX_STAT_PER_MINUTE} / 60s).`,
                                    });
                                }
                            }
                            // Premium/material currency per-minute caps. Anti-tamper only,
                            // generous vs legit faucets. DISABLE_CURRENCY_WINDOW=1 turns the
                            // 429 off instantly if a legit faucet ever trips it (the window is
                            // still tracked, just not enforced).
                            if (process.env.DISABLE_CURRENCY_WINDOW !== '1') {
                                for (const [k, total] of Object.entries(nextCurrency)) {
                                    const cap = MAX_CURRENCY_PER_MINUTE[k];
                                    if (cap != null && total > cap) {
                                        return res.status(429).json({
                                            error: `${k} gain rate-limited (over ${cap} / 60s).`,
                                        });
                                    }
                                }
                            }

                            // Allowed — persist the updated window.
                            await writeGainsWindow(identityName, { startedAt: cur.startedAt, ryo: nextRyo, stat: nextStat, xp: nextXp, currency: nextCurrency });
                        }
                    }

                    // ── Multi-tab autosave guard ─────────────────────────────
                    // Version authority was established before every mutable
                    // validation side effect above; only an accepted write reaches here.
                    const nextVersion = nextSaveVersion(storedVersion);
                    const mergedPayload = existing ? mergePreservingImages(safeIncoming, existing) : safeIncoming;
                    // Strip `_baseSaveVersion` from the persisted payload so
                    // it doesn't accumulate in the stored save record.
                    const mergedRecord = mergedPayload as Record<string, unknown>;
                    delete mergedRecord._baseSaveVersion;
                    const payload = isClanSave ? mergedRecord : {
                        ...mergedRecord,
                        _saveVersion: nextVersion,
                        _saveAt: Date.now(),
                    };

                    // Build the registry entry from the SANITIZED payload, not
                    // the raw incoming body (audit #13). Reading raw `incoming`
                    // let a tampered client publish a forged level/village/
                    // specialty into the public roster index even though the
                    // persisted save was clamped. safeIncoming is what we just
                    // wrote, so the index matches the stored truth.
                    const char = (safeIncoming as Record<string, unknown>)?.character as Record<string, unknown> | undefined;
                    const registryNow = Date.now();
                    const registryEntry = buildPublicPlayerIndexEntry(char, name, registryNow);

                    // Throttle the registry rewrite (see REGISTRY_REFRESH_MS +
                    // shouldWriteRegistry). The previous registry write time is carried
                    // in the save blob as `_registryAt` (no extra read); we re-stamp it
                    // only when we actually rewrite. The save blob (kv.set below) is
                    // written every time regardless — no progress is ever skipped.
                    const prevRegistryAt = Number(existingObj?._registryAt ?? 0);
                    const writeRegistry = shouldWriteRegistry({
                        isClanSave,
                        existingChar: (existingObj?.character ?? null) as Record<string, unknown> | null,
                        next: registryEntry,
                        prevRegistryAt,
                        now: registryNow,
                        refreshMs: REGISTRY_REFRESH_MS,
                    });
                    // Stamp when we actually (re)wrote the registry so the next save can
                    // measure drift. Non-clan only — clan payloads stay byte-identical.
                    if (!isClanSave) (payload as Record<string, unknown>)._registryAt = writeRegistry ? Date.now() : prevRegistryAt;

                    await Promise.all([
                        kv.set(key, payload),
                        ...(writeRegistry ? [kv.hset(REGISTRY_KEY, { [name]: registryEntry })] : []),
                    ]);
                    if (!existing && identityName && !isClanSave) {
                        captureServerProductEvent('character_created', { source: 'save' });
                    }
                    // Project the currency slice (P0-5). Player saves only —
                    // clan blobs carry no character. Skipped automatically when
                    // this write did not move currency, which is the common
                    // case for an autosave.
                    if (!isClanSave) {
                        await syncCurrencyLedger(name, payload as Record<string, unknown>, {
                            previousCharacter: (existingObj?.character ?? null) as Record<string, unknown> | null,
                        });
                    }
                    return res.status(200).json(isClanSave ? { ok: true } : { ok: true, _saveVersion: nextVersion });
                    }, { failClosed: true });
                    return; // the locked closure already sent the response
                } catch (lockErr) {
                    // Sustained contention (lock couldn't be acquired within the
                    // retry budget): same fast 429 the hand-rolled lock returned.
                    // withKvLock already released any lock it held; real errors from
                    // the RMW propagate to the outer handler catch → 500.
                    if (lockErr instanceof LockContendedError) {
                        return res.status(429).json({ error: 'Concurrent save in flight. Retry.' });
                    }
                    throw lockErr;
                }
            }

            // ── Admin save path (?signal=1) ─────────────────────────────────
            // P0-4: this used to read-modify-write with NO lock and NO version
            // check, so two admin tabs raced and a stale one silently reverted
            // newer content (shared-content audit, finding 4). It now runs
            // under the SAME save lock every other writer uses, and honours the
            // `_saveVersion` the editor loaded: admin tooling reads the record
            // and posts it back, so a stale body is detectable. A body with NO
            // version is still accepted (scripts / older tooling) — the lock
            // alone already removes the interleave.
            try {
                return await withKvLock(`save:${name.toLowerCase()}`, async () => {
                    // Inside the lock so a player autosave in flight can no
                    // longer slip between the signal and this read.
                    await kv.set(adminLockKey, 1, { ex: 300 });
                    const existing = await kv.get(key);
                    const adminStoredVersion = Number((existing as Record<string, unknown> | null)?._saveVersion ?? 0);
                    const incomingVersionRaw = (incoming as Record<string, unknown>)?._saveVersion;
                    const incomingVersion = Number(incomingVersionRaw);
                    if (
                        incomingVersionRaw !== undefined
                        && Number.isFinite(incomingVersion)
                        && adminStoredVersion > 0
                        && incomingVersion < adminStoredVersion
                    ) {
                        return res.status(409).json({
                            error: 'This record changed since you loaded it. Reload before saving so you do not revert newer content.',
                            storedVersion: adminStoredVersion,
                            baseVersion: incomingVersion,
                        });
                    }
                    const adminMerged = existing ? mergePreservingImages(incoming, existing) : incoming;
                    const payload = {
                        ...(adminMerged as Record<string, unknown>),
                        _saveVersion: nextSaveVersion(adminStoredVersion),
                        _saveAt: Date.now(),
                    };
                    // This path skips sanitizeCharacterSave entirely, so apply the
                    // admin-slot rule here too: personal forged gear is never shared
                    // content, no matter which write path put it there.
                    if (isAdminContentSlot(name) && Array.isArray((payload as Record<string, unknown>).creatorItems)) {
                        (payload as Record<string, unknown>).creatorItems = stripForgedItems((payload as Record<string, unknown>).creatorItems);
                    }

                    const char = (incoming as Record<string, unknown>)?.character as Record<string, unknown> | undefined;
                    const registryEntry = buildPublicPlayerIndexEntry(char, name);

                    await Promise.all([
                        kv.set(key, payload),
                        kv.hset(REGISTRY_KEY, { [name]: registryEntry }),
                    ]);
                    // Keep the canonical content store in step with a legacy
                    // publish, so a slot write can never leave the store stale
                    // (dual-read would then serve older content). Best-effort:
                    // the slot write above already committed.
                    if (isAdminContentSlot(name)) {
                        await mirrorSlotContent(payload as Record<string, unknown>, { actor: `legacy-signal:${name}` })
                            .catch(() => undefined);
                    }
                    // Set reset-signal after the new save is committed so the client reloads that exact version.
                    await kv.set(resetSignalKey, 1, { ex: 300 });
                    return res.status(200).end();
                }, { failClosed: true });
            } catch (lockErr) {
                if (lockErr instanceof LockContendedError) {
                    return res.status(429).json({ error: 'Concurrent save in flight. Retry.' });
                }
                throw lockErr;
            }
        } catch (err) {
            console.error('[save POST]', safeLogValue(err));
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    if (req.method === 'DELETE') {
        try {
            const adminAuth = isAdmin(req);
            if (!adminAuth) {
                const identity = await authedPlayerOrAdmin(req, name);
                if (!identity) return res.status(401).json({ error: 'Authentication required.' });
                if (!identity.admin && isClanSave) {
                    // Clan record: only the clan FOUNDER (or an admin) may delete
                    // the shared save — mirrors the founder-only "Delete Clan" UI.
                    // (The POST path lets any clan member WRITE the record, but a
                    // destructive delete is restricted to the founder so a random
                    // logged-in player can't wipe a rival clan.) The founder gate
                    // at clan creation guarantees founderName.toLowerCase() equals
                    // the founder's canonical name. If the record is already gone
                    // there is nothing to protect, so we no-op rather than 403.
                    const clanRec = await kv.get<{ founderName?: string }>(key);
                    const founder = safeName(String(clanRec?.founderName ?? ''));
                    if (clanRec && founder !== identity.name) {
                        return res.status(403).json({ error: 'Only the clan founder can delete this clan.' });
                    }
                } else if (!identity.admin && identity.name !== name) {
                    // Deleting ANOTHER player's save requires that player's own
                    // password (legacy body-supplied path) verified against an
                    // EXISTING auth record. Default-deny: a legacy account with no
                    // auth record can only be deleted by an admin. (Previously the
                    // missing-auth-record case fell through and let any logged-in
                    // player delete a legacy save.)
                    const playerPw = req.headers['x-player-password'] as string | undefined;
                    const authRecord = await kv.get(`auth:${name.toLowerCase()}`);
                    if (!authRecord || !playerPw || !(await verifyPlayerPassword(name, playerPw))) {
                        return res.status(403).json({ error: 'Cannot delete another player\'s save.' });
                    }
                }
            }
            const lowered = name.toLowerCase();
            const adminLockKey = `admin-lock:${lowered}`;
            await kv.set(adminLockKey, 1, { ex: 300 });
            await Promise.all([
                kv.del(key),
                kv.hdel(REGISTRY_KEY, name),
                // Signal the player's client to reload on next heartbeat (5-min TTL)
                kv.set(`reset-signal:${lowered}`, 1, { ex: 300 }),
            ]);
            return res.status(200).json({ ok: true });
        } catch (err) {
            console.error('[save DELETE]', safeLogValue(err));
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}

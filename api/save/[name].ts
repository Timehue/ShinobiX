import { reconcileElderFocus } from '../village/_elders.js';
import { sanitizeNarrativeIdentity } from './_sanitize-narrative.js';
import { sanitizeProgression } from './_sanitize-progression.js';
import { sanitizePetRoster } from './_sanitize-pets.js';
import { sanitizeInventory } from './_sanitize-inventory.js';
import { sanitizeExamProgress } from './_sanitize-exams.js';
import { prepareBloodlineNormalization } from './_sanitize-bloodlines.js';
import { sanitizeChallengeProgress } from './_sanitize-challenges.js';
import { sanitizeCardsAndHistory } from './_sanitize-cards-history.js';
import { sanitizeClaimsAndHospital } from './_sanitize-claims-hospital.js';
import { prepareCreatorItems } from './_sanitize-creator-items.js';
import { FIRST_SAVE_BASELINE_CHARACTER, preserveServerTopLevelFields, enforceRawSaveLedgerBoundary, grantOwnedBloodlineJutsuMastery } from './_sanitize-ledger.js';
import { FORGED_ITEM_ID, stripForgedItems as projectedStripForgedItems, preserveForgedItems as projectedPreserveForgedItems } from './_forged-items.js';
import { isReleaseSafeCreatorEvent as projectedIsReleaseSafeCreatorEvent, buildPublicSaveDTO as projectedBuildPublicSaveDTO, combatProjection as projectedCombatProjection } from './_projections.js';
import { safeLogValue } from '../_safe-log.js';
import { observeOnboardingFunnel } from './_onboarding-funnel.js';
import { recordBetaFunnelStep } from '../_beta-funnel.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { WORLD_CRISIS_TRIGGER_LEVEL } from '../../shared/world-crisis.js';
import { WORLD_CRISIS_80_TRIGGER_LEVEL } from '../../shared/world-crisis-80.js';
import { safeName, mergePreservingImages, cors, parseJsonBody } from '../_utils.js';
import { verifyPlayerPassword } from '../player-auth.js';
import { authedPlayerOrAdmin, isAdmin, isFullAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { validateClanSaveWrite } from '../_clan-save-validate.js';
import { isKnownEarnedTitle, appendCustomTitleLog } from '../_titles-registry.js';
import { legacyEnabled } from '../_legacy-track.js';
import { parseBaseSaveVersion, saveVersionTelemetryKey, isVersionlessPlayerSave, matchesStoredSaveVersion, nextSaveVersion, storedSaveVersion } from './_save-version.js';
import { shouldWriteRegistry } from './_registry-throttle.js';
import { deletePlayerFirstPactState, detachPlayerReferences } from '../_delete-player-account.js';
import { ClanDissolutionForbiddenError, dissolveClanUnderLock } from '../clan/_dissolve.js';
import { awardWarEndClanXp } from '../clan/war/_war-xp.js';
import { REGISTRY_KEY, buildPublicPlayerIndexEntry } from '../player/_public-index.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { mirrorSlotContent } from '../_content-store.js';
import { syncCurrencyLedger } from '../_currency-ledger.js';
import { captureServerProductEvent } from '../_product-analytics.js';
import { settleSaveRecordForRead } from '../_elapsed-state.js';
import { readWalkedTile, resumeTileFor } from '../_realtime/walked-tile.js';
import { applyCanonicalFirstSave } from './_first-save-baseline.js';
import { readVillageUpgrades } from '../village/_upgrade.js';
import { readPendingWorldRewards } from '../world/_pending-rewards.js';
import { maxLoadout, isPatreonSubscriber, isPresetAvatar, isOwnAvatarReference } from '../_entitlements.js';

// Clan dissolution scans global territory/war indexes and detaches every
// member. The ordinary five-second save lease is intentionally too short for
// that bounded saga on a populated production dataset; keep the clan document
// fenced for the whole operation so no concurrent clan write can split the
// cleanup. Ordinary player deletion keeps the standard short lease.
const CLAN_DISSOLUTION_LOCK_TTL_SEC = 120;

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
    return projectedIsReleaseSafeCreatorEvent(raw);
}

// Build the non-owner response: an explicit allowlist DTO. Nothing from the
// stored save reaches a foreign reader unless it is named here — no top-level
// spread, no internal metadata (_saveVersion / _saveAt), and future fields are
// private until deliberately added.
export function buildPublicSaveDTO(data: Record<string, unknown>, opts: { combat: boolean; sharedContent?: boolean }): Record<string, unknown> {
    return projectedBuildPublicSaveDTO(data, opts);
}

/** Content admin is limited to the two explicit admin content save records. */
export function adminSaveTargetAllowed(targetName: string, fullAdmin: boolean, anyAdmin: boolean): boolean {
    if (fullAdmin) return true;
    return anyAdmin && (targetName === 'admin1' || targetName === 'admin2');
}

/**
 * Admin player-save tooling posts a snapshot it previously loaded. The route
 * key and the snapshot character must name the same player; otherwise a stale
 * UI target can copy one player's entire save over another player. Shared clan
 * blobs and the two admin content slots are deliberately outside this player
 * identity boundary.
 */
export function adminPlayerSaveOwnerMismatch(
    targetName: string,
    incoming: Record<string, unknown>,
    isClanSave: boolean,
): boolean {
    if (isClanSave || isAdminContentSlot(targetName)) return false;
    const character = incoming.character;
    if (!character || typeof character !== 'object' || Array.isArray(character)) return true;
    const prototype = Object.getPrototypeOf(character);
    if (prototype !== Object.prototype && prototype !== null) return true;
    const incomingName = (character as Record<string, unknown>).name;
    if (typeof incomingName !== 'string') return true;
    const incomingOwnerKey = safeName(incomingName);
    return !incomingOwnerKey || incomingOwnerKey !== targetName;
}

/**
 * Normal player deletion generations survive the short-lived reset/admin
 * signals. Admin content slots and clan blobs deliberately keep their existing
 * lifecycle and never receive a player deletion floor.
 */
export function playerSaveDeletionFenceKey(targetName: string, isClanSave: boolean): string | null {
    const canonicalName = safeName(targetName);
    if (!canonicalName || isClanSave || isAdminContentSlot(canonicalName)) return null;
    return `save-delete-version:${canonicalName}`;
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
    return projectedCombatProjection(data);
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

// Ids that ONLY the server can mint: api/craft/named.ts writes a forged piece
// into the player's top-level `creatorItems` as `named-<kind>-<uuid>`
// (api/craft/_named.ts buildNamedItem, kind = 'weapon' | 'armor').
//
// The uuid is accepted with OR without dashes. buildNamedItem strips them today
// (`randomUUID().replace(/-/g, '')`), but every forged item currently in the
// database predates that and carries the dashed form — matching only the
// stripped shape would protect none of the live gear.
export { FORGED_ITEM_ID };

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
    return projectedStripForgedItems(list);
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
    return projectedPreserveForgedItems(sanitized, stored, cap);
}

export function sanitizeCharacterSave(
    incoming: Record<string, unknown>,
    existing: Record<string, unknown> | null,
    // True when the target is `save:admin1` / `save:admin2` — the player saves
    // that double as the shared-content store. Forged gear is stripped rather
    // than preserved there: it is personal, and anything on those slots is
    // published to every client. Defaults false, so ordinary player saves are
    // unaffected.
    opts: { adminContentSlot?: boolean; now?: number } = {},
): Record<string, unknown> {
    const isFirstSave = existing == null;
    const inChar = incoming.character as Record<string, unknown> | undefined;
    // First-save case (no existing): clamp against a fresh baseline so a brand-
    // new account can't submit absurd starting values.
    const exChar = (existing?.character as Record<string, unknown> | undefined)
        ?? applyCanonicalFirstSave(FIRST_SAVE_BASELINE_CHARACTER);
    if (!inChar || typeof inChar !== 'object' || !exChar || typeof exChar !== 'object') {
        const partial = { ...incoming };
        preserveServerTopLevelFields(partial, existing, opts.adminContentSlot);
        return partial;
    }

    const char: Record<string, unknown> = { ...inChar };
    sanitizeNarrativeIdentity(char, exChar, inChar, existing, isFirstSave);
    const strictLedger = sanitizeProgression(char, exChar, inChar, existing, isFirstSave, opts);
    sanitizePetRoster(char, exChar, strictLedger);
    sanitizeInventory(char, exChar);
    sanitizeExamProgress(char, exChar, isFirstSave);
    const { normalizeBloodlineArray, pendingBloodlineForges, consumedBloodlineForgeIds, RAW_BLOODLINE_IMAGE_MAX_BYTES } = prepareBloodlineNormalization(char, exChar, existing);
    sanitizeChallengeProgress(char, exChar);
    sanitizeCardsAndHistory(char, exChar);
    sanitizeClaimsAndHospital(char, exChar);
    const { CREATOR_ITEM_CAP, sanitizedCreatorItems } = prepareCreatorItems(incoming, RAW_BLOODLINE_IMAGE_MAX_BYTES);

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
    // equippedJutsuIds is an ID preference, not proof that a technique was
    // learned. Accept any persisted mastery row (including legitimate level 0),
    // the level-one rows granted above for owned bloodline content, and an ID
    // already present in the STORED slot list (migration-safe preference
    // preservation). A newly forged catalog id has none of those proofs.
    if (Array.isArray(finalChar.equippedJutsuIds)) {
        const learnedJutsuIds = new Set(
            (Array.isArray(finalChar.jutsuMastery) ? finalChar.jutsuMastery : [])
                .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
                .map((row) => String(row.jutsuId ?? '').trim().toLowerCase())
                .filter(Boolean),
        );
        for (const id of Array.isArray(exChar.equippedJutsuIds) ? exChar.equippedJutsuIds : []) {
            if (typeof id === 'string' && id.trim()) learnedJutsuIds.add(id.trim().toLowerCase());
        }
        finalChar.equippedJutsuIds = (finalChar.equippedJutsuIds as unknown[])
            .filter((id): id is string => typeof id === 'string' && learnedJutsuIds.has(id.trim().toLowerCase()));
    }
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
    preserveServerTopLevelFields(out, existing, opts.adminContentSlot);
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
    // Applied by preserveServerTopLevelFields above, including partial saves.
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

const villageStateSlug = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

type MinimalClanRec = { name?: string; founderName?: string; members?: Array<{ name?: string }>; upgrades?: Record<string, unknown>; doctrine?: unknown };

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

    // ── Clan upgrade snapshot + doctrine ────────────────────────────────
    // `clanUpgradeLevels` and `clanDoctrine` ride on the character as a MIRROR
    // of the canonical clan record, and the server reads them as real inputs:
    // shop discount (shop/_settlement.ts), card-pack discount (card-clash/
    // _pack.ts), hospital discount (player/heal.ts) and — the one that matters —
    // the SEALED training stat gain (training/_session.ts trainingBonusPct).
    // They had no ownership-manifest entry, so the sanitizer neither copied nor
    // clamped them and a tampered client could self-grant up to +15% permanent
    // training rate, i.e. mint progression.
    //
    // They cannot simply be frozen to stored: the Clan Hall legitimately syncs
    // them after an upgrade purchase or a doctrine change. So stored wins by
    // default, and when the incoming copy DIFFERS the canonical clan record is
    // the arbiter. That keeps the ordinary autosave free of an extra KV read —
    // the fetch happens only on the save that actually carries a change.
    const finalClan = String(out.clan ?? '').trim();
    if (!finalClan) {
        delete out.clanUpgradeLevels;
        delete out.clanDoctrine;
    } else {
        const sameUpgrades = JSON.stringify(out.clanUpgradeLevels ?? null) === JSON.stringify(exChar.clanUpgradeLevels ?? null);
        const sameDoctrine = String(out.clanDoctrine ?? '') === String(exChar.clanDoctrine ?? '');
        if (sameUpgrades && sameDoctrine) {
            if (exChar.clanUpgradeLevels !== undefined) out.clanUpgradeLevels = exChar.clanUpgradeLevels;
            else delete out.clanUpgradeLevels;
            if (exChar.clanDoctrine !== undefined) out.clanDoctrine = exChar.clanDoctrine;
            else delete out.clanDoctrine;
        } else {
            const rec = await kv.get<MinimalClanRec>(`save:${clanRecordSlug(finalClan)}`);
            if (rec?.upgrades && typeof rec.upgrades === 'object' && !Array.isArray(rec.upgrades)) {
                out.clanUpgradeLevels = rec.upgrades;
            } else delete out.clanUpgradeLevels;
            if (typeof rec?.doctrine === 'string' && rec.doctrine) out.clanDoctrine = rec.doctrine;
            else delete out.clanDoctrine;
        }
    }

    // ── Village upgrade mirror ──────────────────────────────────────────
    // Village upgrades are SHARED infrastructure living on the village-state
    // blob and paid for out of the treasury seal pool (api/village/_upgrade.ts).
    // `character.villageUpgrades` is a server-owned MIRROR of that record so the
    // ~21 existing read sites (bank interest, mission rewards, shop discount,
    // training rate, hospital, jutsu speed, pet yard, town defense) keep reading
    // a plain character field.
    //
    // The village record is read on EVERY save with a village, not only when the
    // incoming copy differs. That costs one extra `kv.get` of a small key shared
    // by the whole village (so it is cache-warm), and it buys the property that
    // actually matters: when the Kage buys an upgrade, every member picks it up
    // on their next save with no client cooperation at all. A change-triggered
    // refresh cannot work here — the client has no reason to ever send a
    // different value, so the mirror would never move and the upgrades would
    // benefit nobody.
    const finalVillage = String(out.village ?? '').trim();
    if (!finalVillage) {
        delete out.villageUpgrades;
    } else {
        try {
            const villageState = await kv.get<Record<string, unknown>>(`game:village-state:${villageStateSlug(finalVillage)}`);
            out.villageUpgrades = readVillageUpgrades(villageState);
        } catch {
            // A village-state read hiccup must never fail a save or silently
            // zero a player's bonuses — keep whatever was already stored.
            if (exChar.villageUpgrades !== undefined) out.villageUpgrades = exChar.villageUpgrades;
            else delete out.villageUpgrades;
        }
    }

    return { ...safeIncoming, character: await reconcileElderFocus(out) };
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
        // Only owner reads advance the version stream. A client loading-mask
        // descriptor is never consulted for arrival; the durable lease is.
        const ownerTravel = !isClanSave && !identity.admin && identity.name === name
            ? await (await import('../_realtime/travel-lease.js')).getTravelLease(name)
            : null;
        if (ownerTravel && Date.now() >= ownerTravel.arrivalAt) {
            try {
                await (await import('../_realtime/travel-lease.js')).settleTravelLease(name, ownerTravel);
            } catch {
                return res.status(503).json({ error: 'Your arrival is still settling. Please retry.' });
            }
        }
        const stored = await kv.get<Record<string, unknown>>(key);
        if (stored === null) return res.status(404).end();

        // Full-snapshot visibility and elapsed-state write authority are separate.
        // An authorized admin may inspect a full player save, but that read does
        // not belong to the player's live save-version stream and must not bump it.
        const adminCanReadTarget = identity.admin
            && adminSaveTargetAllowed(name, isFullAdmin(req), isAdmin(req));
        const isPlayerSelfRead = !identity.admin && identity.name === name;
        const canReadFullSave = adminCanReadTarget || isClanSave || isPlayerSelfRead;

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
        let data = isClanSave
            ? stored
            : (await settleSaveRecordForRead(name, stored, { persist: isPlayerSelfRead })).record;

        // A trip can mature while the save/elapsed-state reads are in flight.
        // Do not return an old town origin with neither arrival nor travel mask.
        const positionNow = Date.now();
        if (ownerTravel && positionNow >= ownerTravel.arrivalAt) {
            const travel = await import('../_realtime/travel-lease.js');
            if (data.worldTravelReceipt !== travel.travelLeaseReceipt(ownerTravel)) {
                try {
                    await travel.settleTravelLease(name, ownerTravel, positionNow);
                    const arrived = await kv.get<Record<string, unknown>>(key);
                    if (arrived) data = arrived;
                } catch {
                    return res.status(503).json({ error: 'Your arrival is still settling. Please retry.' });
                }
            }
        }

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
        if (canReadFullSave) {
            payload = combatOnly ? combatProjection(data) : data;
            if (isPlayerSelfRead && !combatOnly && ownerTravel && positionNow < ownerTravel.arrivalAt) {
                payload = { ...payload, currentSector: ownerTravel.originSector,
                    pendingTravel: { destinationSector: ownerTravel.destinationSector, arrivalAt: ownerTravel.arrivalAt,
                        remainingMs: ownerTravel.arrivalAt - positionNow } };
            }
        } else {
            // Admin content slots additionally expose the shared authored-content
            // root fields, which every client needs to hydrate custom jutsu /
            // items / events / cards. See SHARED_ADMIN_CONTENT_FIELDS.
            payload = buildPublicSaveDTO(data, { combat: combatOnly, sharedContent: isAdminContentSlot(name) });
        }
        // F03: the owner's restore pull resumes on the tile the player last
        // stood on, not the road they arrived by. `currentTile` is server-owned
        // (the client never sends it back), so this is a read-only projection
        // of walked-tile.ts over the arrival tile the travel settle persisted.
        if (canReadFullSave && !combatOnly && !isClanSave) {
            const walked = await readWalkedTile(kv, name).catch(() => null);
            const resume = resumeTileFor(walked, Number(payload.currentSector), payload.currentTile);
            if (resume !== undefined) payload = { ...payload, currentTile: resume };
        }
        // Owner reads (the login / restore pull) also carry the account-side
        // mirror of un-settled World explore/chest request ids, so a new device
        // can replay them from the server receipt. Read-only piggyback: it is
        // not part of the save record and the sanitizer never sees it.
        if (canReadFullSave && !combatOnly && !isClanSave) {
            const pendingWorldRewards = await readPendingWorldRewards(name)
                .catch((err) => { console.error('[save] pending world rewards', safeLogValue(err)); return []; });
            if (pendingWorldRewards.length) payload = { ...payload, pendingWorldRewards };
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
                if (adminPlayerSaveOwnerMismatch(name, incoming as Record<string, unknown>, isClanSave)) {
                    return res.status(409).json({
                        error: 'Save character identity does not match the target player. Reload before saving.',
                    });
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
                    const deletionFenceKey = playerSaveDeletionFenceKey(name, isClanSave);
                    const [pendingSignal, adminLock, existing, deletionFence] = await Promise.all([
                        kv.get(resetSignalKey),
                        kv.get(adminLockKey),
                        kv.get(key),
                        deletionFenceKey ? kv.get(deletionFenceKey) : Promise.resolve(null),
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
                    // A deleted player's version stream never restarts at 1.
                    // The live-record comparison above intentionally remains
                    // against 0 when absent so a fresh owner can recreate the
                    // account with `_baseSaveVersion: 0`; the persisted version
                    // advances beyond the previous deletion generation.
                    const nextVersion = nextSaveVersion(storedVersion, deletionFence);
                    const mergedPayload = existing ? mergePreservingImages(safeIncoming, existing) : safeIncoming;
                    // Strip `_baseSaveVersion` from the persisted payload so
                    // it doesn't accumulate in the stored save record.
                    const mergedRecord = mergedPayload as Record<string, unknown>;
                    delete mergedRecord._baseSaveVersion;
                    // `_regenAt` (the regeneration cursor, api/_elapsed-state.ts) is
                    // fenced by every autosave exactly as `_saveAt` always was: the
                    // client applies its own 1/s idle regen locally, so the server's
                    // clock restarts at the write or the same interval would be
                    // credited twice.
                    const payload = isClanSave ? mergedRecord : {
                        ...mergedRecord,
                        _saveVersion: nextVersion,
                        _saveAt: Date.now(),
                        _regenAt: Date.now(),
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
                        const beforeCharacter = (existingObj?.character ?? null) as Record<string, unknown> | null;
                        const afterCharacter = (payload as Record<string, unknown>).character as Record<string, unknown> | undefined;
                        const beforeLevel = Math.max(0, Math.floor(Number(beforeCharacter?.level) || 0));
                        const afterLevel = Math.max(0, Math.floor(Number(afterCharacter?.level) || 0));
                        // Onboarding funnel. The save boundary is the only place
                        // an equip or a sector arrival is observable, since neither
                        // has its own endpoint. Fire-and-forget after the write:
                        // each crossing is gated once-per-player in KV, so a
                        // replayed autosave carrying the same transition is inert,
                        // and a telemetry outage can never fail a save.
                        if (identityName && afterCharacter) {
                            for (const step of observeOnboardingFunnel({
                                beforeCharacter,
                                afterCharacter,
                                beforeTopLevel: existingObj as Record<string, unknown> | null,
                                afterTopLevel: payload as Record<string, unknown>,
                            })) {
                                void recordBetaFunnelStep(step.event, identityName, {
                                    ...(step.step ? { step: step.step } : {}),
                                    ...(step.level === undefined ? {} : { level: step.level }),
                                });
                            }
                        }
                        if (identityName && beforeCharacter && afterCharacter && beforeLevel < WORLD_CRISIS_TRIGGER_LEVEL && afterLevel >= WORLD_CRISIS_TRIGGER_LEVEL) {
                            try {
                                const { observeWorldCrisisLevelCrossing } = await import('../world-crisis/_state.js');
                                await observeWorldCrisisLevelCrossing({ playerName: identityName, beforeLevel, afterLevel, character: afterCharacter });
                            } catch (error) {
                                console.error('[world-crisis] committed autosave crossing observer failed:', error);
                            }
                        }
                        if (identityName && beforeCharacter && afterCharacter && beforeLevel < WORLD_CRISIS_80_TRIGGER_LEVEL && afterLevel >= WORLD_CRISIS_80_TRIGGER_LEVEL) {
                            try {
                                const { observeWorldCrisis80LevelCrossing } = await import('../world-crisis-80/_state.js');
                                await observeWorldCrisis80LevelCrossing({ playerName: identityName, beforeLevel, afterLevel, character: afterCharacter });
                            } catch (error) {
                                console.error('[world-crisis-80] committed autosave crossing observer failed:', error);
                            }
                        }
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
            // version remains accepted for existing/never-created records
            // (scripts / older tooling), but not across a deletion generation.
            try {
                return await withKvLock(`save:${name.toLowerCase()}`, async () => {
                    const deletionFenceKey = playerSaveDeletionFenceKey(name, isClanSave);
                    const [existing, deletionFence] = await Promise.all([
                        kv.get(key),
                        deletionFenceKey ? kv.get(deletionFenceKey) : Promise.resolve(null),
                    ]);
                    const liveStoredVersion = storedSaveVersion(
                        (existing as Record<string, unknown> | null)?._saveVersion,
                    );
                    const deletionFenceVersion = storedSaveVersion(deletionFence);
                    const adminStoredVersion = Math.max(liveStoredVersion, deletionFenceVersion);
                    const incomingVersionRaw = (incoming as Record<string, unknown>)?._saveVersion;
                    const incomingVersion = Number(incomingVersionRaw);
                    const deletedGenerationWithoutLiveSave = existing === null && deletionFenceVersion > 0;
                    const missingDeletedGenerationAuthority = deletedGenerationWithoutLiveSave && (
                        incomingVersionRaw === undefined
                        || !Number.isFinite(incomingVersion)
                        || incomingVersion < deletionFenceVersion
                    );
                    const staleVersionedSnapshot = (
                        incomingVersionRaw !== undefined
                        && Number.isFinite(incomingVersion)
                        && adminStoredVersion > 0
                        && incomingVersion < adminStoredVersion
                    );
                    if (missingDeletedGenerationAuthority || staleVersionedSnapshot) {
                        return res.status(409).json({
                            error: 'This record changed since you loaded it. Reload before saving so you do not revert newer content.',
                            storedVersion: adminStoredVersion,
                            baseVersion: Number.isFinite(incomingVersion) ? incomingVersion : null,
                        });
                    }
                    // Establish this editor's signal only after the locked live
                    // record + persistent deletion generation have rejected a
                    // stale snapshot. Versionless trusted creation remains
                    // supported only when there is no prior deletion floor.
                    await kv.set(adminLockKey, 1, { ex: 300 });
                    const adminMerged = existing ? mergePreservingImages(incoming, existing) : incoming;
                    const payload = {
                        ...(adminMerged as Record<string, unknown>),
                        _saveVersion: nextSaveVersion(adminStoredVersion),
                        _saveAt: Date.now(),
                        _regenAt: Date.now(),
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
            const fullAdminAuth = isFullAdmin(req);
            let deletionActor: string | null = null;
            if (isAdmin(req) && !fullAdminAuth) {
                return res.status(403).json({ error: 'Full admin authentication required to delete player saves.' });
            }
            if (!fullAdminAuth) {
                const identity = await authedPlayerOrAdmin(req, name);
                if (!identity) return res.status(401).json({ error: 'Authentication required.' });
                if (!identity.admin) deletionActor = identity.name;
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
            const deletionResult = await withKvLock(`save:${lowered}`, async () => {
                await kv.set(adminLockKey, 1, { ex: 300 });
                const deletionFenceKey = playerSaveDeletionFenceKey(name, isClanSave);
                if (deletionFenceKey) {
                    const [existing, priorDeletionFence] = await Promise.all([
                        kv.get(key),
                        kv.get(deletionFenceKey),
                    ]);
                    if (existing !== null) {
                        const deletionVersion = nextSaveVersion(
                            (existing as Record<string, unknown>)._saveVersion,
                            priorDeletionFence,
                        );
                        // Persist the new generation before removing the save.
                        // A partial failure may leave a harmless high-water mark,
                        // but can never delete a version without fencing it.
                        await kv.set(deletionFenceKey, deletionVersion);
                    }
                }
                if (isClanSave) {
                    const liveClanRecord = await kv.get<Record<string, unknown>>(key);
                    // Re-check the founder against the record held under this
                    // exact clan lock. The pre-lock check provides a fast 403;
                    // this one closes deletion/recreation name-reuse races.
                    const dissolution = await dissolveClanUnderLock(key, liveClanRecord, deletionActor);
                    await kv.hdel(REGISTRY_KEY, name);
                    return {
                        body: {
                            ok: true,
                            dissolution: {
                                members: dissolution.memberNames.length,
                                membersCleared: dissolution.membersCleared,
                                territoriesReleased: dissolution.territoriesReleased,
                                warsForfeited: dissolution.warsForfeited,
                                replayed: dissolution.replayed,
                            },
                        },
                        finalizedWars: dissolution.finalizedWars,
                    };
                }

                // Detach the rows that point AT this player before the save goes —
                // the clan is read off the save itself. Deleting `save:` and the
                // registry entry alone left a departed member still counted on the
                // clan roster and still occupying a slot in the capped
                // `mod:by-ip` / `mod:by-fp` alt-detection lists, where dead names
                // push live players out. Clan records route through this same
                // handler, so it is scoped to player saves only. Best-effort: a
                // failure here must not block the deletion the player asked for.
                //
                // Runs INSIDE the save lock and AFTER the version fence above:
                // the fence has to be durable before any part of this account is
                // torn down, and the detach belongs to the same critical section
                // as the deletes it precedes.
                try {
                    const detached = await detachPlayerReferences(name);
                    if (detached.failures.length) {
                        console.warn(`[save DELETE] partial detach for ${name}: ${detached.failures.join('; ')}`);
                    }
                } catch (err) {
                    console.error('[save DELETE detach]', safeLogValue(err));
                }
                // Fail closed on the standalone story lock before deleting the
                // character or registry row. A retry can then complete the same
                // fenced deletion without leaving reusable story state behind.
                await deletePlayerFirstPactState(name);
                await Promise.all([
                    kv.del(key),
                    kv.hdel(REGISTRY_KEY, name),
                    // Signal the player's client to reload on next heartbeat (5-min TTL)
                    kv.set(`reset-signal:${lowered}`, 1, { ex: 300 }),
                ]);
                return { body: { ok: true }, finalizedWars: [] };
            }, isClanSave
                ? { failClosed: true, ttlSec: CLAN_DISSOLUTION_LOCK_TTL_SEC }
                : { failClosed: true });
            for (const war of deletionResult.finalizedWars) {
                await awardWarEndClanXp(war).catch((error) => console.error('[save DELETE] clan-war XP award failed', safeLogValue(error)));
            }
            return res.status(200).json(deletionResult.body);
        } catch (err) {
            if (err instanceof ClanDissolutionForbiddenError) {
                return res.status(403).json({ error: err.message });
            }
            if (err instanceof LockContendedError) {
                return res.status(429).json({ error: 'Concurrent save in flight. Retry.' });
            }
            console.error('[save DELETE]', safeLogValue(err));
            return res.status(500).json({ error: 'Internal server error.' });
        }
    }

    return res.status(405).end();
}

import { readPendingBloodlineForges, parseBloodlineForgeRank } from '../bloodlines/_forge.js';
import { sanitizeUserText, TEXT_LIMITS } from '../_text-moderation.js';
import { sanitizeJutsuVisualEffect } from '../_jutsu-visuals.js';
import { normalizePlayerBloodlineJutsus } from '../bloodlines/_jutsu-schema.js';
import { enforceBloodlineBudget, type RawJutsu, bloodlinePoints } from '../_jutsu-points.js';
import { BUILTIN_BLOODLINES } from '../pvp/_bloodline-gate.js';

const BUILTIN_BLOODLINE_IDS = new Set(BUILTIN_BLOODLINES.map((bloodline) => bloodline.id));

/**
 * A save with no write intent (an autosave, or a client from before the maker
 * sent one) must not fail as a whole because its bloodline list is stale:
 * normalization already kept the stored roster, and refusing the save would
 * refuse every later autosave too until the player reloads. It fails only for
 * what looks like an older client's Awakening: a new bloodline or a rank
 * upgrade that normalization dropped although a pending forge purchase at that
 * rank could have paid for it. A 200 there would tell that client the
 * bloodline was saved when it was not.
 */
export function hasRejectedBloodlineForgeAttempt(submitted: unknown, retained: unknown, pendingForges: unknown): boolean {
    if (!Array.isArray(submitted)) return false;
    const payableRanks = new Set(readPendingBloodlineForges(pendingForges).map((forge) => forge.rank));
    if (payableRanks.size === 0) return false;
    const retainedRanks = new Map<string, string>();
    if (Array.isArray(retained)) {
        for (const entry of retained) {
            if (!entry || typeof entry !== 'object') continue;
            const bloodline = entry as Record<string, unknown>;
            if (typeof bloodline.id === 'string' && typeof bloodline.rank === 'string') {
                retainedRanks.set(bloodline.id, bloodline.rank);
            }
        }
    }
    const order: Record<string, number> = { 'B Rank': 0, 'A Rank': 1, 'S Rank': 2 };
    for (const entry of submitted) {
        if (!entry || typeof entry !== 'object') continue;
        const bloodline = entry as Record<string, unknown>;
        const rank = parseBloodlineForgeRank(bloodline.rank);
        if (typeof bloodline.id !== 'string' || !bloodline.id || !rank || !payableRanks.has(rank)) continue;
        const kept = retainedRanks.get(bloodline.id);
        if (kept === undefined || (order[rank] ?? 0) > (order[kept] ?? 0)) return true;
    }
    return false;
}

/** A maker write must never acknowledge a bloodline that normalization discarded or downgraded. */
export function hasRejectedBloodlineSubmission(submitted: unknown, retained: unknown): boolean {
    if (!Array.isArray(submitted)) return false;
    const retainedRanks = new Map<string, string>();
    if (Array.isArray(retained)) {
        for (const entry of retained) {
            if (!entry || typeof entry !== 'object') continue;
            const bloodline = entry as Record<string, unknown>;
            if (typeof bloodline.id === 'string' && typeof bloodline.rank === 'string') {
                retainedRanks.set(bloodline.id, bloodline.rank);
            }
        }
    }
    const seen = new Set<string>();
    for (const entry of submitted) {
        if (!entry || typeof entry !== 'object') return true;
        const bloodline = entry as Record<string, unknown>;
        if (typeof bloodline.id !== 'string' || !bloodline.id) return true;
        if (seen.has(bloodline.id) || retainedRanks.get(bloodline.id) !== bloodline.rank) return true;
        seen.add(bloodline.id);
    }
    return false;
}

export function preserveEquippedBloodline(
    character: Record<string, unknown>,
    storedCharacter: Record<string, unknown>,
    savedBloodlines: unknown,
    equipIntent = '',
    acceptedForge = false,
): void {
    const ownedIds = new Set(Array.isArray(savedBloodlines)
        ? savedBloodlines.map((entry) => entry && typeof entry === 'object' ? (entry as Record<string, unknown>).id : null)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []);
    const requested = typeof character.equippedBloodlineId === 'string' ? character.equippedBloodlineId : '';
    const stored = typeof storedCharacter.equippedBloodlineId === 'string' ? storedCharacter.equippedBloodlineId : '';
    // A stale full-save payload must not point a newly forged character back to
    // a removed bloodline (or to the starter slot). Only an owned custom id may
    // replace an already equipped custom id.
    if (ownedIds.has(requested) && (requested === stored || requested === equipIntent || acceptedForge)) return;
    if (BUILTIN_BLOODLINE_IDS.has(requested) && (requested === stored || requested === equipIntent || !stored)) return;
    if (ownedIds.has(stored) || BUILTIN_BLOODLINE_IDS.has(stored)) character.equippedBloodlineId = stored;
    else if (ownedIds.size > 0) character.equippedBloodlineId = ownedIds.values().next().value;
    else if (requested || stored) character.equippedBloodlineId = '';
}

export function prepareBloodlineNormalization(
    char: Record<string, unknown>,
    exChar: Record<string, unknown>,
    existing: Record<string, unknown> | null | undefined,
    // True only for the admin content slots (admin1/admin2), whose saves are
    // the Admin Panel's authored edits: they may delete and edit bloodlines.
    allowRemoval = false,
    writeIntent = '',
) {

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
        const existingById = new Map<string, Record<string, unknown>>();
        if (Array.isArray(existingArr)) {
            for (const eb of existingArr as Array<Record<string, unknown>>) {
                if (eb && typeof eb === 'object') {
                    const eid = String(eb.id ?? '');
                    const er = String(eb.rank ?? '');
                    if (eid && KNOWN_BLOODLINE_RANKS.has(er)) existingRankById.set(eid, er);
                    if (eid) existingById.set(eid, eb);
                }
            }
        }
        let acceptedEntitledNew = 0;
        let rejectedUnentitledNew = false;
        const seenBloodlineIds = new Set<string>();
        const normalized = (arr as Array<Record<string, unknown>>).slice(0, BLOODLINE_CAP).map((bl) => {
            if (!bl || typeof bl !== 'object') return {};
            const requestedId = String(bl.id ?? '');
            const storedEntry = existingById.get(requestedId);
            const requestedRank = String(bl.rank ?? '');
            const storedRank = requestedId ? existingRankById.get(requestedId) : undefined;
            const paidUpgrade = storedRank !== undefined
                && (BLOODLINE_RANK_ORDER[requestedRank] ?? 0) > (BLOODLINE_RANK_ORDER[storedRank] ?? 0)
                && requestedId === writeIntent
                && pendingBloodlineForges.some((entry) => entry.rank === parseBloodlineForgeRank(requestedRank));
            // Ordinary full saves carry a snapshot of every bloodline. Only a
            // maker write or paid rank upgrade may change a stored definition;
            // combat and autosave snapshots can be older than its refinement.
            // The admin content slots are the exception: the Admin Panel edits
            // and re-images their bloodline jutsu (one or all at once) and
            // persists through the ordinary save, so replacing its payload
            // with the stored copy silently discarded every admin edit. The
            // same schema, budget and rank normalization below still applies.
            const out: Record<string, unknown> = { ...(mayConsumeForge && storedEntry && requestedId !== writeIntent && !paidUpgrade && !allowRemoval ? storedEntry : bl) };
            // Existing ids may retain or lower their stored rank. New ids and rank
            // upgrades must consume an exact-rank forge purchase. With no purchase,
            // a new entry is discarded rather than silently granting free B rank.
            const rawRank = String(out.rank ?? '');
            let rank = KNOWN_BLOODLINE_RANKS.has(rawRank) ? rawRank : 'B Rank';
            const blId = String(out.id ?? '');
            // A bloodline id is one ownership/budget namespace. Keeping several
            // rows with the same id lets each row receive a fresh jutsu budget
            // and fresh unique-tag allowance, then session hydration folds every
            // row into one carried kit. First occurrence wins deterministically.
            if (blId && seenBloodlineIds.has(blId)) return null;
            if (blId) seenBloodlineIds.add(blId);
            const isUpgrade = storedRank !== undefined
                && (BLOODLINE_RANK_ORDER[rank] ?? 0) > (BLOODLINE_RANK_ORDER[storedRank] ?? 0);
            if (!storedRank || isUpgrade) {
                const requestedRank = parseBloodlineForgeRank(rawRank);
                const forge = mayConsumeForge && requestedRank && blId === writeIntent
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
            // Close the player-authored combat schema after text/image handling.
            // Numeric clamps alone are insufficient: the maker exposes discrete
            // AP/range/power/cooldown choices, derives targeting/utility, and
            // bounds tag magnitudes. Persist only that legitimate projection.
            out.jutsus = normalizePlayerBloodlineJutsus(out.jutsus, rank);
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
        // Ordinary saves have no delete action. A stale payload (including an
        // empty roster) must not erase an already forged bloodline. A paid new
        // forge may replace the oldest slot; admin content editing may delete.
        if (mayConsumeForge && !allowRemoval && acceptedEntitledNew === 0 && Array.isArray(existingArr)) {
            const ids = new Set(normalized.map((bloodline) => String(bloodline.id ?? '')));
            for (const entry of existingArr) {
                if (!entry || typeof entry !== 'object') continue;
                const id = String((entry as Record<string, unknown>).id ?? '');
                if (id && !ids.has(id) && normalized.length < BLOODLINE_CAP) {
                    normalized.push(structuredClone(entry as Record<string, unknown>));
                    ids.add(id);
                }
            }
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
    return { normalizeBloodlineArray, pendingBloodlineForges, consumedBloodlineForgeIds, RAW_BLOODLINE_IMAGE_MAX_BYTES };
}

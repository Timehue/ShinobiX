// Per-field validator for the villageState blob written via
// /api/game-state POST { kind: 'villageState' }.
//
// Before this layer existed, the writer only checked that the caller's
// `character.village` matched the URL village — any villager could ship
// a wholesale blob with their name as `seatedKage`, 99M ryo in treasury,
// fake "System" notice posts, themselves as ANBU, `hollowGateUnlocked:
// true`, etc.
//
// This module returns an audited next-state by merging the incoming
// blob with the existing one, accepting changes only where rules pass.
// Rejected mutations silently fall back to the existing field — we
// don't error out a whole write for one bad field (would break partial
// migrations / older clients), but the audit log entry tells admins
// what was suppressed.

import { kv } from './_storage.js';
import { getActiveSilence } from './admin/moderation.js';
import { sanitizeUserText, TEXT_LIMITS } from './_text-moderation.js';
import { cleanTreasuryItems } from './_treasury-donate.js';

// Loose shape — we don't want to depend on the client's exact union of
// nested types here, just enough structure for the rule engine.
type VillageStateBlob = {
    treasury?: Record<string, unknown>;
    contributionPoints?: number;
    notices?: string[];
    noticePosts?: Array<Record<string, unknown>>;
    warRecords?: unknown[];
    kageSystemUnlocked?: boolean;
    firstLiberator?: string;
    seatedKage?: string;
    anbuAppointees?: string[];
    kageHistory?: unknown[];
    kageChallenges?: Array<Record<string, unknown>>;
    dailyAgenda?: Record<string, unknown>;
    hollowGateUnlocked?: boolean;
    [k: string]: unknown;
};

type ValidatorContext = {
    callerName: string;          // already-normalized lowercase, or '' for admin
    isAdmin: boolean;
    village: string;             // canonical (matches the URL/body village)
};

const TREASURY_KEYS = ['ryo', 'honorSeals', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals'] as const;

// Lazy-expiry window for kage challenges. A challenge that's been open
// (not yet "resolved" / "expired") for more than 7 days is auto-expired
// on the next write so an abandoned challenge doesn't block the village
// forever. Picked 7 days because the official-duel ready window is
// only minutes wide; anything older is dead.
const KAGE_CHALLENGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// #17 — village-treasury currencies are CREDITED ONLY by server endpoints now,
// not the save blob: player donations via /api/village/treasury/donate, and the
// daily-agenda reward via /api/village/claim-daily-agenda. Both atomically move
// the source → treasury, and the client re-asserts the returned treasury at a
// zero delta, so a save-blob currency INCREASE here is credit-without-debit and
// is rejected below (admin bypasses). contributionPoints stays client-credited
// (a per-player stat, not the shared currency pool) and keeps its per-call cap.

const MAX_CONTRIBUTION_INCREASE_PER_CALL = 5_000;
const MAX_NOTICE_POSTS = 60;     // matches client cap
const MAX_KAGE_CHALLENGES = 16;  // open-set ceiling
const MAX_ANBU_APPOINTEES = 12;

function num(v: unknown, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function lower(v: unknown): string {
    return String(v ?? '').trim().toLowerCase();
}

/**
 * Audit-validate an incoming villageState write against the existing blob
 * and the authoritative `village:kage:<slug>` record. Returns the merged
 * next-state and any suppressed-field reasons (for logging).
 *
 * Note: for currency *increases* we trust the caller's claim that they
 * also debited their own save — the client does this. A malicious caller
 * who skips the debit only "donates" fake money, which the seatedKage
 * cannot extract because withdrawals are bounded and gated. The escape
 * hatch is the per-call ceiling above.
 */
export async function validateVillageStateWrite(
    existing: VillageStateBlob | null,
    incoming: VillageStateBlob,
    ctx: ValidatorContext,
    // The authoritative kage state — pass from caller so we don't re-fetch.
    kageState: { seatedKage?: string; kageSystemUnlocked?: boolean; firstLiberator?: string } | null,
): Promise<{ next: VillageStateBlob; suppressed: string[] }> {
    const suppressed: string[] = [];
    const prev: VillageStateBlob = existing ?? {};
    const next: VillageStateBlob = { ...prev, ...incoming };

    const authoritativeSeatedKage = lower(kageState?.seatedKage);
    const callerIsSeatedKage = ctx.isAdmin || (!!ctx.callerName && ctx.callerName === authoritativeSeatedKage);

    // ── seatedKage / firstLiberator / kageSystemUnlocked ────────────
    // Mirror the authoritative source. Whatever the client sent is
    // overwritten by what /api/village/kage says.
    if (kageState) {
        next.seatedKage = kageState.seatedKage ?? prev.seatedKage;
        next.kageSystemUnlocked = kageState.kageSystemUnlocked ?? prev.kageSystemUnlocked;
        next.firstLiberator = kageState.firstLiberator ?? prev.firstLiberator;
        if (lower(incoming.seatedKage) !== lower(next.seatedKage)) {
            suppressed.push('seatedKage (mirrored from /api/village/kage)');
        }
    }

    // ── anbuAppointees ──────────────────────────────────────────────
    // Only the seatedKage (or admin) may change this list. Anyone else
    // gets the existing list preserved.
    const incomingAnbu = Array.isArray(incoming.anbuAppointees) ? incoming.anbuAppointees.slice(0, MAX_ANBU_APPOINTEES) : undefined;
    if (incomingAnbu !== undefined) {
        const sameAsBefore = Array.isArray(prev.anbuAppointees)
            && prev.anbuAppointees.length === incomingAnbu.length
            && prev.anbuAppointees.every((n, i) => lower(n) === lower(incomingAnbu[i]));
        if (!sameAsBefore && !callerIsSeatedKage) {
            next.anbuAppointees = prev.anbuAppointees ?? [];
            suppressed.push('anbuAppointees (only seatedKage may change)');
        } else {
            next.anbuAppointees = incomingAnbu;
        }
    }

    // ── hollowGateUnlocked ──────────────────────────────────────────
    // false → true only by seatedKage / admin. true → false rejected
    // unless admin (one-way unlock).
    const wasUnlocked = prev.hollowGateUnlocked === true;
    const wantsUnlocked = incoming.hollowGateUnlocked === true;
    if (wantsUnlocked && !wasUnlocked) {
        if (!callerIsSeatedKage) {
            next.hollowGateUnlocked = wasUnlocked;
            suppressed.push('hollowGateUnlocked → true (only seatedKage may unlock)');
        } else {
            next.hollowGateUnlocked = true;
        }
    } else if (!wantsUnlocked && wasUnlocked) {
        if (!ctx.isAdmin) {
            next.hollowGateUnlocked = true;
            suppressed.push('hollowGateUnlocked → false (admin only)');
        } else {
            next.hollowGateUnlocked = false;
        }
    } else {
        next.hollowGateUnlocked = wantsUnlocked || wasUnlocked || false;
    }

    // ── warLossDebuffUntil (demoralized debuff) ─────────────────────
    // Set ONLY by the server at war settlement (api/world-state.ts). The client
    // may never clear or shorten it — pin to the previous value if a write tries
    // to lower it, so a losing village can't dodge its 3-day training debuff.
    {
        const prevUntil = Number(prev.warLossDebuffUntil ?? 0) || 0;
        const inUntil = Number(incoming.warLossDebuffUntil ?? prevUntil) || 0;
        if (!ctx.isAdmin && inUntil < prevUntil) {
            next.warLossDebuffUntil = prevUntil;
            suppressed.push('warLossDebuffUntil decrease (server-set only)');
        } else {
            next.warLossDebuffUntil = inUntil;
        }
    }

    // ── treasury ────────────────────────────────────────────────────
    // For each currency: positive deltas are bounded by per-call max;
    // negative deltas (withdrawals) require seatedKage.
    if (incoming.treasury && typeof incoming.treasury === 'object') {
        const prevTreasury = (prev.treasury ?? {}) as Record<string, unknown>;
        const inTreasury = incoming.treasury as Record<string, unknown>;
        const outTreasury: Record<string, unknown> = { ...prevTreasury };
        for (const key of TREASURY_KEYS) {
            const before = num(prevTreasury[key], 0);
            const after = num(inTreasury[key], before);
            const delta = after - before;
            if (delta > 0) {
                // #17 lockdown: village-treasury currencies are credited ONLY by
                // server endpoints (treasury/donate, claim-daily-agenda), which
                // the client re-asserts at a zero delta — a save-blob INCREASE is
                // credit-without-debit. Reject it (keep prev); admin bypasses.
                if (ctx.isAdmin) {
                    outTreasury[key] = after;
                } else {
                    outTreasury[key] = before;
                    suppressed.push(`treasury.${key} increase via save blob blocked — use the server endpoint`);
                }
            } else if (delta < 0) {
                if (!callerIsSeatedKage) {
                    outTreasury[key] = before;
                    suppressed.push(`treasury.${key} decrease (only seatedKage may withdraw)`);
                } else {
                    outTreasury[key] = Math.max(0, after);
                }
            } else {
                outTreasury[key] = before;
            }
        }
        // items: net-new additions must come from the atomic donate endpoint
        // (/api/village/treasury/donate), which verifies the donor actually
        // owned the item. The save blob may only RE-ASSERT the current items
        // (the migrated client re-saves the endpoint-credited treasury verbatim
        // → no delta) or REMOVE them (Kage withdrawals/sends). Any itemId whose
        // count rises — or a brand-new itemId — is a mint attempt and is
        // rejected (revert to prev). Admin bypasses. No gameplay reward adds
        // treasury items via the save blob, so this only blocks abuse. Closes
        // audit item #16's treasury.items minting hole.
        const prevRawItems = Array.isArray(prevTreasury.items) ? prevTreasury.items : [];
        if (Array.isArray(inTreasury.items)) {
            const prevCounts = new Map(cleanTreasuryItems(prevRawItems).map((s) => [s.itemId, s.count]));
            const incomingStacks = cleanTreasuryItems(inTreasury.items);
            const minted = ctx.isAdmin ? [] : incomingStacks.filter((s) => s.count > (prevCounts.get(s.itemId) ?? 0));
            if (minted.length > 0) {
                outTreasury.items = prevRawItems.slice(0, 200);
                suppressed.push(`village treasury.items net-new [${minted.map((s) => s.itemId).join(',')}] blocked — donate via /api/village/treasury/donate`);
            } else {
                outTreasury.items = incomingStacks.slice(0, 200);
            }
        } else {
            outTreasury.items = prevRawItems.slice(0, 200);
        }
        next.treasury = outTreasury;
    }

    // ── contributionPoints ──────────────────────────────────────────
    if (typeof incoming.contributionPoints === 'number') {
        const before = num(prev.contributionPoints, 0);
        const after = num(incoming.contributionPoints, before);
        if (after - before > MAX_CONTRIBUTION_INCREASE_PER_CALL) {
            next.contributionPoints = before + MAX_CONTRIBUTION_INCREASE_PER_CALL;
            suppressed.push(`contributionPoints +${after - before} > cap`);
        } else if (after < before && !callerIsSeatedKage) {
            next.contributionPoints = before;
            suppressed.push('contributionPoints decrease (only seatedKage)');
        } else {
            next.contributionPoints = Math.max(0, after);
        }
    }

    // ── noticePosts ─────────────────────────────────────────────────
    // Adds: new entries (any not in prev) must have author === caller
    // (or admin); "order" type requires seatedKage; caller must not be
    // silenced. Removes: only seatedKage.
    if (Array.isArray(incoming.noticePosts)) {
        const prevPosts = Array.isArray(prev.noticePosts) ? prev.noticePosts : [];
        const prevIds = new Set(prevPosts.map((p) => String((p as Record<string, unknown>).id ?? '')).filter(Boolean));
        const incomingPosts = incoming.noticePosts.slice(0, MAX_NOTICE_POSTS);

        // Detect removals — if any prev post is missing from incoming and
        // caller isn't seatedKage, reject the whole list change.
        const incomingIds = new Set(incomingPosts.map((p) => String((p as Record<string, unknown>).id ?? '')).filter(Boolean));
        const removed = [...prevIds].filter((id) => !incomingIds.has(id));
        if (removed.length > 0 && !callerIsSeatedKage) {
            next.noticePosts = prevPosts;
            suppressed.push(`noticePosts removed ${removed.length} entries (only seatedKage may delete)`);
        } else {
            // Validate additions one by one.
            const silence = ctx.isAdmin ? null : await getActiveSilence(ctx.callerName).catch(() => null);
            const cleaned: typeof incomingPosts = [];
            for (const raw of incomingPosts) {
                const post = (raw ?? {}) as Record<string, unknown>;
                const id = String(post.id ?? '');
                if (id && prevIds.has(id)) {
                    // Existing post — keep as-is (the client may legitimately
                    // change pinned status or similar; we don't validate here).
                    cleaned.push(post);
                    continue;
                }
                // New post.
                if (silence) {
                    suppressed.push('noticePost rejected (caller silenced)');
                    continue;
                }
                const author = lower(post.author);
                const type = String(post.type ?? 'general');
                if (!ctx.isAdmin) {
                    if (author && author !== ctx.callerName) {
                        suppressed.push(`noticePost rejected (author "${author}" ≠ caller)`);
                        continue;
                    }
                    if (type === 'order' && !callerIsSeatedKage) {
                        suppressed.push('noticePost type=order rejected (only seatedKage)');
                        continue;
                    }
                }
                // Moderate user-supplied notice text. Admin bypasses (so
                // System / Narrator posts with intentional URLs survive).
                if (!ctx.isAdmin) {
                    if (typeof post.title === 'string') {
                        post.title = sanitizeUserText(post.title, TEXT_LIMITS.noticeTitle);
                    }
                    if (typeof post.body === 'string') {
                        post.body = sanitizeUserText(post.body, TEXT_LIMITS.noticeBody);
                    }
                    // Drop empty post that's been fully redacted to nothing.
                    if ((!post.title || !String(post.title).trim()) && (!post.body || !String(post.body).trim())) {
                        suppressed.push('noticePost rejected (empty after moderation)');
                        continue;
                    }
                }
                cleaned.push(post);
            }
            next.noticePosts = cleaned;
        }
    }

    // ── kageChallenges ──────────────────────────────────────────────
    // Adds must have challenger === caller. Updates to existing entries
    // are allowed when the caller is the original challenger, the seated
    // Kage, or admin.
    if (Array.isArray(incoming.kageChallenges)) {
        const prevChals = Array.isArray(prev.kageChallenges) ? prev.kageChallenges : [];
        const prevById = new Map(prevChals.map((c) => [String((c as Record<string, unknown>).id ?? ''), c]));
        const incomingChals = incoming.kageChallenges.slice(0, MAX_KAGE_CHALLENGES);
        const cleaned: typeof incomingChals = [];
        for (const raw of incomingChals) {
            const chal = (raw ?? {}) as Record<string, unknown>;
            const id = String(chal.id ?? '');
            const existing = id ? prevById.get(id) : undefined;
            if (!existing) {
                // New challenge — challenger must be caller.
                if (!ctx.isAdmin && lower(chal.challenger) !== ctx.callerName) {
                    suppressed.push(`kageChallenge rejected (challenger "${lower(chal.challenger)}" ≠ caller)`);
                    continue;
                }
                // Server-stamp createdAt. Never trust the client — a future
                // value would make the lazy-expiry below never fire, keeping a
                // challenge actionable forever.
                chal.createdAt = Date.now();
                cleaned.push(chal);
            } else {
                // Update — caller must be challenger, seatedKage, or admin.
                const orig = existing as Record<string, unknown>;
                const origChallenger = lower(orig.challenger);
                const origSeatedKage = lower(orig.seatedKage);
                const canMutate = ctx.isAdmin
                    || ctx.callerName === origChallenger
                    || ctx.callerName === origSeatedKage
                    || callerIsSeatedKage;
                if (!canMutate) {
                    cleaned.push(existing); // discard edit, keep original
                    suppressed.push(`kageChallenge update on "${id}" rejected (not party to challenge)`);
                } else {
                    // Preserve the server-stamped createdAt across updates; the
                    // client may patch status/response but must not re-stamp the clock.
                    if (orig.createdAt != null) chal.createdAt = orig.createdAt;
                    cleaned.push(chal);
                }
            }
        }
        next.kageChallenges = cleaned;
    }

    // ── Lazy-expire stale kage challenges ───────────────────────────
    // Independent of the incoming write: if the resulting list contains
    // any challenge that's been open more than KAGE_CHALLENGE_MAX_AGE_MS
    // without resolving, flip its status to "expired" so the UI stops
    // showing it as actionable. Idempotent on subsequent writes.
    if (Array.isArray(next.kageChallenges) && next.kageChallenges.length > 0) {
        const now = Date.now();
        next.kageChallenges = next.kageChallenges.map((raw) => {
            const c = (raw ?? {}) as Record<string, unknown>;
            const status = String(c.status ?? '');
            if (status === 'resolved' || status === 'expired') return c;
            const created = num(c.createdAt, 0);
            if (created > 0 && now - created > KAGE_CHALLENGE_MAX_AGE_MS) {
                return { ...c, status: 'expired' };
            }
            return c;
        });
    }

    // ── warRecords, kageHistory ─────────────────────────────────────
    // Append-only sanity: never SHORTER than before unless admin.
    if (Array.isArray(incoming.warRecords)) {
        const prevLen = Array.isArray(prev.warRecords) ? prev.warRecords.length : 0;
        if (!ctx.isAdmin && incoming.warRecords.length < prevLen) {
            next.warRecords = prev.warRecords;
            suppressed.push('warRecords shortened (admin only)');
        }
    }
    if (Array.isArray(incoming.kageHistory)) {
        const prevLen = Array.isArray(prev.kageHistory) ? prev.kageHistory.length : 0;
        if (!ctx.isAdmin && incoming.kageHistory.length < prevLen) {
            next.kageHistory = prev.kageHistory;
            suppressed.push('kageHistory shortened (admin only)');
        }
    }

    return { next, suppressed };
}

// Convenience: fetch the authoritative village:kage:<slug> record.
export async function loadAuthoritativeKage(village: string) {
    const slug = village.toLowerCase().replace(/\s+/g, '-');
    return (await kv.get<{ seatedKage?: string; kageSystemUnlocked?: boolean; firstLiberator?: string }>(`village:kage:${slug}`)) ?? null;
}

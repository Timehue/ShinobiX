// Per-field validator for the villageState blob written via
// /api/game-state POST { kind: 'villageState' }.
//
// Before this layer existed, the writer only checked that the caller's
// `character.village` matched the URL village — any villager could ship
// a wholesale blob with their name as `seatedKage`, 99M ryo in treasury,
// fake "System" notice posts, themselves as ANBU, a far-future
// `hollowGateUnlockedUntil`, etc.
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
import { safeName } from './_utils.js';
import { villageOrderRole } from './_village-order-role.js';

// Loose shape — we don't want to depend on the client's exact union of
// nested types here, just enough structure for the rule engine.
type VillageStateBlob = {
    treasury?: Record<string, unknown>;
    upgrades?: Record<string, unknown>;
    contributionPoints?: number;
    notices?: string[];
    noticePosts?: Array<Record<string, unknown>>;
    warRecords?: unknown[];
    kageSystemUnlocked?: boolean;
    firstLiberator?: string;
    seatedKage?: string;
    anbuAppointees?: string[];
    kageHistory?: unknown[];
    dailyAgenda?: Record<string, unknown>;
    hollowGateUnlockedUntil?: number;
    hollowGateExpiryNoticedFor?: number;
    [k: string]: unknown;
};

type ValidatorContext = {
    callerName: string;          // already-normalized lowercase, or '' for admin
    isAdmin: boolean;
    village: string;             // canonical (matches the URL/body village)
};

// provisions / materialPoints are the Village Stores (api/_village-stores.ts):
// credited only by /api/village/treasury/donate, drained only by the daily
// pass + /api/village/war-structure — same rule as the currencies below.
const TREASURY_KEYS = ['ryo', 'honorSeals', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals', 'provisions', 'materialPoints'] as const;

// #17 — village-treasury currencies are CREDITED ONLY by server endpoints now,
// not the save blob: player donations via /api/village/treasury/donate, and the
// daily-agenda reward via /api/village/claim-daily-agenda. Both atomically move
// the source → treasury, and the client re-asserts the returned treasury at a
// zero delta, so a save-blob currency INCREASE here is credit-without-debit and
// is rejected below (admin bypasses). contributionPoints stays client-credited
// (a per-player stat, not the shared currency pool) and keeps its per-call cap.

const MAX_CONTRIBUTION_INCREASE_PER_CALL = 5_000;
const MAX_NOTICE_POSTS = 60;     // matches client cap

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

    // Appointments must validate real village players through /village/elder-focus.
    // Pin even Kage/admin blob writes so stale council caches cannot restore cleared seats.
    if (incoming.elderAppointees !== undefined && JSON.stringify(incoming.elderAppointees) !== JSON.stringify(prev.elderAppointees ?? null)) {
        suppressed.push('elderAppointees (use the elder appointment endpoint)');
    }
    if (prev.elderAppointees !== undefined) next.elderAppointees = prev.elderAppointees;
    else delete next.elderAppointees;
    delete next.elderTerm;

    const authoritativeSeatedKage = safeName(String(kageState?.seatedKage ?? ''));
    const callerIsSeatedKage = ctx.isAdmin || (!!ctx.callerName && ctx.callerName === authoritativeSeatedKage);

    // ── seatedKage / firstLiberator / kageSystemUnlocked ────────────
    // Mirror the authoritative source. Whatever the client sent is
    // overwritten by what /api/village/kage says.
    next.seatedKage = kageState?.seatedKage;
    next.kageSystemUnlocked = Boolean(kageState?.kageSystemUnlocked);
    next.firstLiberator = kageState?.firstLiberator;
    if (lower(incoming.seatedKage) !== lower(next.seatedKage)) suppressed.push('seatedKage (mirrored from /api/village/kage)');

    // Appointments change only through the atomic /village/anbu action.
    if (incoming.anbuAppointees !== undefined && JSON.stringify(incoming.anbuAppointees) !== JSON.stringify(prev.anbuAppointees ?? [])) suppressed.push('anbuAppointees (use the ANBU appointment endpoint)');
    next.anbuAppointees = prev.anbuAppointees ?? [];
    // Earned seats are computed from server-owned monthly PvP results.
    delete next.anbuEarned;
    delete next.anbuMembers;

    // The paid endpoint debits the player's seals. A blob write cannot buy time.
    const hgNow = Date.now();
    const prevUntil = Math.max(0, num(prev.hollowGateUnlockedUntil, 0));
    const inUntil = Math.max(0, num(incoming.hollowGateUnlockedUntil, prevUntil));
    next.hollowGateUnlockedUntil = ctx.isAdmin ? inUntil : prevUntil;
    if (!ctx.isAdmin && inUntil !== prevUntil) suppressed.push('hollowGateUnlockedUntil (use the paid unlock endpoint)');

    // ── warLossDebuffUntil (legacy name; comeback rally window) ─────
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

    // ── warWinBuffUntil (victor's morale buff) ──────────────────────
    // Set ONLY by the server at war settlement (api/world-state.ts). The guard
    // runs the OPPOSITE way to the debuff above: a debuff is dodged by shortening
    // it, a buff is stolen by EXTENDING it — so pin to the previous value if a
    // write tries to raise it, and let a client clear its own buff harmlessly.
    {
        const prevUntil = Number(prev.warWinBuffUntil ?? 0) || 0;
        const inUntil = Number(incoming.warWinBuffUntil ?? prevUntil) || 0;
        if (!ctx.isAdmin && inUntil > prevUntil) {
            next.warWinBuffUntil = prevUntil;
            suppressed.push('warWinBuffUntil increase (server-set only)');
        } else {
            next.warWinBuffUntil = inUntil;
        }
    }

    // ── treasury ────────────────────────────────────────────────────
    // For each currency: positive deltas are bounded by per-call max;
    // negative deltas (withdrawals) require seatedKage.
    // ── Village upgrades: SERVER-OWNED, never client-writable ───────
    // Village upgrades are shared infrastructure bought from the treasury seal
    // pool by /api/village/upgrade, which writes this key directly. The blob
    // merge above is `{ ...prev, ...incoming }`, so without this line ANY
    // villager could POST `upgrades: { training: 50, bank: 50, ... }` and the
    // levels would land on the shared record — and from there onto every
    // member's character mirror, paying real bank interest, mission rewards,
    // shop discount and training rate. Stored always wins; admin bypasses.
    if (!ctx.isAdmin) {
        if (prev.upgrades !== undefined) next.upgrades = prev.upgrades;
        else delete next.upgrades;
        const inUpgrades = JSON.stringify((incoming as Record<string, unknown>).upgrades ?? null);
        if (inUpgrades !== 'null' && inUpgrades !== JSON.stringify(prev.upgrades ?? null)) {
            suppressed.push('upgrades change via save blob blocked — use /api/village/upgrade');
        }
    }

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
    // Every category on the Village Orders board requires a current player
    // leadership seat. A focus preference or a client-authored title is not a role.
    if (Object.prototype.hasOwnProperty.call(incoming, 'noticePosts')) {
        const prevPosts = Array.isArray(prev.noticePosts) ? prev.noticePosts : [];
        const role = JSON.stringify(incoming.noticePosts) === JSON.stringify(prevPosts) || ctx.isAdmin
            ? null : await villageOrderRole(ctx.callerName, ctx.village, prev, kageState);
        const canManage = (post: Record<string, unknown>) => ctx.isAdmin || role === 'Kage'
            || (role !== null && safeName(String(post.author ?? '')) === ctx.callerName);
        const prevById = new Map(prevPosts.map(post => [String(post.id ?? ''), post]));
        const incomingPosts = Array.isArray(incoming.noticePosts) ? incoming.noticePosts.slice(0, MAX_NOTICE_POSTS) : [];

        const incomingIds = new Set(incomingPosts.map(post => String(post?.id ?? '')).filter(Boolean));
        const removed = prevPosts.filter(post => !incomingIds.has(String(post.id ?? '')));
        if (!Array.isArray(incoming.noticePosts)) {
            next.noticePosts = prevPosts;
            suppressed.push('noticePosts rejected (expected an order list)');
        } else if (JSON.stringify(incoming.noticePosts) === JSON.stringify(prevPosts)) {
            next.noticePosts = prevPosts;
        } else if (!ctx.isAdmin && role === null) {
            next.noticePosts = prevPosts;
            suppressed.push('noticePosts rejected (only seated Kage, ANBU, or current Elders may post or manage orders)');
        } else if (removed.some(post => !canManage(post))) {
            next.noticePosts = prevPosts;
            suppressed.push('noticePosts removal rejected (only Kage or a current leadership author may delete)');
        } else {
            const silence = ctx.isAdmin ? null : await getActiveSilence(ctx.callerName);
            const cleaned: typeof incomingPosts = [];
            const seen = new Set<string>();
            for (const raw of incomingPosts) {
                const post = { ...(raw ?? {}) } as Record<string, unknown>;
                const id = String(post.id ?? '');
                if (!id || seen.has(id)) {
                    suppressed.push('noticePost rejected (missing or duplicate id)');
                    continue;
                }
                seen.add(id);
                const previous = prevById.get(id);
                if (previous) {
                    // The board only offers pin/unpin and delete. Reassert stored
                    // text and attribution so an echoed ID cannot rewrite an order.
                    const pinned = post.pinned === undefined ? Boolean(previous.pinned) : Boolean(post.pinned);
                    const canPin = canManage(previous) && !silence;
                    if (pinned !== Boolean(previous.pinned) && !canPin) suppressed.push('noticePost pin rejected (leadership author or Kage required)');
                    cleaned.push(canPin ? { ...previous, pinned } : previous);
                    continue;
                }
                // New post.
                if (silence) {
                    suppressed.push('noticePost rejected (caller silenced)');
                    continue;
                }
                const author = safeName(String(post.author ?? ''));
                const type = String(post.type ?? 'general');
                if (!ctx.isAdmin) {
                    if (!author || author !== ctx.callerName) {
                        suppressed.push(`noticePost rejected (author "${author}" ≠ caller)`);
                        continue;
                    }
                    if (!['order', 'raid', 'guard', 'medic', 'trade', 'general'].includes(type)) {
                        suppressed.push('noticePost rejected (invalid village order type)');
                        continue;
                    }
                    post.authorRole = role;
                    post.createdAt = Date.now();
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

    // ── Hollow Gate re-seal notice ──────────────────────────────────
    // When the 30-day unlock has lapsed (and stays lapsed in this write),
    // post a one-time System notice so villagers learn the shrine closed.
    // Runs under withKvLock (single writer) and is deduped both by a
    // per-expiry marker and a deterministic post id, so concurrent writers
    // can't double-post. Fires lazily on the first village write after
    // expiry — independent of who wrote it.
    {
        const noticedFor = num(prev.hollowGateExpiryNoticedFor, 0);
        const nextUntil = num(next.hollowGateUnlockedUntil, 0);
        if (prevUntil > 0 && prevUntil <= hgNow && nextUntil <= hgNow && noticedFor !== prevUntil) {
            const post = {
                id: `hg-reseal-${prevUntil}`,
                type: 'general',
                title: 'Hollow Gate Re-Sealed',
                body: 'The Hollow Gate seal has re-bound. The shrine has faded from the World Map. A seated Kage must break the seal again to reopen it.',
                author: 'System',
                authorRole: 'System',
                createdAt: hgNow,
                pinned: false,
            };
            const existingPosts = Array.isArray(next.noticePosts) ? next.noticePosts : [];
            if (!existingPosts.some((p) => String((p as Record<string, unknown>).id ?? '') === post.id)) {
                next.noticePosts = [post, ...existingPosts].slice(0, MAX_NOTICE_POSTS);
            }
            next.hollowGateExpiryNoticedFor = prevUntil;
        }
    }

    // ── kageChallenges (legacy) ─────────────────────────────────────
    // The old client-side vote/window challenge model is gone; succession is
    // server-authoritative (/api/village/kage-challenge). Shed the field from
    // any blob that still carries it — nothing reads it anymore.
    if ('kageChallenges' in next) delete (next as Record<string, unknown>).kageChallenges;

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

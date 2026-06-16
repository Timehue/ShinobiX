import { isCleanText as isCleanClanText } from './_text-moderation.js';
import { cleanTreasuryItems } from './_treasury-donate.js';
import { safeName } from './_utils.js';

// Per-field validator for clan-* saves written via /api/save/clan-<slug>.
//
// Before this layer the writer only checked that the caller's
// `character.clan` matched the clan slug — meaning any rank-and-file
// member could rewrite the entire blob: kick everyone, promote themselves
// to Founder via roleOverrides, fabricate `activeWar: { ourScore: 99999,
// endsAt: past }` and immediately mint legendary war crates.
//
// This module audit-validates per field. Suppressed mutations fall back
// to the existing value — we don't reject the whole write (would break
// legitimate concurrent edits) but log what was suppressed.

// Loose shape so we don't depend on the client's union of nested types.
type ClanBlob = {
    name?: string;
    village?: string;
    founderName?: string;
    image?: string;
    createdAt?: number;
    level?: number;
    xp?: number;
    members?: Array<Record<string, unknown>>;
    treasury?: Record<string, unknown>;
    upgrades?: Record<string, number>;
    warHistory?: Array<Record<string, unknown>>;
    activeWar?: Record<string, unknown>;
    roleOverrides?: Record<string, string>;
    joinRequests?: Array<Record<string, unknown>>;
    notices?: Array<Record<string, unknown>>;
    [k: string]: unknown;
};

type ClanContext = {
    callerName: string;          // lowercase, or '' for admin
    isAdmin: boolean;
};

const TREASURY_KEYS = ['ryo', 'fateShards', 'boneCharms', 'auraStones', 'mythicSeals', 'warSupply'] as const;
// #17 — clan-treasury currencies are now CREDITED ONLY by server endpoints, not
// the save blob: the donatable currencies (ryo/fateShards/boneCharms/auraStones/
// mythicSeals) via /api/clan/treasury/donate, and warSupply via
// /api/clan/territory/collect-supply. Both atomically move the source → treasury
// and the client then re-asserts the returned treasury at a zero delta, so a
// save-blob currency INCREASE here is credit-without-debit and is rejected below
// (admin bypasses). Honor Seals use the /api/clan/seal-pool/donate endpoint.
const MAX_ACTIVE_WAR_SCORE_PER_WRITE = 100;
// Auto-finalize stale clan wars. A war whose endsAt is more than 24h
// in the past is treated as abandoned on the next write — moved into
// warHistory as a draw and cleared from activeWar so the clan can
// declare a new one. Without this, an abandoned war leaves activeWar
// set forever, blocking new declarations.
const ACTIVE_WAR_GRACE_MS = 24 * 60 * 60 * 1000;
const MAX_MEMBERS = 50;
const MAX_NOTICES = 24;
const MAX_JOIN_REQUESTS = 30;
const MAX_WAR_HISTORY = 100;

// Roles that can mutate other-people fields (members, roleOverrides,
// activeWar, warHistory). Founder always counts.
const ADMIN_ROLES = new Set(['Founder', 'Leader', 'Officer']);

function num(v: unknown, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}
function lower(v: unknown): string {
    return String(v ?? '').trim().toLowerCase();
}

function callerRole(blob: ClanBlob | null, callerName: string): string {
    if (!blob || !callerName) return '';
    // callerName is a safeName() slug ([a-z0-9_-]); founderName + override keys
    // are stored DISPLAY names, so canonicalize them through safeName() before
    // comparing. A plain lower() left a multi-word founder (e.g. "Aka Ito" →
    // "aka ito" ≠ slug "akaito") unrecognized as their own clan's Founder.
    if (safeName(String(blob.founderName ?? '')) === callerName) return 'Founder';
    const overrides = (blob.roleOverrides ?? {}) as Record<string, string>;
    // roleOverrides may be keyed by display name OR slug — canonicalize both.
    for (const [k, v] of Object.entries(overrides)) {
        if (safeName(k) === callerName || lower(k) === callerName) return String(v);
    }
    return ''; // ordinary member
}

/**
 * Audit-validate an incoming clan-save write against the existing blob.
 * Returns the merged next-state and any suppressed-field reasons.
 */
export function validateClanSaveWrite(
    existing: ClanBlob | null,
    incoming: ClanBlob,
    ctx: ClanContext,
): { next: ClanBlob; suppressed: string[] } {
    const suppressed: string[] = [];
    const prev: ClanBlob = existing ?? {};
    const next: ClanBlob = { ...prev, ...incoming };

    const role = callerRole(prev, ctx.callerName);

    // ── Bootstrap (first clan write) ─────────────────────────────────
    // `existing === null` means this is the very first write of the clan
    // record. The save handler only reaches the validator with a null
    // existing after it has already verified (its `allowCreate` gate) that
    // the caller is the declared founder of a not-yet-existing clan, so we
    // trust the creator to seed the clan's identity + their own membership
    // here. Without this, the founder/roster fields below get stripped
    // against the empty `prev`, producing an ownerless clan that breaks
    // founder-only delete + seal-pool distribution auth. Treasury / activeWar
    // / warHistory are deliberately NOT relaxed (a fresh clan has none, and
    // relaxing them would let a creator mint a war crate on the first write).
    const bootstrapping = !existing && !prev.founderName && !prev.name;
    const callerClaimsFounder = safeName(String(incoming.founderName ?? '')) === ctx.callerName;
    const bootstrapFounder = bootstrapping && (ctx.isAdmin || callerClaimsFounder);

    const callerIsFounder = ctx.isAdmin || role === 'Founder' || bootstrapFounder;
    const callerIsAdminRole = ctx.isAdmin || ADMIN_ROLES.has(role);
    // Roster/social fields — also writable by the founder creating the clan.
    const callerCanManageRoster = callerIsAdminRole || bootstrapFounder;

    // ── founderName ─────────────────────────────────────────────────
    // Never change unless admin (or the founder claiming a brand-new clan).
    // Hard-pin to the existing value otherwise.
    if (lower(incoming.founderName) !== lower(prev.founderName)) {
        if (!ctx.isAdmin && !bootstrapFounder) {
            next.founderName = prev.founderName;
            suppressed.push('founderName change (admin only)');
        }
    }

    // ── name / createdAt / village ──────────────────────────────────
    // Treat as immutable post-creation.
    if (prev.name && lower(incoming.name) !== lower(prev.name)) {
        if (!ctx.isAdmin) { next.name = prev.name; suppressed.push('name change (admin only)'); }
    }
    // On clan creation (no prev.name), gate the incoming name through the
    // strict moderation check. We reject rather than asterisk-mask because
    // the clan slug is derived from the name and slug routing keys can't
    // include `*`. Existing clans (prev.name present) are immutable above.
    if (!prev.name && incoming.name && !ctx.isAdmin) {
        if (!isCleanClanText(String(incoming.name))) {
            // Strip the name from the incoming blob — the save endpoint's
            // upstream check rejects clan saves without a usable name.
            delete next.name;
            suppressed.push('clan name failed content moderation');
        }
    }
    if (prev.createdAt && incoming.createdAt && Number(incoming.createdAt) !== Number(prev.createdAt)) {
        if (!ctx.isAdmin) { next.createdAt = prev.createdAt; suppressed.push('createdAt change (admin only)'); }
    }
    if (prev.village && lower(incoming.village) !== lower(prev.village)) {
        if (!ctx.isAdmin) { next.village = prev.village; suppressed.push('village change (admin only)'); }
    }

    // ── doctrine ─────────────────────────────────────────────────────
    // The clan's identity perk, chosen at creation. Only the founder (or admin)
    // may change it afterward, and only to a known value — otherwise pin to the
    // previous doctrine so a tampered member write can't swap perks or inject junk.
    if (incoming.doctrine !== undefined) {
        const KNOWN_DOCTRINES = new Set(['none', 'warmonger', 'merchant', 'scholars', 'medics']);
        const inDoc = String(incoming.doctrine);
        const changed = lower(inDoc) !== lower(prev.doctrine);
        if (changed && !callerIsFounder && prev.doctrine !== undefined) {
            next.doctrine = prev.doctrine;
            suppressed.push('doctrine change (founder only)');
        } else if (!KNOWN_DOCTRINES.has(inDoc)) {
            next.doctrine = prev.doctrine ?? 'none';
            suppressed.push('unknown doctrine value rejected');
        }
    }

    // ── members ─────────────────────────────────────────────────────
    // A regular member can only add/remove themselves. Admin-role
    // members can add/remove anyone (legitimate kicks + accept-joins).
    if (Array.isArray(incoming.members)) {
        const prevMembers = Array.isArray(prev.members) ? prev.members : [];
        const prevByName = new Map(prevMembers.map((m) => [lower((m as Record<string, unknown>).name), m]));
        const incomingMembers = incoming.members.slice(0, MAX_MEMBERS);
        const incomingByName = new Map(incomingMembers.map((m) => [lower((m as Record<string, unknown>).name), m]));

        const added: string[] = [];
        const removed: string[] = [];
        for (const n of incomingByName.keys()) if (n && !prevByName.has(n)) added.push(n);
        for (const n of prevByName.keys()) if (n && !incomingByName.has(n)) removed.push(n);

        if (!callerCanManageRoster) {
            // Only self-membership changes are allowed.
            const illegalAdds = added.filter((n) => n !== ctx.callerName);
            const illegalRemoves = removed.filter((n) => n !== ctx.callerName);
            if (illegalAdds.length > 0 || illegalRemoves.length > 0) {
                // Revert the whole members array to its prior state — too
                // risky to partially apply (could create dupes or holes).
                next.members = prevMembers;
                if (illegalAdds.length > 0) suppressed.push(`members illegal add: ${illegalAdds.join(',')}`);
                if (illegalRemoves.length > 0) suppressed.push(`members illegal remove: ${illegalRemoves.join(',')}`);
            } else {
                next.members = incomingMembers;
            }
        } else {
            next.members = incomingMembers;
        }
    }

    // ── roleOverrides ───────────────────────────────────────────────
    // Only Founder (or admin) can change anyone's role override. A
    // non-Founder can only edit their own override (which is meaningless,
    // they can't promote themselves; but a leave-clan-and-clear-override
    // self-edit needs to work).
    if (incoming.roleOverrides && typeof incoming.roleOverrides === 'object') {
        const prevOverrides = (prev.roleOverrides ?? {}) as Record<string, string>;
        const incomingOverrides = incoming.roleOverrides as Record<string, string>;
        if (callerIsFounder) {
            next.roleOverrides = incomingOverrides;
        } else {
            // Allow only self-key changes; everything else preserved.
            const merged: Record<string, string> = { ...prevOverrides };
            const allKeys = new Set([...Object.keys(prevOverrides), ...Object.keys(incomingOverrides)]);
            for (const k of allKeys) {
                if (lower(k) === ctx.callerName) {
                    if (incomingOverrides[k] !== undefined) merged[k] = incomingOverrides[k];
                    else delete merged[k];
                }
            }
            const changedKeys = Object.keys(incomingOverrides).filter((k) => incomingOverrides[k] !== prevOverrides[k] && lower(k) !== ctx.callerName);
            const removedKeys = Object.keys(prevOverrides).filter((k) => !(k in incomingOverrides) && lower(k) !== ctx.callerName);
            if (changedKeys.length > 0) suppressed.push(`roleOverrides change for [${changedKeys.join(',')}] (Founder only)`);
            if (removedKeys.length > 0) suppressed.push(`roleOverrides remove [${removedKeys.join(',')}] (Founder only)`);
            next.roleOverrides = merged;
        }
    }

    // ── activeWar ───────────────────────────────────────────────────
    // Score deltas bounded; startedAt immutable; endsAt locked once set.
    // Field-edit allowed only by admin-role callers (these wars are
    // declared by leadership; if a regular member tries to set one,
    // reject).
    if (incoming.activeWar !== undefined) {
        const prevWar = (prev.activeWar ?? null) as Record<string, unknown> | null;
        const inWar = incoming.activeWar as Record<string, unknown> | null;

        if (inWar === null) {
            // Ending the war. Only admin-role callers may.
            if (!callerIsAdminRole) {
                next.activeWar = prevWar ?? undefined;
                suppressed.push('activeWar end (admin role only)');
            } else {
                delete next.activeWar;
            }
        } else if (!prevWar) {
            // Declaring a new war. Only admin-role callers; clamp scores
            // to 0 and stamp startedAt to now. endsAt accepted as-is but
            // must be in the future and within 14 days.
            if (!callerIsAdminRole) {
                next.activeWar = undefined;
                suppressed.push('activeWar declare (admin role only)');
            } else {
                const now = Date.now();
                const maxEnds = now + 14 * 24 * 60 * 60 * 1000;
                const endsAt = Math.min(maxEnds, Math.max(now + 60_000, num(inWar.endsAt, now + 24 * 60 * 60 * 1000)));
                next.activeWar = {
                    opponentClan: String(inWar.opponentClan ?? ''),
                    enemyVillage: String(inWar.enemyVillage ?? ''),
                    ourScore: 0,
                    enemyScore: 0,
                    startedAt: now,
                    endsAt,
                };
            }
        } else {
            // Updating an existing war. Scores can grow within per-write
            // cap. startedAt + opponent + endsAt immutable.
            const prevOur = num(prevWar.ourScore, 0);
            const prevEnemy = num(prevWar.enemyScore, 0);
            const incOur = num(inWar.ourScore, prevOur);
            const incEnemy = num(inWar.enemyScore, prevEnemy);
            const ourDelta = Math.max(0, Math.min(MAX_ACTIVE_WAR_SCORE_PER_WRITE, incOur - prevOur));
            const enemyDelta = Math.max(0, Math.min(MAX_ACTIVE_WAR_SCORE_PER_WRITE, incEnemy - prevEnemy));
            if (incOur - prevOur > MAX_ACTIVE_WAR_SCORE_PER_WRITE) {
                suppressed.push(`activeWar.ourScore +${incOur - prevOur} > cap ${MAX_ACTIVE_WAR_SCORE_PER_WRITE}`);
            }
            if (incEnemy - prevEnemy > MAX_ACTIVE_WAR_SCORE_PER_WRITE) {
                suppressed.push(`activeWar.enemyScore +${incEnemy - prevEnemy} > cap ${MAX_ACTIVE_WAR_SCORE_PER_WRITE}`);
            }
            if (incOur < prevOur && !ctx.isAdmin) suppressed.push('activeWar.ourScore decrease (admin only)');
            if (incEnemy < prevEnemy && !ctx.isAdmin) suppressed.push('activeWar.enemyScore decrease (admin only)');
            next.activeWar = {
                ...prevWar,
                ourScore: prevOur + ourDelta,
                enemyScore: prevEnemy + enemyDelta,
                startedAt: prevWar.startedAt,
                endsAt: prevWar.endsAt,
                opponentClan: prevWar.opponentClan,
                enemyVillage: prevWar.enemyVillage,
            };
        }
    }

    // ── warHistory ──────────────────────────────────────────────────
    // Append-only; only admin-role can add. New entries: at most 1 per
    // write so members can't mass-mint Legendary War Crates by jamming
    // the array. Total length capped.
    if (Array.isArray(incoming.warHistory)) {
        const prevHistory = Array.isArray(prev.warHistory) ? prev.warHistory : [];
        const inHistory = incoming.warHistory.slice(0, MAX_WAR_HISTORY);
        if (inHistory.length < prevHistory.length && !ctx.isAdmin) {
            next.warHistory = prevHistory;
            suppressed.push('warHistory shortened (admin only)');
        } else if (inHistory.length === prevHistory.length) {
            // Same length: a verbatim re-assert (the client re-saves the
            // unchanged history on every clan write) is fine for anyone. A
            // CONTENT change at the same length is either a leadership
            // war-finalization at the 12-entry cap (prepend + drop oldest) or an
            // abuse attempt to swap an existing entry's result / reward /
            // warCrateId to mint a War Crate claim without adding an entry.
            // Allow it only for admin-role callers — same trust as adding an
            // entry (closes #16's same-length warHistory swap gap).
            if (callerIsAdminRole || JSON.stringify(inHistory) === JSON.stringify(prevHistory)) {
                next.warHistory = inHistory;
            } else {
                next.warHistory = prevHistory;
                suppressed.push('warHistory in-place content edit (admin role only)');
            }
        } else {
            const added = inHistory.length - prevHistory.length;
            if (added > 1) {
                next.warHistory = [...inHistory.slice(0, prevHistory.length + 1)];
                suppressed.push(`warHistory added ${added} entries (cap 1/write)`);
            } else if (!callerIsAdminRole) {
                next.warHistory = prevHistory;
                suppressed.push('warHistory add (admin role only)');
            } else {
                next.warHistory = inHistory;
            }
        }
    }

    // ── treasury ────────────────────────────────────────────────────
    if (incoming.treasury && typeof incoming.treasury === 'object') {
        const prevTreasury = (prev.treasury ?? {}) as Record<string, unknown>;
        const inTreasury = incoming.treasury as Record<string, unknown>;
        const outTreasury: Record<string, unknown> = { ...prevTreasury };
        for (const key of TREASURY_KEYS) {
            const before = num(prevTreasury[key], 0);
            const after = num(inTreasury[key], before);
            const delta = after - before;
            if (delta > 0) {
                // #17 lockdown: clan-treasury currencies are credited ONLY by
                // server endpoints (donate / collect-supply), which the client
                // re-asserts at a zero delta — so a save-blob INCREASE is
                // credit-without-debit. Reject it (keep prev); admin bypasses.
                if (ctx.isAdmin) {
                    outTreasury[key] = after;
                } else {
                    outTreasury[key] = before;
                    suppressed.push(`clan treasury.${key} increase via save blob blocked — use the server endpoint`);
                }
            } else if (delta < 0) {
                if (!callerIsAdminRole) {
                    outTreasury[key] = before;
                    suppressed.push(`clan treasury.${key} decrease (admin role only)`);
                } else {
                    outTreasury[key] = Math.max(0, after);
                }
            } else {
                outTreasury[key] = before;
            }
        }
        // items: net-new additions must come from the atomic donate endpoint
        // (/api/clan/treasury/donate), which verifies the donor actually owned
        // the item. The save blob may only RE-ASSERT the current items (the
        // migrated client re-saves the endpoint-credited treasury verbatim → no
        // delta) or REMOVE them (leadership withdrawals/sends). Any itemId whose
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
                suppressed.push(`clan treasury.items net-new [${minted.map((s) => s.itemId).join(',')}] blocked — donate via /api/clan/treasury/donate`);
            } else {
                outTreasury.items = incomingStacks.slice(0, 200);
            }
        } else {
            outTreasury.items = prevRawItems.slice(0, 200);
        }
        next.treasury = outTreasury;
    }

    // ── joinRequests ────────────────────────────────────────────────
    // Anyone can add a request for themselves. Removing requests is
    // admin-role only (accept/deny flow). Names are canonicalized through
    // safeName() — the same form as ctx.callerName — so a multi-word player
    // (e.g. "Aka Ito" → "akaito") is recognized as adding their OWN request
    // instead of being mistaken for someone else's (which would suppress the
    // self-add and silently drop the join request).
    if (Array.isArray(incoming.joinRequests)) {
        const prevReqs = Array.isArray(prev.joinRequests) ? prev.joinRequests : [];
        const prevNames = new Set(prevReqs.map((r) => safeName(String((r as Record<string, unknown>).name ?? ''))));
        const incomingReqs = incoming.joinRequests.slice(0, MAX_JOIN_REQUESTS);
        const incomingNames = new Set(incomingReqs.map((r) => safeName(String((r as Record<string, unknown>).name ?? ''))));
        const added = [...incomingNames].filter((n) => n && !prevNames.has(n));
        const removed = [...prevNames].filter((n) => n && !incomingNames.has(n));
        const badAdds = ctx.isAdmin ? [] : added.filter((n) => n !== ctx.callerName);
        const badRemoves = (callerIsAdminRole) ? [] : removed.filter((n) => n !== ctx.callerName);
        if (badAdds.length > 0 || badRemoves.length > 0) {
            next.joinRequests = prevReqs;
            if (badAdds.length > 0) suppressed.push(`joinRequest illegal add: ${badAdds.join(',')}`);
            if (badRemoves.length > 0) suppressed.push(`joinRequest illegal remove: ${badRemoves.join(',')}`);
        } else {
            next.joinRequests = incomingReqs;
        }
    }

    // ── notices (clan notice board) ─────────────────────────────────
    // Adds: author must match caller (or admin); admin-role can add for
    // anyone. Removes: admin-role only.
    if (Array.isArray(incoming.notices)) {
        const prevNotices = Array.isArray(prev.notices) ? prev.notices : [];
        const prevIds = new Set(prevNotices.map((n) => String((n as Record<string, unknown>).id ?? '')).filter(Boolean));
        const incomingNotices = incoming.notices.slice(0, MAX_NOTICES);
        const incomingIds = new Set(incomingNotices.map((n) => String((n as Record<string, unknown>).id ?? '')).filter(Boolean));
        const removed = [...prevIds].filter((id) => !incomingIds.has(id));
        if (removed.length > 0 && !callerIsAdminRole) {
            next.notices = prevNotices;
            suppressed.push(`clan notices remove ${removed.length} (admin role only)`);
        } else {
            const cleaned: typeof incomingNotices = [];
            for (const raw of incomingNotices) {
                const post = (raw ?? {}) as Record<string, unknown>;
                const id = String(post.id ?? '');
                if (id && prevIds.has(id)) { cleaned.push(post); continue; }
                if (!ctx.isAdmin && lower(post.author) && lower(post.author) !== ctx.callerName) {
                    suppressed.push(`clan notice rejected (author "${lower(post.author)}" ≠ caller)`);
                    continue;
                }
                cleaned.push(post);
            }
            next.notices = cleaned;
        }
    }

    // ── Lazy-finalize stale activeWar ───────────────────────────────
    // Independent of the write: if the resulting blob has an activeWar
    // whose endsAt is > ACTIVE_WAR_GRACE_MS in the past, move it into
    // warHistory as a draw and clear activeWar. Idempotent — once
    // moved, the next write sees no activeWar to expire.
    const finalWar = next.activeWar as Record<string, unknown> | undefined;
    if (finalWar && typeof finalWar === 'object') {
        const endsAt = num(finalWar.endsAt, 0);
        const now = Date.now();
        if (endsAt > 0 && now - endsAt > ACTIVE_WAR_GRACE_MS) {
            const ourScore = num(finalWar.ourScore, 0);
            const enemyScore = num(finalWar.enemyScore, 0);
            const result: 'Won' | 'Lost' | 'Draw' =
                ourScore > enemyScore ? 'Won' :
                ourScore < enemyScore ? 'Lost' :
                'Draw';
            const archived = {
                opponent: String(finalWar.opponentClan ?? 'Unknown'),
                result,
                finalScore: `${ourScore} - ${enemyScore}`,
                topAttacker: '',
                topDefender: '',
                mvpClan: '',
                reward: 'Auto-finalized (no activity)',
                date: new Date().toISOString().slice(0, 10),
                endedAt: now,
            };
            const prevHistory = Array.isArray(next.warHistory) ? next.warHistory : [];
            next.warHistory = [archived, ...prevHistory].slice(0, MAX_WAR_HISTORY);
            delete next.activeWar;
            suppressed.push('activeWar auto-finalized (stale: endsAt > 24h past)');
        }
    }

    return { next, suppressed };
}

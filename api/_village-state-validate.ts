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

// #17 — village-treasury currencies move ONLY through server endpoints, never
// the save blob: donations via /api/village/treasury/donate, the daily-agenda
// reward via /api/village/claim-daily-agenda, Kage gifts via
// /api/village/treasury/transfer. Each moves source and treasury atomically,
// so a blob delta in either direction is rejected below (admin bypasses): an
// increase is credit-without-debit, a decrease is a stale re-assert.
// contributionPoints stays client-credited (a per-player stat, not the shared
// currency pool) and keeps its per-call cap.

const MAX_CONTRIBUTION_INCREASE_PER_CALL = 5_000;
const MAX_NOTICE_POSTS = 60;     // matches client cap
const MAX_NOTICES = 8;           // the activity log; matches the client's slice
// Moderation reads no more of an incoming line than this. Its result is cut to
// TEXT_LIMITS.villageActivityLine anyway, and it runs under the village lock:
// sanitizeUserText took about 0.2 s per megabyte (measured 2026-10-09), so a
// 5 MB request could hold every other write to the village for a second.
const MAX_NOTICE_SCAN = 4 * TEXT_LIMITS.villageActivityLine;

function num(v: unknown, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function lower(v: unknown): string {
    return String(v ?? '').trim().toLowerCase();
}

function isText(v: unknown): v is string {
    return typeof v === 'string';
}

/** An incoming activity line, and the form the moderation pass would store. */
type IncomingNotice = { raw: unknown; clean: string };

/**
 * Length of the longest run of the stored activity log (newest first) that
 * `lines` repeats from its first entry, or 0 if it repeats none.
 *
 * A client sends its last copy of the log, which can be a few writes stale, so
 * the run may start part-way down the stored log. It may run past the stored
 * log's end only when that log is full (older lines were cut there since the
 * client read it), and stop short of the end only when the client cut its own
 * list at the cap. A line also matches its moderated form: the client that
 * wrote it keeps its own unmoderated copy until its next read.
 */
function storedNoticeRun(lines: readonly IncomingNotice[], stored: readonly string[], clientCut: boolean): number {
    const storedFull = stored.length >= MAX_NOTICES;
    let best = 0;
    for (let start = 0; start < stored.length; start++) {
        const left = stored.length - start;
        if (lines.length > left && !storedFull) continue;
        if (lines.length < left && !clientCut) continue;
        const run = Math.min(lines.length, left);
        let matched = 0;
        while (matched < run) {
            const line = lines[matched];
            const storedLine = stored[start + matched];
            if (line.raw !== storedLine && (!line.clean || line.clean !== storedLine)) break;
            matched++;
        }
        if (matched === run) best = Math.max(best, run);
    }
    return best;
}

/**
 * Audit-validate an incoming villageState write against the existing blob
 * and the authoritative `village:kage:<slug>` record. Returns the merged
 * next-state and any suppressed-field reasons (for logging).
 *
 * The treasury is server-owned: a non-admin blob can neither credit nor
 * debit it (see the treasury block below), so its value is always the one
 * the server endpoints last wrote.
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

    // Server-owned settlement journals. Each is read as PROOF that a server
    // write already happened, so a blob write — any villager's, the Kage's, or
    // an admin's — may never forge, clear or replace one, exactly as
    // api/_clan-save-validate.ts pins its journals for clan rows:
    //  - settlementReceipts: the treasury transfer saga
    //    (api/_cross-key-settlement.ts) reads a receipt as proof the treasury
    //    was ALREADY debited and skips the balance check, the recipient checks
    //    and the debit; donations (api/_save-debit-saga.ts) read one as proof a
    //    credit already landed. Unpinned, a Kage could plant one with this save
    //    and then gift ryo the treasury did not hold.
    //  - agendaClaimReceipts: the only gate on the daily agenda's treasury
    //    tithe (api/village/claim-daily-agenda.ts). Unpinned, a villager could
    //    reset it and collect the tithe again on every claim.
    //  - warSpoilsReceipts: proof that a won village war's spoils already left
    //    (or reached) this treasury (api/world-state.ts settleVillageWarSpoils).
    //    Unpinned, a villager could clear it while a settlement is being
    //    retried and have the loser debited twice.
    for (const journal of ['settlementReceipts', 'agendaClaimReceipts', 'warSpoilsReceipts'] as const) {
        if (incoming[journal] !== undefined && JSON.stringify(incoming[journal]) !== JSON.stringify(prev[journal] ?? null)) {
            suppressed.push(`${journal} (server-owned settlement journal)`);
        }
        if (prev[journal] !== undefined) next[journal] = prev[journal];
        else delete next[journal];
    }

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

    // ── War morale stamps: SERVER-OWNED, never client-writable ──────
    // Both are set ONLY by the server at war settlement (api/world-state.ts
    // settleVillageWar via api/_war-morale.ts settlementMoralePatch), and the
    // client only ever reads them (api/village/war-debuff.ts). So a non-admin
    // blob may not move either one in EITHER direction.
    //
    // This used to guard one direction per field, and the loss stamp's guard
    // went stale when the stamp changed meaning. `warLossDebuffUntil` began as a
    // training DEBUFF, so only a decrease was blocked. It is now the losing
    // village's comeback RALLY (+10% training XP, −10% jutsu time, applied
    // server-side at every training seal), so an increase was the dangerous
    // direction and it was accepted: any villager could post a far-future
    // stamp and hand their whole village a permanent boost. Pinning both ways
    // cannot go stale again whichever way the multipliers point.
    for (const stamp of ['warLossDebuffUntil', 'warWinBuffUntil'] as const) {
        const prevUntil = Number(prev[stamp] ?? 0) || 0;
        const inUntil = Number(incoming[stamp] ?? prevUntil) || 0;
        if (ctx.isAdmin) {
            next[stamp] = inUntil;
        } else {
            next[stamp] = prevUntil;
            if (inUntil !== prevUntil) suppressed.push(`${stamp} change (server-set only)`);
        }
    }

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

    // ── treasury: SERVER-OWNED ──────────────────────────────────────
    // Every treasury movement has its own server endpoint now: donations
    // (/api/village/treasury/donate), Kage gifts of currency AND items
    // (/api/village/treasury/transfer), upgrades (/api/village/upgrade), the
    // daily agenda (claim-daily-agenda), and the stores drains (the daily pass,
    // /api/village/war-structure). The blob only ever RE-ASSERTS a treasury the
    // client read, and that read can be seconds stale (members poll it from
    // /api/village/state on a cadence). So the
    // blob may not move the treasury in EITHER direction. A stale LOWER figure
    // used to be accepted from the seated Kage (the retired blob-withdrawal path)
    // and, for items, from any villager, which erased donations that landed
    // after that client's last poll. Stored always wins; admin bypasses.
    if (incoming.treasury && typeof incoming.treasury === 'object') {
        const prevTreasury = (prev.treasury ?? {}) as Record<string, unknown>;
        const inTreasury = incoming.treasury as Record<string, unknown>;
        const outTreasury: Record<string, unknown> = { ...prevTreasury };
        for (const key of TREASURY_KEYS) {
            const before = num(prevTreasury[key], 0);
            const after = num(inTreasury[key], before);
            if (ctx.isAdmin) {
                outTreasury[key] = Math.max(0, after);
            } else {
                outTreasury[key] = before;
                if (after > before) suppressed.push(`treasury.${key} increase via save blob blocked — use the server endpoint`);
                else if (after < before) suppressed.push(`treasury.${key} decrease via save blob blocked — use the server endpoint`);
            }
        }
        // items: additions come from the atomic donate endpoint (which verifies
        // the donor owned the item) and removals from the transfer endpoint, so a
        // non-admin blob may only re-assert them. A rising count or a brand-new
        // itemId is a mint (audit item #16); a falling or missing one is a stale
        // list that would delete another villager's donation.
        const prevRawItems = Array.isArray(prevTreasury.items) ? prevTreasury.items : [];
        if (Array.isArray(inTreasury.items) && ctx.isAdmin) {
            outTreasury.items = cleanTreasuryItems(inTreasury.items).slice(0, 200);
        } else {
            outTreasury.items = prevRawItems.slice(0, 200);
            if (Array.isArray(inTreasury.items)) {
                const prevStacks = cleanTreasuryItems(prevRawItems);
                const incomingStacks = cleanTreasuryItems(inTreasury.items);
                const prevCounts = new Map(prevStacks.map((s) => [s.itemId, s.count]));
                const incomingCounts = new Map(incomingStacks.map((s) => [s.itemId, s.count]));
                const minted = incomingStacks.filter((s) => s.count > (prevCounts.get(s.itemId) ?? 0));
                const dropped = prevStacks.filter((s) => s.count > (incomingCounts.get(s.itemId) ?? 0));
                if (minted.length > 0) suppressed.push(`village treasury.items net-new [${minted.map((s) => s.itemId).join(',')}] blocked — donate via /api/village/treasury/donate`);
                if (dropped.length > 0) suppressed.push(`village treasury.items removal [${dropped.map((s) => s.itemId).join(',')}] blocked — send via /api/village/treasury/transfer`);
            }
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

    // ── notices (the Town Hall activity log) ────────────────────────
    // Plain lines, newest first ("X donated 1,000 ryo to the village
    // treasury."). Town Hall prepends ONE line per action and sends the whole
    // list back, cut at 8 (TownHall addNotice). So a member's write may add that
    // one line at the top and nothing more: every stored line keeps its text and
    // its place, and the oldest drops off past 8. Allowing several new lines
    // would let a client with a stale copy push the stored lines out and bring
    // old ones back. The new line is moderated like an order, and a silenced
    // member cannot add one. A write that leaves `notices` out keeps the stored
    // log; an admin's list replaces it (strings only, still capped, because the
    // Town Hall renders each entry as text).
    {
        const keepStored = () => {
            if (prev.notices !== undefined) next.notices = prev.notices;
            else delete next.notices;
        };
        const inNotices: unknown = incoming.notices;
        if (inNotices === undefined) {
            keepStored();
        } else if (!Array.isArray(inNotices)) {
            keepStored();
            suppressed.push('notices rejected (expected a list of lines)');
        } else if (ctx.isAdmin) {
            next.notices = inNotices.filter(isText).slice(0, MAX_NOTICES);
        } else {
            keepStored();
            const stored = Array.isArray(prev.notices) ? prev.notices.filter(isText) : [];
            const lines: IncomingNotice[] = inNotices.slice(0, MAX_NOTICES).map((raw) => ({
                raw,
                clean: sanitizeUserText(isText(raw) ? raw.slice(0, MAX_NOTICE_SCAN) : raw, TEXT_LIMITS.villageActivityLine),
            }));
            const clientCut = inNotices.length >= MAX_NOTICES;
            // Is the head a line this client just added, or the first line of its
            // copy of the log? A copy of the log, however stale, repeats a stored
            // run from its head; an added line pushes that run one entry down.
            // With no run at all (an empty log, or a copy older than every
            // stored line) the head is the only line that can be new.
            const echoRun = storedNoticeRun(lines, stored, clientCut);
            const tailRun = storedNoticeRun(lines.slice(1), stored, clientCut);
            if (lines.length > 0 && (echoRun === 0 || tailRun > echoRun)) {
                if (tailRun === 0 && lines.length > 1) {
                    suppressed.push(`notices: ${lines.length - 1} line(s) matching nothing stored dropped (one new line per write)`);
                }
                const line = lines[0].clean;
                if (!line) suppressed.push('notices line rejected (empty after moderation)');
                else if (await getActiveSilence(ctx.callerName)) suppressed.push('notices line rejected (caller silenced)');
                else next.notices = [line, ...stored].slice(0, MAX_NOTICES);
            }
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

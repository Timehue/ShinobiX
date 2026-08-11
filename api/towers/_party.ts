import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { kv as realKv } from '../_storage.js';
import { withKvLock as realWithKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';
import {
    MAX_TOWER_STARTS_PER_DAY,
    sessionKey,
    startCountKey,
    utcDateKey,
    type TowerKv,
    type TowerLock,
} from './_tower-store.js';
import type { TowerSession } from './_tower-session.js';
import { releaseTowerBattleLeases } from './_battle-lease.js';
import { compensateConfirmedMissingTowerEntry } from './_entry-recovery.js';

export const TOWER_PARTY_TTL = 2 * 60 * 60;
const TOWER_PARTY_TTL_MS = TOWER_PARTY_TTL * 1_000;
export const TOWER_PARTY_MIN = 2;
export const TOWER_PARTY_MAX = 4;
export const TOWER_PARTY_RECEIPT_CAP = 64;
export const TOWER_PARTY_LAUNCH_GRACE_MS = 5 * 60 * 1_000;

export const TOWER_PARTY_ID = /^tparty-[a-f0-9]{32}$/i;
export const TOWER_PARTY_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
export const TOWER_PARTY_REQUEST_ID = /^[A-Za-z0-9_-]{8,80}$/;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITE_CAP = 16;

export type TowerPartyBinding =
    | { mode: 'story'; floor: number }
    | { mode: 'spire'; ascensionTier: number };

export type TowerPartyMember = {
    slug: string;
    displayName: string;
    joinedAt: number;
    ready: boolean;
};

export type TowerPartyLaunch = {
    requestId: string;
    runId: string;
    seed: number;
    state: 'prepared' | 'active' | 'completed' | 'failed' | 'blocked';
    preparedAt: number;
    startCount?: number;
    errorCode?: string;
};

type TowerPartyReceipt = {
    actor: string;
    requestId: string;
    fingerprint: string;
    at: number;
};

export type StoredTowerParty = {
    id: string;
    inviteCode: string;
    hostSlug: string;
    binding: TowerPartyBinding;
    status: 'forming' | 'launching' | 'active' | 'closed';
    members: TowerPartyMember[];
    invitedSlugs: string[];
    version: number;
    createdAt: number;
    updatedAt: number;
    expiresAt: number;
    launch?: TowerPartyLaunch;
    receipts: TowerPartyReceipt[];
};

export type TowerPartyView = Omit<StoredTowerParty, 'receipts'> & {
    sizeRequirements: {
        min: number;
        max: number;
        /** Exact required size, or null when any size in the min/max range is valid. */
        required: number | null;
    };
    allReady: boolean;
    canLaunch: boolean;
};

export type TowerPartyInvitationView = {
    partyId: string;
    inviteCode: string;
    hostSlug: string;
    hostDisplayName: string;
    binding: TowerPartyBinding;
    memberCount: number;
    expiresAt: number;
};

export type TowerPartyMutationResult =
    | { ok: true; party: StoredTowerParty; replayed: boolean }
    | { ok: false; status: number; code: string; error: string; party?: StoredTowerParty };

export type TowerPartyLaunchResult = TowerPartyMutationResult;

export type TowerPartyDeps = {
    kv?: TowerKv;
    lock?: TowerLock;
    now?: () => number;
    id?: () => string;
    inviteCode?: () => string;
    seed?: () => number;
};

export const towerPartyKey = (partyId: string) => `tower-party:${partyId}`;
export const towerPartyCodeKey = (inviteCode: string) => `tower-party-code:${inviteCode}`;
export const towerPartyPlayerKey = (slug: string) => `tower-party-player:${slug}`;
export const towerPartyInviteKey = (slug: string) => `tower-party-invites:${slug}`;

function defaultInviteCode(): string {
    const bytes = randomBytes(8);
    return Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]!).join('');
}

function bindingEqual(a: TowerPartyBinding, b: TowerPartyBinding): boolean {
    return a.mode === b.mode
        && (a.mode === 'story'
            ? a.floor === (b as Extract<TowerPartyBinding, { mode: 'story' }>).floor
            : a.ascensionTier === (b as Extract<TowerPartyBinding, { mode: 'spire' }>).ascensionTier);
}

function isLiveParty(party: StoredTowerParty): boolean {
    return party.status === 'forming' || party.status === 'launching' || party.status === 'active';
}

function depsOf(deps: TowerPartyDeps) {
    return {
        kv: deps.kv ?? realKv,
        lock: deps.lock ?? realWithKvLock,
        now: deps.now ?? Date.now,
    };
}

async function requiredSet(kv: TowerKv, key: string, value: unknown, opts?: { ex?: number; nx?: boolean }): Promise<void> {
    if ((await kv.set(key, value, opts)) === null) throw new Error(`Tower party write rejected: ${key}`);
}

async function loadPartyWith(kv: TowerKv, partyId: string): Promise<StoredTowerParty | null> {
    if (!TOWER_PARTY_ID.test(partyId)) return null;
    return kv.get<StoredTowerParty>(towerPartyKey(partyId));
}

async function savePartyWith(kv: TowerKv, party: StoredTowerParty, now: number): Promise<StoredTowerParty> {
    // Parties have a fixed lifetime. Polling/mutations must not keep abandoned
    // ready rooms alive forever, and their code/player indexes use the same TTL.
    const ttl = Math.max(1, Math.ceil((party.expiresAt - now) / 1_000));
    const next = { ...party, updatedAt: now };
    await requiredSet(kv, towerPartyKey(next.id), next, { ex: ttl });
    return next;
}

async function clearPlayerIndexWith(kv: TowerKv, slug: string, partyId: string): Promise<void> {
    if (kv.delIfEqual) {
        await kv.delIfEqual(towerPartyPlayerKey(slug), partyId);
        return;
    }
    const current = await kv.get<string>(towerPartyPlayerKey(slug));
    if (current === partyId) await kv.del(towerPartyPlayerKey(slug));
}

async function clearCodeIndexWith(kv: TowerKv, inviteCode: string, partyId: string): Promise<void> {
    if (kv.delIfEqual) {
        await kv.delIfEqual(towerPartyCodeKey(inviteCode), partyId);
        return;
    }
    const current = await kv.get<string>(towerPartyCodeKey(inviteCode));
    if (current === partyId) await kv.del(towerPartyCodeKey(inviteCode));
}

/**
 * Rebuild one targeted-invitation projection from the freshest party record.
 * Party mutations and their per-player projection live in separate KV rows, so
 * an older invite/decline response may finish after a newer mutation. Loading
 * the party while holding the projection lock makes either completion converge
 * to current authority instead of letting the last network response win.
 */
async function reconcileInvitationIndex(
    partyId: string,
    slugInput: string,
    deps: TowerPartyDeps,
): Promise<void> {
    const { kv, lock } = depsOf(deps);
    const slug = safeName(slugInput);
    if (!slug) return;
    await lock(towerPartyInviteKey(slug), async () => {
        const party = await loadPartyWith(kv, partyId);
        const existing = (await kv.get<string[]>(towerPartyInviteKey(slug))) ?? [];
        const shouldInclude = !!party
            && party.status === 'forming'
            && party.invitedSlugs.includes(slug);
        const next = shouldInclude
            ? [partyId, ...existing.filter(id => id !== partyId)].slice(0, INVITE_CAP)
            : existing.filter(id => id !== partyId);
        if (next.length) await requiredSet(kv, towerPartyInviteKey(slug), next, { ex: TOWER_PARTY_TTL });
        else await kv.del(towerPartyInviteKey(slug));
    }, { failClosed: true });
}

export function towerPartyView(party: StoredTowerParty): TowerPartyView {
    const { receipts: _receipts, ...publicParty } = party;
    const required = party.binding.mode === 'spire' ? TOWER_PARTY_MAX : null;
    const validSize = required === null
        ? party.members.length >= TOWER_PARTY_MIN && party.members.length <= TOWER_PARTY_MAX
        : party.members.length === required;
    const allReady = party.members.length > 0 && party.members.every(member => member.ready);
    return {
        ...publicParty,
        sizeRequirements: { min: required ?? TOWER_PARTY_MIN, max: TOWER_PARTY_MAX, required },
        allReady,
        canLaunch: party.status === 'forming' && allReady && validSize,
    };
}

/**
 * Reconcile a live room with its bound durable run without refreshing either
 * TTL. A published active run remains recoverable; a confirmed-missing active
 * run (or an abandoned prepared launch past its grace window) is closed and all
 * projections/exact-run combat leases are compare-safely released.
 */
export async function repairStaleTowerPartyLifecycle(
    partyId: string,
    deps: TowerPartyDeps = {},
): Promise<StoredTowerParty | null> {
    const { kv, lock, now: clock } = depsOf(deps);
    let release: { party: StoredTowerParty; members: string[]; invitees: string[]; runId?: string } | null = null;
    const result = await lock(towerPartyKey(partyId), async () => {
        const party = await loadPartyWith(kv, partyId);
        if (!party) return null;
        if (party.status === 'closed') {
            const invitees = [...party.invitedSlugs];
            const sanitized = invitees.length
                ? await savePartyWith(kv, {
                    ...party,
                    invitedSlugs: [],
                    version: party.version + 1,
                }, clock())
                : party;
            release = {
                party: sanitized,
                members: sanitized.members.map(member => member.slug),
                invitees,
                ...(sanitized.launch ? { runId: sanitized.launch.runId } : {}),
            };
            return sanitized;
        }
        const now = clock();
        let shouldClose = false;
        let compensateMissingPreparedEntry = false;
        let launchState: TowerPartyLaunch['state'] = 'failed';
        let errorCode: string | undefined = 'run-unavailable';

        if (party.status === 'forming') {
            shouldClose = now >= party.expiresAt;
            errorCode = shouldClose ? 'party-expired' : undefined;
        } else if (!party.launch) {
            shouldClose = true;
        } else {
            // A storage read failure throws and leaves every lease/index intact.
            // Only an authoritative null is evidence that the run is missing.
            const session = await kv.get<TowerSession>(sessionKey(party.launch.runId));
            if (session) {
                if (session.status === 'done' && session.rewardSettlementState === 'settled') {
                    shouldClose = true;
                    launchState = 'completed';
                    errorCode = undefined;
                }
            } else if (party.status === 'active'
                || now - party.launch.preparedAt >= TOWER_PARTY_LAUNCH_GRACE_MS) {
                shouldClose = true;
                compensateMissingPreparedEntry = party.status === 'launching'
                    && now - party.launch.preparedAt >= TOWER_PARTY_LAUNCH_GRACE_MS;
            }
        }
        if (!shouldClose) return party;

        // A launching Story run that is still authoritatively absent after the
        // publication grace never became playable. Refund its durable receipt
        // before releasing the room/leases. Any storage/receipt uncertainty
        // throws and leaves the entire lifecycle intact for a later retry.
        if (compensateMissingPreparedEntry && party.binding.mode === 'story' && party.launch) {
            await compensateConfirmedMissingTowerEntry({
                hostSlug: party.hostSlug,
                partyId: party.id,
                runId: party.launch.runId,
            }, { kv, lock, now: clock });
        }

        const invitees = [...party.invitedSlugs];
        const closed = await savePartyWith(kv, {
            ...party,
            status: 'closed',
            invitedSlugs: [],
            version: party.version + 1,
            ...(party.launch ? { launch: { ...party.launch, state: launchState, errorCode } } : {}),
        }, now);
        release = {
            party: closed,
            members: closed.members.map(member => member.slug),
            invitees,
            ...(closed.launch ? { runId: closed.launch.runId } : {}),
        };
        return closed;
    }, { failClosed: true });

    const cleanup = release as {
        party: StoredTowerParty;
        members: string[];
        invitees: string[];
        runId?: string;
    } | null;
    if (cleanup) {
        await Promise.all(cleanup.members.map(member => clearPlayerIndexWith(kv, member, cleanup.party.id).catch(() => undefined)));
        await clearCodeIndexWith(kv, cleanup.party.inviteCode, cleanup.party.id).catch(() => undefined);
        await Promise.all(cleanup.invitees.map(slug => reconcileInvitationIndex(cleanup.party.id, slug, deps).catch(() => undefined)));
        if (cleanup.runId) {
            await releaseTowerBattleLeases(cleanup.runId, cleanup.members, { kv, lock }).catch(() => undefined);
        }
    }
    return result;
}

export async function loadTowerParty(partyId: string, deps: TowerPartyDeps = {}): Promise<StoredTowerParty | null> {
    if (!TOWER_PARTY_ID.test(partyId)) return null;
    return repairStaleTowerPartyLifecycle(partyId, deps);
}

export async function resolveTowerPartyCode(inviteCode: string, deps: TowerPartyDeps = {}): Promise<StoredTowerParty | null> {
    const code = inviteCode.trim().toUpperCase();
    if (!TOWER_PARTY_CODE.test(code)) return null;
    const kv = deps.kv ?? realKv;
    const partyId = await kv.get<string>(towerPartyCodeKey(code));
    return partyId ? repairStaleTowerPartyLifecycle(partyId, { ...deps, kv }) : null;
}

export async function activeTowerPartyForPlayer(slug: string, deps: TowerPartyDeps = {}): Promise<StoredTowerParty | null> {
    const kv = deps.kv ?? realKv;
    const partyId = await kv.get<string>(towerPartyPlayerKey(safeName(slug)));
    if (!partyId) return null;
    const party = await repairStaleTowerPartyLifecycle(partyId, { ...deps, kv });
    if (!party || !isLiveParty(party) || !party.members.some(member => member.slug === safeName(slug))) {
        // A stale projection expires with the room. Avoid deleting it here: an
        // unlocked read/delete repair could erase a newer party index written in
        // between those two operations.
        return null;
    }
    return party;
}

export async function createTowerParty(input: {
    hostSlug: string;
    displayName?: string;
    binding: TowerPartyBinding;
}, deps: TowerPartyDeps = {}): Promise<TowerPartyMutationResult> {
    const { kv, lock, now: clock } = depsOf(deps);
    const hostSlug = safeName(input.hostSlug);
    if (!hostSlug) return { ok: false, status: 400, code: 'invalid-host', error: 'Invalid host.' };
    const projectedPartyId = await kv.get<string>(towerPartyPlayerKey(hostSlug));
    if (projectedPartyId) await repairStaleTowerPartyLifecycle(projectedPartyId, deps);
    return lock(towerPartyPlayerKey(hostSlug), async () => {
        const existingId = await kv.get<string>(towerPartyPlayerKey(hostSlug));
        const existing = existingId ? await loadPartyWith(kv, existingId) : null;
        if (existing && isLiveParty(existing) && existing.members.some(member => member.slug === hostSlug)) {
            if (existing.hostSlug === hostSlug && existing.status === 'forming' && bindingEqual(existing.binding, input.binding)) {
                return { ok: true, party: existing, replayed: true };
            }
            return { ok: false, status: 409, code: 'already-in-party', error: 'Leave your current Tower party first.', party: existing };
        }
        if (existingId) await clearPlayerIndexWith(kv, hostSlug, existingId);

        const now = clock();
        const partyId = deps.id?.() ?? `tparty-${randomUUID().replace(/-/g, '')}`;
        if (!TOWER_PARTY_ID.test(partyId)) throw new Error('Invalid generated Tower party ID.');
        let inviteCode = '';
        for (let attempt = 0; attempt < 6; attempt++) {
            const candidate = (deps.inviteCode?.() ?? defaultInviteCode()).toUpperCase();
            if (!TOWER_PARTY_CODE.test(candidate)) throw new Error('Invalid generated Tower party invite code.');
            if (await kv.set(towerPartyCodeKey(candidate), partyId, { nx: true, ex: TOWER_PARTY_TTL })) {
                inviteCode = candidate;
                break;
            }
        }
        if (!inviteCode) throw new Error('Unable to mint a unique Tower party invite code.');

        const party: StoredTowerParty = {
            id: partyId,
            inviteCode,
            hostSlug,
            binding: input.binding,
            status: 'forming',
            members: [{ slug: hostSlug, displayName: String(input.displayName || hostSlug).slice(0, 40), joinedAt: now, ready: false }],
            invitedSlugs: [],
            version: 1,
            createdAt: now,
            updatedAt: now,
            expiresAt: now + TOWER_PARTY_TTL_MS,
            receipts: [],
        };
        try {
            await requiredSet(kv, towerPartyKey(party.id), party, { ex: TOWER_PARTY_TTL });
            await requiredSet(kv, towerPartyPlayerKey(hostSlug), party.id, { ex: TOWER_PARTY_TTL });
        } catch (error) {
            await kv.del(towerPartyCodeKey(inviteCode), towerPartyKey(party.id)).catch(() => 0);
            throw error;
        }
        return { ok: true, party, replayed: false };
    }, { failClosed: true });
}

export async function mutateTowerParty(input: {
    partyId: string;
    actor: string;
    requestId: string;
    expectedVersion: number;
    fingerprint: string;
    mutate: (party: StoredTowerParty, now: number) => TowerPartyMutationResult | Promise<TowerPartyMutationResult>;
}, deps: TowerPartyDeps = {}): Promise<TowerPartyMutationResult> {
    const { kv, lock, now: clock } = depsOf(deps);
    return lock(towerPartyKey(input.partyId), async () => {
        const party = await loadPartyWith(kv, input.partyId);
        if (!party) return { ok: false, status: 404, code: 'party-not-found', error: 'That Tower party no longer exists.' };
        const prior = party.receipts.find(receipt => receipt.actor === input.actor && receipt.requestId === input.requestId);
        if (prior) {
            if (prior.fingerprint !== input.fingerprint) {
                return { ok: false, status: 409, code: 'request-conflict', error: 'That request ID was already used for another party action.', party };
            }
            return { ok: true, party, replayed: true };
        }
        if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== party.version) {
            return { ok: false, status: 409, code: 'version-conflict', error: 'The party changed. Review the latest status and retry.', party };
        }
        const now = clock();
        const result = await input.mutate(party, now);
        if (!result.ok) return result;
        // A state-already-satisfied command is still the first use of this
        // request ID. Persist its receipt so the token cannot later be reused
        // with another action/fingerprint; only the prior-receipt branch above
        // is a true replay.
        const next = await savePartyWith(kv, {
            ...result.party,
            version: party.version + 1,
            receipts: [{ actor: input.actor, requestId: input.requestId, fingerprint: input.fingerprint, at: now }, ...party.receipts]
                .slice(0, TOWER_PARTY_RECEIPT_CAP),
        }, now);
        return { ok: true, party: next, replayed: false };
    }, { failClosed: true });
}

export async function joinTowerParty(input: {
    actor: string;
    displayName?: string;
    partyId?: string;
    inviteCode?: string;
    requireTargetedInvite?: boolean;
    requestId: string;
    expectedVersion: number;
    fingerprint: string;
}, deps: TowerPartyDeps = {}): Promise<TowerPartyMutationResult> {
    const { kv, lock } = depsOf(deps);
    const actor = safeName(input.actor);
    const resolved = input.partyId
        ? await loadTowerParty(input.partyId, { ...deps, kv })
        : await resolveTowerPartyCode(String(input.inviteCode ?? ''), { ...deps, kv });
    if (!resolved) return { ok: false, status: 404, code: 'party-not-found', error: 'That Tower party or invite code is no longer valid.' };
    await activeTowerPartyForPlayer(actor, { ...deps, kv });
    return lock(towerPartyPlayerKey(actor), async () => {
        const ownId = await kv.get<string>(towerPartyPlayerKey(actor));
        const own = ownId ? await loadPartyWith(kv, ownId) : null;
        if (own && own.id !== resolved.id && isLiveParty(own)) {
            return { ok: false, status: 409, code: 'already-in-party', error: 'Leave your current Tower party first.', party: own };
        }
        await requiredSet(kv, towerPartyPlayerKey(actor), resolved.id, { ex: TOWER_PARTY_TTL });
        try {
            const joined = await mutateTowerParty({
                partyId: resolved.id,
                actor,
                requestId: input.requestId,
                expectedVersion: input.expectedVersion,
                fingerprint: input.fingerprint,
                mutate: (party, now) => {
                    if (party.status !== 'forming') return { ok: false, status: 409, code: 'party-locked', error: 'That Tower party has already launched.', party };
                    if (party.members.some(member => member.slug === actor)) return { ok: true, party, replayed: true };
                    if (input.requireTargetedInvite && !party.invitedSlugs.includes(actor)) {
                        return { ok: false, status: 403, code: 'invite-required', error: 'That invitation is no longer available.', party };
                    }
                    if (party.members.length >= TOWER_PARTY_MAX) return { ok: false, status: 409, code: 'party-full', error: 'The Tower party is full.', party };
                    const members = [
                        ...party.members.map(member => ({ ...member, ready: false })),
                        { slug: actor, displayName: String(input.displayName || actor).slice(0, 40), joinedAt: now, ready: false },
                    ];
                    return { ok: true, replayed: false, party: { ...party, members, invitedSlugs: party.invitedSlugs.filter(slug => slug !== actor) } };
                },
            }, deps);
            if (!joined.ok) {
                // A stale reconnect from an existing member must not erase its
                // valid index. Reconcile while the actor-index lock is held.
                const latest = await loadPartyWith(kv, resolved.id);
                if (latest?.members.some(member => member.slug === actor)) {
                    await requiredSet(kv, towerPartyPlayerKey(actor), resolved.id, { ex: TOWER_PARTY_TTL });
                } else {
                    await clearPlayerIndexWith(kv, actor, resolved.id);
                }
            } else {
                await reconcileInvitationIndex(resolved.id, actor, deps);
            }
            return joined;
        } catch (error) {
            // A write can be forwarded before its adapter throws. The freshest
            // roster decides whether the player index is preserved or removed.
            const latest = await loadPartyWith(kv, resolved.id).catch(() => null);
            if (latest?.members.some(member => member.slug === actor)) {
                await requiredSet(kv, towerPartyPlayerKey(actor), resolved.id, { ex: TOWER_PARTY_TTL }).catch(() => undefined);
            } else {
                await clearPlayerIndexWith(kv, actor, resolved.id).catch(() => undefined);
            }
            throw error;
        }
    }, { failClosed: true });
}

export async function leaveTowerParty(input: {
    partyId: string;
    actor: string;
    requestId: string;
    expectedVersion: number;
    fingerprint: string;
}, deps: TowerPartyDeps = {}): Promise<TowerPartyMutationResult> {
    const { kv, lock } = depsOf(deps);
    const actor = safeName(input.actor);
    return lock(towerPartyPlayerKey(actor), async () => {
        const result = await mutateTowerParty({ ...input, actor, mutate: (party) => {
            if (party.status !== 'forming') return { ok: false, status: 409, code: 'party-locked', error: 'A launching or active party cannot be left.', party };
            if (!party.members.some(member => member.slug === actor)) return { ok: false, status: 403, code: 'not-a-member', error: 'You are not in that Tower party.', party };
            const members = party.members.filter(member => member.slug !== actor).map(member => ({ ...member, ready: false }));
            const hostSlug = party.hostSlug === actor
                ? [...members].sort((a, b) => a.joinedAt - b.joinedAt || a.slug.localeCompare(b.slug))[0]?.slug ?? party.hostSlug
                : party.hostSlug;
            return { ok: true, replayed: false, party: { ...party, members, hostSlug, status: members.length ? 'forming' : 'closed' } };
        } }, deps);
        if (result.ok) await clearPlayerIndexWith(kv, actor, input.partyId);
        return result;
    }, { failClosed: true });
}

export async function kickTowerPartyMember(input: {
    partyId: string;
    actor: string;
    target: string;
    requestId: string;
    expectedVersion: number;
    fingerprint: string;
}, deps: TowerPartyDeps = {}): Promise<TowerPartyMutationResult> {
    const { kv, lock } = depsOf(deps);
    const actor = safeName(input.actor);
    const target = safeName(input.target);
    if (!target || target === actor) {
        return { ok: false, status: 400, code: 'invalid-target', error: 'Choose another current party member.' };
    }
    return lock(towerPartyPlayerKey(target), async () => {
        const result = await mutateTowerParty({
            partyId: input.partyId,
            actor,
            requestId: input.requestId,
            expectedVersion: input.expectedVersion,
            fingerprint: input.fingerprint,
            mutate: (party) => {
                if (party.hostSlug !== actor) {
                    return { ok: false, status: 403, code: 'host-required', error: 'Only the party host can remove members.', party };
                }
                if (party.status !== 'forming') {
                    return { ok: false, status: 409, code: 'party-locked', error: 'A launching or active party cannot remove members.', party };
                }
                if (!party.members.some(member => member.slug === target)) {
                    return { ok: false, status: 409, code: 'not-a-member', error: 'That player is no longer in the Tower party.', party };
                }
                return {
                    ok: true,
                    replayed: false,
                    party: {
                        ...party,
                        members: party.members
                            .filter(member => member.slug !== target)
                            .map(member => ({ ...member, ready: false })),
                        invitedSlugs: party.invitedSlugs.filter(slug => slug !== target),
                    },
                };
            },
        }, deps);
        if (result.ok) {
            await clearPlayerIndexWith(kv, target, input.partyId);
            await reconcileInvitationIndex(input.partyId, target, deps);
        }
        return result;
    }, { failClosed: true });
}

export async function setTowerPartyReady(input: {
    partyId: string;
    actor: string;
    ready: boolean;
    requestId: string;
    expectedVersion: number;
    fingerprint: string;
}, deps: TowerPartyDeps = {}): Promise<TowerPartyMutationResult> {
    const actor = safeName(input.actor);
    return mutateTowerParty({
        partyId: input.partyId,
        actor,
        requestId: input.requestId,
        expectedVersion: input.expectedVersion,
        fingerprint: input.fingerprint,
        mutate: (party) => {
        if (party.status !== 'forming') return { ok: false, status: 409, code: 'party-locked', error: 'Readiness is locked while launching or active.', party };
        if (!party.members.some(member => member.slug === actor)) return { ok: false, status: 403, code: 'not-a-member', error: 'You are not in that Tower party.', party };
        return {
            ok: true,
            replayed: false,
            party: { ...party, members: party.members.map(member => member.slug === actor ? { ...member, ready: input.ready } : member) },
        };
    } }, deps);
}

export async function inviteTowerPartyMember(input: {
    partyId: string;
    actor: string;
    target: string;
    requestId: string;
    expectedVersion: number;
    fingerprint: string;
}, deps: TowerPartyDeps = {}): Promise<TowerPartyMutationResult> {
    const target = safeName(input.target);
    if (!target) return { ok: false, status: 400, code: 'invalid-target', error: 'Choose a valid player.' };
    const actor = safeName(input.actor);
    const result = await mutateTowerParty({
        partyId: input.partyId,
        actor,
        requestId: input.requestId,
        expectedVersion: input.expectedVersion,
        fingerprint: input.fingerprint,
        mutate: (party) => {
        if (party.hostSlug !== actor) return { ok: false, status: 403, code: 'host-required', error: 'Only the party host can invite players.', party };
        if (party.status !== 'forming') return { ok: false, status: 409, code: 'party-locked', error: 'That Tower party has already launched.', party };
        if (party.members.length >= TOWER_PARTY_MAX) return { ok: false, status: 409, code: 'party-full', error: 'The Tower party is full.', party };
        if (party.members.some(member => member.slug === target) || party.invitedSlugs.includes(target)) return { ok: true, party, replayed: true };
        return { ok: true, replayed: false, party: { ...party, invitedSlugs: [...party.invitedSlugs, target].slice(-INVITE_CAP) } };
    } }, deps);
    if (result.ok) await reconcileInvitationIndex(input.partyId, target, deps);
    return result;
}

export async function declineTowerPartyInvitation(input: {
    partyId: string;
    actor: string;
    requestId: string;
    expectedVersion: number;
    fingerprint: string;
}, deps: TowerPartyDeps = {}): Promise<TowerPartyMutationResult> {
    const result = await mutateTowerParty({ ...input, mutate: (party) => {
        if (!party.invitedSlugs.includes(input.actor)) return { ok: true, party, replayed: true };
        return { ok: true, replayed: false, party: { ...party, invitedSlugs: party.invitedSlugs.filter(slug => slug !== input.actor) } };
    } }, deps);
    if (result.ok) await reconcileInvitationIndex(input.partyId, input.actor, deps);
    return result;
}

export async function revokeTowerPartyInvitation(input: {
    partyId: string;
    actor: string;
    target: string;
    requestId: string;
    expectedVersion: number;
    fingerprint: string;
}, deps: TowerPartyDeps = {}): Promise<TowerPartyMutationResult> {
    const actor = safeName(input.actor);
    const target = safeName(input.target);
    if (!target || target === actor) {
        return { ok: false, status: 400, code: 'invalid-target', error: 'Choose another invited player.' };
    }
    const result = await mutateTowerParty({
        partyId: input.partyId,
        actor,
        requestId: input.requestId,
        expectedVersion: input.expectedVersion,
        fingerprint: input.fingerprint,
        mutate: (party) => {
            if (party.hostSlug !== actor) {
                return { ok: false, status: 403, code: 'host-required', error: 'Only the party host can revoke invitations.', party };
            }
            if (party.status !== 'forming') {
                return { ok: false, status: 409, code: 'party-locked', error: 'A launching or active party cannot revoke invitations.', party };
            }
            if (!party.invitedSlugs.includes(target)) return { ok: true, party, replayed: true };
            return {
                ok: true,
                replayed: false,
                party: { ...party, invitedSlugs: party.invitedSlugs.filter(slug => slug !== target) },
            };
        },
    }, deps);
    if (result.ok) await reconcileInvitationIndex(input.partyId, target, deps);
    return result;
}

export async function towerPartyInvitations(slug: string, deps: TowerPartyDeps = {}): Promise<TowerPartyInvitationView[]> {
    const kv = deps.kv ?? realKv;
    const ids = (await kv.get<string[]>(towerPartyInviteKey(safeName(slug)))) ?? [];
    const parties = await Promise.all(ids.map(id => loadPartyWith(kv, id)));
    return parties
        .filter((party): party is StoredTowerParty => !!party && party.status === 'forming' && party.invitedSlugs.includes(safeName(slug)))
        .map(party => ({
            partyId: party.id,
            inviteCode: party.inviteCode,
            hostSlug: party.hostSlug,
            hostDisplayName: party.members.find(member => member.slug === party.hostSlug)?.displayName ?? party.hostSlug,
            binding: party.binding,
            memberCount: party.members.length,
            expiresAt: party.expiresAt,
        }));
}

export async function prepareTowerPartyLaunch(input: {
    partyId: string;
    hostSlug: string;
    requestId: string;
    expectedVersion: number;
    binding: TowerPartyBinding;
    enforceStartCap: boolean;
    /** Authenticated admin/testing escape hatch; production Spire parties require four. */
    allowShortSpireParty?: boolean;
}, deps: TowerPartyDeps = {}): Promise<TowerPartyLaunchResult> {
    const { kv, lock, now: clock } = depsOf(deps);
    let clearedInvites: string[] = [];
    const result = await lock<TowerPartyLaunchResult>(towerPartyKey(input.partyId), async () => {
        const party = await loadPartyWith(kv, input.partyId);
        if (!party) return { ok: false, status: 404, code: 'party-not-found', error: 'That Tower party no longer exists.' };
        if (party.hostSlug !== input.hostSlug) return { ok: false, status: 403, code: 'host-required', error: 'Only the party host can launch.', party };
        if (!bindingEqual(party.binding, input.binding)) return { ok: false, status: 409, code: 'binding-mismatch', error: 'The requested Tower floor does not match the party ready room.', party };

        const sameRequest = party.launch?.requestId === input.requestId;
        if (sameRequest && party.launch?.state === 'blocked') {
            return { ok: false, status: 429, code: party.launch.errorCode ?? 'daily-cap', error: 'Daily Battle Towers start limit reached.', party };
        }
        if (sameRequest && (party.status === 'launching' || party.status === 'active')) {
            if (!party.invitedSlugs.length) return { ok: true, party, replayed: true };
            clearedInvites = [...party.invitedSlugs];
            const repaired = await savePartyWith(kv, {
                ...party,
                invitedSlugs: [],
                version: party.version + 1,
            }, clock());
            return { ok: true, party: repaired, replayed: true };
        }
        if (party.status !== 'forming') return { ok: false, status: 409, code: 'party-active', error: 'That Tower party already has an active run.', party };
        if (!sameRequest && party.version !== input.expectedVersion) {
            return { ok: false, status: 409, code: 'version-conflict', error: 'The party changed. Review the latest status and retry.', party };
        }
        const spireNeedsFour = party.binding.mode === 'spire' && !input.allowShortSpireParty;
        const validSize = spireNeedsFour
            ? party.members.length === TOWER_PARTY_MAX
            : party.members.length >= TOWER_PARTY_MIN && party.members.length <= TOWER_PARTY_MAX;
        if (!validSize) {
            return {
                ok: false,
                status: 409,
                code: 'invalid-size',
                error: spireNeedsFour ? 'The Endless Spire requires exactly four ready members.' : 'A Tower party requires two to four members.',
                party,
            };
        }
        if (!party.members.every(member => member.ready)) {
            return { ok: false, status: 409, code: 'not-ready', error: 'Every current party member must be ready.', party };
        }

        const now = clock();
        const launch: TowerPartyLaunch = sameRequest && party.launch
            ? { ...party.launch, state: 'prepared', errorCode: undefined }
            : {
                requestId: input.requestId,
                runId: `tower-${(deps.id?.() ?? randomUUID()).replace(/^tparty-/, '').replace(/-/g, '')}`,
                seed: deps.seed?.() ?? randomInt(1, 0x7fffffff),
                state: 'prepared',
                preparedAt: now,
            };
        if (!sameRequest && input.enforceStartCap) {
            launch.startCount = await kv.incr(startCountKey(input.hostSlug, utcDateKey(now)), { ex: 25 * 60 * 60 });
            if (launch.startCount > MAX_TOWER_STARTS_PER_DAY) {
                launch.state = 'blocked';
                launch.errorCode = 'daily-cap';
                const blocked = await savePartyWith(kv, { ...party, launch, version: party.version + 1 }, now);
                return { ok: false, status: 429, code: 'daily-cap', error: 'Daily Battle Towers start limit reached.', party: blocked };
            }
        }
        clearedInvites = [...party.invitedSlugs];
        const next = await savePartyWith(kv, {
            ...party,
            status: 'launching',
            invitedSlugs: [],
            launch,
            version: party.version + 1,
        }, now);
        return { ok: true, party: next, replayed: sameRequest };
    }, { failClosed: true });
    if (result.ok && clearedInvites.length) {
        await Promise.all(clearedInvites.map(slug => reconcileInvitationIndex(input.partyId, slug, deps)));
    }
    return result;
}

export async function activateTowerPartyLaunch(
    partyId: string,
    requestId: string,
    runId: string,
    deps: TowerPartyDeps = {},
): Promise<StoredTowerParty | null> {
    const { kv, lock, now: clock } = depsOf(deps);
    let clearedInvites: string[] = [];
    const result = await lock(towerPartyKey(partyId), async () => {
        const party = await loadPartyWith(kv, partyId);
        if (!party || party.launch?.requestId !== requestId || party.launch.runId !== runId) return party;
        if (party.status === 'active' && party.launch.state === 'active') return party;
        if (party.status !== 'launching') return party;
        const now = clock();
        clearedInvites = [...party.invitedSlugs];
        return savePartyWith(kv, {
            ...party,
            status: 'active',
            invitedSlugs: [],
            launch: { ...party.launch, state: 'active' },
            version: party.version + 1,
        }, now);
    }, { failClosed: true });
    if (clearedInvites.length) {
        await Promise.all(clearedInvites.map(slug => reconcileInvitationIndex(partyId, slug, deps)));
    }
    return result;
}

export async function reopenTowerPartyLaunch(
    partyId: string,
    requestId: string,
    deps: TowerPartyDeps = {},
): Promise<void> {
    const { kv, lock, now: clock } = depsOf(deps);
    await lock(towerPartyKey(partyId), async () => {
        const party = await loadPartyWith(kv, partyId);
        if (!party || party.status !== 'launching' || party.launch?.requestId !== requestId) return;
        const now = clock();
        await savePartyWith(kv, {
            ...party,
            status: 'forming',
            launch: { ...party.launch, state: 'failed' },
            version: party.version + 1,
        }, now);
    }, { failClosed: true });
}

/**
 * Close a terminal run's ready room and release every member for their next
 * party. The bound run ID is verified under the party lock; compare-delete
 * prevents delayed cleanup from erasing a newer player-to-party index.
 */
export async function closeTowerPartyRun(
    partyId: string,
    runId: string,
    deps: TowerPartyDeps = {},
): Promise<StoredTowerParty | null> {
    const { kv, lock, now: clock } = depsOf(deps);
    const closed = await lock(towerPartyKey(partyId), async () => {
        const party = await loadPartyWith(kv, partyId);
        if (!party || party.launch?.runId !== runId) return null;
        if (party.status === 'closed' && party.launch.state === 'completed') return party;
        // `launching` covers a published session whose activation acknowledgement
        // was dropped. Settlement proves the run itself reached terminal state.
        if (party.status !== 'active' && party.status !== 'launching') return null;
        const now = clock();
        return savePartyWith(kv, {
            ...party,
            status: 'closed',
            launch: { ...party.launch, state: 'completed' },
            version: party.version + 1,
        }, now);
    }, { failClosed: true });
    if (!closed) return null;
    await Promise.all(closed.members.map(member => clearPlayerIndexWith(kv, member.slug, partyId).catch(() => undefined)));
    return closed;
}

import { randomUUID } from 'node:crypto';
import type {
    ClanBossLoadoutSnapshot,
    ClanBossParty,
    ClanBossPartyEnvelope,
    ClanBossPartyMember,
    ClanBossPartyView,
} from '../../shared/clan-boss-operation.js';
import {
    CLAN_BOSS_PARTY_MAX,
    CLAN_BOSS_PARTY_STALE_MS,
    CLAN_BOSS_SOLO_FALLBACK_MS,
} from '../../shared/clan-boss-operation.js';
import { kv } from '../_storage.js';
import { makeKvLockPrimitives, withKvLock, withLockCore } from '../_lock.js';
import { clanBareSlug, safeName } from '../_utils.js';
import type { KvLike } from '../_storage.js';

export const CLAN_BOSS_PARTY_TTL = 2 * 60 * 60;
export const CLAN_BOSS_PARTY_REGISTRY_KEY = 'clan-boss:party-registry:v1';
export const CLAN_BOSS_PARTY_SWEEP_CURSOR_KEY = 'clan-boss:party-registry:sweep-cursor';
const PARTY_RECEIPT_CAP = 80;
const INVITE_CAP = 20;
const REGISTRY_PAGE_MAX = 500;

type PartyReceipt = {
    actor: string;
    requestId: string;
    fingerprint: string;
    at: number;
};

export type StoredParty = ClanBossParty & { receipts?: PartyReceipt[] };

export type PartyRegistryEntry = {
    clanRegistryKey: string;
    createdAt: number;
    updatedAt: number;
    status: ClanBossParty['status'];
};

export type PartyRegistryPage = {
    ids: string[];
    total: number;
    cursor: string | null;
    nextCursor: string | null;
};

export type PartyPlayerContext = {
    slug: string;
    displayName: string;
    clanName: string;
    saveVersion: number;
    character: Record<string, unknown>;
};

export type PartyMutationResult =
    | { ok: true; party: StoredParty; replayed: boolean }
    | { ok: false; status: number; error: string; code: string; party?: StoredParty };

export const partyKey = (id: string) => `clan-boss:party:${id}`;
export const partyPlayerKey = (slug: string) => `clan-boss:party-player:${slug}`;
export const partyInviteKey = (slug: string) => `clan-boss:party-invites:${slug}`;
export const partyClanRegistryKey = (clanName: string) => `clan-boss:party-registry:clan:${clanBareSlug(clanName)}`;

function registryEntry(party: StoredParty): PartyRegistryEntry {
    return {
        clanRegistryKey: partyClanRegistryKey(party.clanName),
        createdAt: party.createdAt,
        updatedAt: party.updatedAt,
        status: party.status,
    };
}

/**
 * Registry writes are secondary indexes over the TTL-owned party record. They
 * must never turn an already-committed party mutation into a client-visible
 * failure: a retry could then replay its receipt without repairing the index.
 * The finder keeps a migration fallback, and the scheduled reconciler repairs
 * either index from the authoritative party record.
 */
export async function registerPartyRecord(party: StoredParty, store: KvLike = kv): Promise<boolean> {
    const entry = registryEntry(party);
    try {
        await Promise.all([
            store.hset(CLAN_BOSS_PARTY_REGISTRY_KEY, { [party.id]: entry }),
            store.hset(entry.clanRegistryKey, { [party.id]: { createdAt: party.createdAt, updatedAt: party.updatedAt, status: party.status } }),
        ]);
        return true;
    } catch (error) {
        console.error('[clan-boss/party] registry update failed:', error instanceof Error ? error.message : String(error));
        return false;
    }
}

function pageIds(ids: string[], cursor: string | null, limit: number): PartyRegistryPage {
    const ordered = [...new Set(ids)].sort();
    const start = cursor ? ordered.findIndex((id) => id > cursor) : 0;
    const offset = start < 0 ? ordered.length : start;
    const page = ordered.slice(offset, offset + limit);
    const nextCursor = offset + page.length < ordered.length ? page.at(-1) ?? null : null;
    return { ids: page, total: ordered.length, cursor, nextCursor };
}

export async function listRegisteredPartyIds(input: {
    cursor?: string | null;
    limit?: number;
    store?: KvLike;
} = {}): Promise<PartyRegistryPage> {
    const store = input.store ?? kv;
    const limit = Math.max(1, Math.min(REGISTRY_PAGE_MAX, Math.floor(Number(input.limit) || 100)));
    const ids = await store.hkeys(CLAN_BOSS_PARTY_REGISTRY_KEY);
    return pageIds(ids, input.cursor ?? null, limit);
}

export function clanBossPartiesEnabled(): boolean {
    return process.env.DISABLE_CLAN_BOSS_PARTIES !== '1';
}

function isOpenStatus(status: ClanBossParty['status']): boolean {
    return status === 'forming' || status === 'queued';
}

function loadoutCount(value: unknown): number {
    return Array.isArray(value) ? value.filter(Boolean).length : 0;
}

export async function loadPartyPlayerContext(rawName: string): Promise<PartyPlayerContext | null> {
    const slug = safeName(rawName);
    if (!slug) return null;
    const record = await kv.get<Record<string, unknown>>(`save:${slug}`);
    const character = record?.character as Record<string, unknown> | undefined;
    const clanName = typeof character?.clan === 'string' ? character.clan.trim() : '';
    if (!record || !character || !clanName) return null;
    return {
        slug,
        displayName: String(character.name ?? rawName).slice(0, 48),
        clanName,
        saveVersion: Math.max(0, Math.floor(Number(record._saveVersion) || 0)),
        character,
    };
}

export function snapshotForPlayer(ctx: PartyPlayerContext, now: number): ClanBossLoadoutSnapshot {
    const c = ctx.character;
    const equipment = c.equipment && typeof c.equipment === 'object'
        ? Object.values(c.equipment as Record<string, unknown>)
        : [];
    const combatItemCount = equipment.filter((itemId) => typeof itemId === 'string' && itemId.length > 0).length;
    return {
        saveVersion: ctx.saveVersion,
        level: Math.max(1, Math.floor(Number(c.level) || 1)),
        profession: typeof c.profession === 'string' && c.profession ? c.profession : null,
        jutsuCount: loadoutCount(c.equippedJutsuIds ?? c.equippedJutsu),
        combatItemCount,
        sealedAt: now,
    };
}

export function createPartyRecord(input: {
    id?: string;
    player: PartyPlayerContext;
    weekId: string;
    bossId: string;
    sectorId: number;
    visibility: ClanBossParty['visibility'];
    now: number;
}): StoredParty {
    const member: ClanBossPartyMember = {
        slug: input.player.slug,
        displayName: input.player.displayName,
        joinedAt: input.now,
        lastSeenAt: input.now,
        ready: false,
    };
    return {
        id: input.id ?? `cbp-${randomUUID().replace(/-/g, '')}`,
        clanName: input.player.clanName,
        weekId: input.weekId,
        bossId: input.bossId,
        sectorId: input.sectorId,
        leaderSlug: input.player.slug,
        visibility: input.visibility,
        status: 'forming',
        members: [member],
        invitedSlugs: [],
        version: 1,
        createdAt: input.now,
        updatedAt: input.now,
        pings: [],
        receipts: [],
    };
}

export function partyView(party: StoredParty, now = Date.now()): ClanBossPartyView {
    const members = party.members.map((member) => ({
        ...member,
        connection: now - member.lastSeenAt <= CLAN_BOSS_PARTY_STALE_MS ? 'online' as const : 'stale' as const,
    }));
    const allReady = members.length > 0 && members.every((member) => member.ready && !!member.snapshot);
    const fallbackAvailable = party.status === 'queued'
        && members.length === 1
        && now >= Number(party.fallbackAt ?? Number.POSITIVE_INFINITY);
    return {
        ...party,
        members,
        allReady,
        canStart: allReady && (members.length > 1 || party.visibility === 'private' || !!party.soloFallbackAccepted),
        fallbackAvailable,
    };
}

export function canClaimPartyLeadership(party: StoredParty, actor: string, now = Date.now()): boolean {
    if (!isOpenStatus(party.status) || actor === party.leaderSlug || !party.members.some((member) => member.slug === actor)) return false;
    const leader = party.members.find((member) => member.slug === party.leaderSlug);
    return !!leader && now - leader.lastSeenAt > CLAN_BOSS_PARTY_STALE_MS;
}

export function addPartyMember(party: StoredParty, player: PartyPlayerContext, now: number): PartyMutationResult {
    if (!isOpenStatus(party.status)) return { ok: false, status: 409, code: 'party-not-open', error: 'That party is no longer open.', party };
    if (party.clanName !== player.clanName) return { ok: false, status: 403, code: 'wrong-clan', error: 'That operation belongs to another clan.', party };
    if (party.members.some((member) => member.slug === player.slug)) return { ok: true, party, replayed: true };
    if (party.members.length >= CLAN_BOSS_PARTY_MAX) return { ok: false, status: 409, code: 'party-full', error: 'That party is full.', party };
    const members = [...party.members.map((member) => ({ ...member, ready: false, snapshot: undefined })), {
        slug: player.slug,
        displayName: player.displayName,
        joinedAt: now,
        lastSeenAt: now,
        ready: false,
    }];
    return {
        ok: true,
        replayed: false,
        party: {
            ...party,
            status: 'forming',
            members,
            invitedSlugs: party.invitedSlugs.filter((slug) => slug !== player.slug),
            queuedAt: undefined,
            fallbackAt: undefined,
            soloFallbackAccepted: false,
        },
    };
}

export function removePartyMember(party: StoredParty, slug: string, now: number): PartyMutationResult {
    if (!isOpenStatus(party.status)) return { ok: false, status: 409, code: 'party-locked', error: 'Members cannot leave after the operation starts.', party };
    if (!party.members.some((member) => member.slug === slug)) return { ok: true, party, replayed: true };
    const members = party.members.filter((member) => member.slug !== slug)
        .map((member) => ({ ...member, ready: false, snapshot: undefined }));
    if (members.length === 0) {
        return { ok: true, replayed: false, party: { ...party, members, status: 'disbanded', disbandReason: 'empty', updatedAt: now } };
    }
    const leaderSlug = party.leaderSlug === slug
        ? [...members].sort((a, b) => a.joinedAt - b.joinedAt || a.slug.localeCompare(b.slug))[0]!.slug
        : party.leaderSlug;
    return {
        ok: true,
        replayed: false,
        party: {
            ...party,
            members,
            leaderSlug,
            status: 'forming',
            queuedAt: undefined,
            fallbackAt: undefined,
            soloFallbackAccepted: false,
        },
    };
}

export async function loadParty(id: string): Promise<StoredParty | null> {
    if (!/^cbp-[a-f0-9]{32}$/i.test(id)) return null;
    return kv.get<StoredParty>(partyKey(id));
}

export async function saveParty(party: StoredParty): Promise<void> {
    await kv.set(partyKey(party.id), party, { ex: CLAN_BOSS_PARTY_TTL });
    await registerPartyRecord(party);
}

export async function activePartyForPlayer(slug: string, clearLegacyIndex = false): Promise<StoredParty | null> {
    const index = await kv.get<string | { partyId?: string }>(partyPlayerKey(slug));
    const indexedPartyId = typeof index === 'string' ? index : index?.partyId;
    if (!indexedPartyId) return null;
    const party = await loadParty(indexedPartyId);
    if (!party || !party.members.some((member) => member.slug === slug) || (!isOpenStatus(party.status) && party.status !== 'starting' && party.status !== 'active')) {
        if (typeof index === 'string') await kv.delIfEqual(partyPlayerKey(slug), indexedPartyId).catch(() => false);
        // Object-valued indices predate compare-and-delete. Only a caller that
        // already owns this player's index lock may remove one; otherwise its
        // short TTL is safer than racing a newly created party index.
        else if (clearLegacyIndex) await kv.del(partyPlayerKey(slug)).catch(() => 0);
        return null;
    }
    return party;
}

export async function createParty(input: {
    player: PartyPlayerContext;
    weekId: string;
    bossId: string;
    sectorId: number;
    visibility: ClanBossParty['visibility'];
    now?: number;
}): Promise<StoredParty> {
    const now = input.now ?? Date.now();
    return withKvLock(partyPlayerKey(input.player.slug), async () => {
        const existing = await activePartyForPlayer(input.player.slug, true);
        if (existing && existing.status !== 'completed') return existing;
        if (existing?.status === 'completed') await kv.del(partyPlayerKey(input.player.slug));
        const party = createPartyRecord({ ...input, now });
        await saveParty(party);
        await kv.set(partyPlayerKey(input.player.slug), party.id, { ex: CLAN_BOSS_PARTY_TTL });
        return party;
    }, { failClosed: true });
}

export async function mutateParty(input: {
    partyId: string;
    actor: string;
    requestId: string;
    expectedVersion: number;
    fingerprint: string;
    mutate: (party: StoredParty, now: number) => PartyMutationResult | Promise<PartyMutationResult>;
    now?: number;
}): Promise<PartyMutationResult> {
    return withKvLock(partyKey(input.partyId), async () => {
        const party = await loadParty(input.partyId);
        if (!party) return { ok: false, status: 404, code: 'party-not-found', error: 'That party no longer exists.' };
        const prior = (party.receipts ?? []).find((receipt) => receipt.actor === input.actor && receipt.requestId === input.requestId);
        if (prior) {
            if (prior.fingerprint !== input.fingerprint) return { ok: false, status: 409, code: 'request-conflict', error: 'That request ID was already used for another action.', party };
            return { ok: true, party, replayed: true };
        }
        if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion !== party.version) {
            return { ok: false, status: 409, code: 'version-conflict', error: 'The party changed. Review the latest state and try again.', party };
        }
        const now = input.now ?? Date.now();
        const result = await input.mutate(party, now);
        if (!result.ok || result.replayed) return result;
        const next: StoredParty = {
            ...result.party,
            version: party.version + 1,
            updatedAt: now,
            receipts: [{ actor: input.actor, requestId: input.requestId, fingerprint: input.fingerprint, at: now }, ...(party.receipts ?? [])].slice(0, PARTY_RECEIPT_CAP),
        };
        await saveParty(next);
        return { ok: true, party: next, replayed: false };
    }, { failClosed: true });
}

async function ensurePartyPlayerIndex(slug: string, partyId: string, store: KvLike): Promise<boolean> {
    const key = partyPlayerKey(slug);
    try {
        return await withLockCore(key, async () => {
            const value = await store.get<string | { partyId?: string }>(key);
            const currentPartyId = typeof value === 'string' ? value : value?.partyId;
            // A different binding is newer authority. Repairing a stale live
            // party must never pull the player back out of that newer party.
            if (currentPartyId && currentPartyId !== partyId) return false;
            await store.set(key, partyId, { ex: CLAN_BOSS_PARTY_TTL });
            return true;
        }, makeKvLockPrimitives(store), { failClosed: true });
    } catch {
        // Secondary-index repair is retryable by heartbeat/the leased sweep;
        // never fail an already-committed party mutation on lock contention.
        return false;
    }
}

export async function indexPartyMembers(party: StoredParty, store: KvLike = kv): Promise<void> {
    await Promise.all(party.members.map((member) => ensurePartyPlayerIndex(member.slug, party.id, store)));
}

export async function clearPartyPlayerIndex(slug: string, expectedPartyId: string, store: KvLike = kv): Promise<boolean> {
    return store.delIfEqual(partyPlayerKey(slug), expectedPartyId);
}

export async function clearPartyMemberIndices(party: StoredParty, except: string[] = [], store: KvLike = kv): Promise<void> {
    const keep = new Set(except);
    await Promise.all(party.members
        .filter((member) => !keep.has(member.slug))
        .map((member) => clearPartyPlayerIndex(member.slug, party.id, store).catch(() => false)));
}

export async function addPartyInvitation(slug: string, partyId: string): Promise<void> {
    const key = partyInviteKey(slug);
    await withKvLock(key, async () => {
        const existing = (await kv.get<string[]>(key)) ?? [];
        await kv.set(key, [partyId, ...existing.filter((id) => id !== partyId)].slice(0, INVITE_CAP), { ex: CLAN_BOSS_PARTY_TTL });
    });
}

export async function removePartyInvitation(slug: string, partyId: string): Promise<void> {
    const key = partyInviteKey(slug);
    await withKvLock(key, async () => {
        const existing = (await kv.get<string[]>(key)) ?? [];
        const next = existing.filter((id) => id !== partyId);
        if (next.length) await kv.set(key, next, { ex: CLAN_BOSS_PARTY_TTL });
        else await kv.del(key);
    });
}

async function loadPartyList(ids: string[]): Promise<StoredParty[]> {
    const parties = await Promise.all([...new Set(ids)].slice(0, 200).map((id) => loadParty(id)));
    return parties.filter((party): party is StoredParty => !!party);
}

export async function partyEnvelope(player: PartyPlayerContext, now = Date.now()): Promise<ClanBossPartyEnvelope> {
    const own = await activePartyForPlayer(player.slug);
    const inviteIds = (await kv.get<string[]>(partyInviteKey(player.slug))) ?? [];
    const invitations = (await loadPartyList(inviteIds)).filter((party) => isOpenStatus(party.status) && party.clanName === player.clanName && party.invitedSlugs.includes(player.slug));
    const clanRegistry = await kv.hgetall<Record<string, { createdAt?: number }>>(partyClanRegistryKey(player.clanName)).catch(() => null);
    let candidateIds = Object.entries(clanRegistry ?? {})
        .sort((a, b) => Number(a[1]?.createdAt ?? 0) - Number(b[1]?.createdAt ?? 0) || a[0].localeCompare(b[0]))
        .map(([id]) => id);
    // Rolling-deploy bridge: parties created before the registry shipped are
    // discovered once through the legacy scan. Any subsequent save/heartbeat
    // registers them, so this path naturally disappears as live lobbies move.
    if (candidateIds.length === 0) {
        const keys = await kv.keys('clan-boss:party:cbp-*').catch(() => [] as string[]);
        candidateIds = keys.map((key) => key.slice('clan-boss:party:'.length));
    }
    const publicParties = (await loadPartyList(candidateIds))
        .filter((party) => party.clanName === player.clanName && party.visibility === 'public' && isOpenStatus(party.status) && party.members.length < CLAN_BOSS_PARTY_MAX)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, 12);
    const publicViews = publicParties.map((party) => partyView(party, now));
    return {
        ok: true,
        serverNow: now,
        party: own ? partyView(own, now) : null,
        invitations: invitations.map((party) => partyView(party, now)),
        publicParties: publicViews,
        population: {
            publicParties: publicViews.length,
            openSeats: publicViews.reduce((sum, party) => sum + Math.max(0, CLAN_BOSS_PARTY_MAX - party.members.length), 0),
        },
    };
}

export function queueParty(party: StoredParty, actor: string, now: number): PartyMutationResult {
    if (party.leaderSlug !== actor) return { ok: false, status: 403, code: 'leader-required', error: 'Only the party leader can enter the finder.', party };
    if (party.status !== 'forming') return { ok: false, status: 409, code: 'party-not-forming', error: 'That party cannot queue right now.', party };
    if (!party.members.every((member) => member.ready && !!member.snapshot)) return { ok: false, status: 409, code: 'not-ready', error: 'Every member must be ready before queueing.', party };
    return {
        ok: true,
        replayed: false,
        party: {
            ...party,
            status: 'queued',
            visibility: 'public',
            queuedAt: now,
            fallbackAt: now + CLAN_BOSS_SOLO_FALLBACK_MS,
            soloFallbackAccepted: false,
        },
    };
}

export async function heartbeatParty(partyId: string, slug: string, now = Date.now()): Promise<StoredParty | null> {
    const next = await withKvLock(partyKey(partyId), async () => {
        const party = await loadParty(partyId);
        if (!party) return null;
        if (party.status === 'completed' || party.status === 'disbanded' || party.status === 'expired') return party;
        let found = false;
        const members = party.members.map((member) => {
            if (member.slug !== slug) return member;
            found = true;
            return { ...member, lastSeenAt: now };
        });
        if (!found) return party;
        const next = { ...party, members, updatedAt: now };
        await saveParty(next);
        return next;
    });
    // Keep the party -> player lock order out of the party critical section.
    // A join takes the player lock before the party lock, so nesting them here
    // would otherwise create an avoidable inverse-order contention cycle.
    if (next && next.status !== 'completed' && next.status !== 'disbanded' && next.status !== 'expired') {
        await indexPartyMembers(next);
    }
    return next;
}

export async function preparePartyStart(input: {
    partyId: string;
    leaderSlug: string;
    requestId: string;
    expectedVersion: number;
    now?: number;
}): Promise<PartyMutationResult> {
    return withKvLock(partyKey(input.partyId), async () => {
        const party = await loadParty(input.partyId);
        if (!party) return { ok: false, status: 404, code: 'party-not-found', error: 'That party no longer exists.' };
        if (party.leaderSlug !== input.leaderSlug) return { ok: false, status: 403, code: 'leader-required', error: 'Only the party leader can start the operation.', party };
        if ((party.status === 'starting' || party.status === 'active') && party.startRequestId === input.requestId) {
            return { ok: true, party, replayed: true };
        }
        if (party.status !== 'forming' && party.status !== 'queued') return { ok: false, status: 409, code: 'party-not-startable', error: 'That party cannot start right now.', party };
        if (party.version !== input.expectedVersion) return { ok: false, status: 409, code: 'version-conflict', error: 'The party changed. Review the latest state and try again.', party };
        if (party.members.length < 1 || party.members.length > CLAN_BOSS_PARTY_MAX) return { ok: false, status: 409, code: 'invalid-size', error: 'An operation requires one to four members.', party };
        if (party.members.length === 1 && party.visibility === 'public' && !party.soloFallbackAccepted) {
            return { ok: false, status: 409, code: 'solo-fallback-required', error: 'Wait for the finder or accept the explicit solo fallback.', party };
        }
        if (!party.members.every((member) => member.ready && !!member.snapshot)) return { ok: false, status: 409, code: 'not-ready', error: 'Every member must be ready before starting.', party };

        const contexts = await Promise.all(party.members.map((member) => loadPartyPlayerContext(member.slug)));
        const stale = party.members.filter((member, index) => {
            const context = contexts[index];
            return !context || context.clanName !== party.clanName || context.saveVersion !== member.snapshot?.saveVersion;
        }).map((member) => member.slug);
        if (stale.length) {
            const now = input.now ?? Date.now();
            const next: StoredParty = {
                ...party,
                members: party.members.map((member) => stale.includes(member.slug) ? { ...member, ready: false, snapshot: undefined } : member),
                status: 'forming',
                queuedAt: undefined,
                fallbackAt: undefined,
                soloFallbackAccepted: false,
                version: party.version + 1,
                updatedAt: now,
            };
            await saveParty(next);
            return { ok: false, status: 409, code: 'loadout-changed', error: 'A member changed their loadout after readying. Ready again with the latest save.', party: next };
        }
        const now = input.now ?? Date.now();
        const next: StoredParty = {
            ...party,
            status: 'starting',
            startRequestId: input.requestId,
            version: party.version + 1,
            updatedAt: now,
        };
        await saveParty(next);
        return { ok: true, party: next, replayed: false };
    }, { failClosed: true });
}

export async function activatePartyStart(partyId: string, requestId: string, runId: string, now = Date.now()): Promise<StoredParty | null> {
    return withKvLock(partyKey(partyId), async () => {
        const party = await loadParty(partyId);
        if (!party || party.startRequestId !== requestId) return party;
        if (party.status === 'active' && party.runId === runId) return party;
        if (party.status !== 'starting') return party;
        const next: StoredParty = { ...party, status: 'active', runId, version: party.version + 1, updatedAt: now };
        await saveParty(next);
        return next;
    }, { failClosed: true });
}

export async function reopenPartyStart(partyId: string, requestId: string, now = Date.now()): Promise<void> {
    await withKvLock(partyKey(partyId), async () => {
        const party = await loadParty(partyId);
        if (!party || party.status !== 'starting' || party.startRequestId !== requestId) return;
        await saveParty({ ...party, status: 'forming', startRequestId: undefined, version: party.version + 1, updatedAt: now });
    }, { failClosed: true });
}

export async function completeParty(partyId: string, runId: string, now = Date.now()): Promise<StoredParty | null> {
    return withKvLock(partyKey(partyId), async () => {
        const party = await loadParty(partyId);
        if (!party || party.runId !== runId) return party;
        if (party.status === 'completed') return party;
        const next: StoredParty = { ...party, status: 'completed', completedAt: now, version: party.version + 1, updatedAt: now };
        await saveParty(next);
        await clearPartyMemberIndices(next);
        return next;
    }, { failClosed: true });
}

export type PartyRegistrySweepResult = {
    scanned: number;
    repaired: number;
    discovered: number;
    removed: number;
    terminalIndicesCleared: number;
    total: number;
    cursor: string | null;
    nextCursor: string | null;
};

/**
 * Bounded semantic cleanup for the non-expiring registry hashes. Party rows
 * remain TTL-owned and are never deleted here. Missing rows lose only stale
 * registry fields; live rows repair their clan registry and member indices;
 * terminal rows release member indices so players can form again immediately.
 */
export async function reconcileClanBossPartyRegistry(input: {
    cursor?: string | null;
    limit?: number;
    store?: KvLike;
} = {}): Promise<PartyRegistrySweepResult> {
    const store = input.store ?? kv;
    const entries = (await store.hgetall<Record<string, PartyRegistryEntry>>(CLAN_BOSS_PARTY_REGISTRY_KEY)) ?? {};
    const page = pageIds(Object.keys(entries), input.cursor ?? null, Math.max(1, Math.min(REGISTRY_PAGE_MAX, Math.floor(Number(input.limit) || 250))));
    let repaired = 0;
    let removed = 0;
    let terminalIndicesCleared = 0;
    for (const id of page.ids) {
        const party = await store.get<StoredParty>(partyKey(id));
        if (!party) {
            const clanRegistryKey = entries[id]?.clanRegistryKey;
            await store.hdel(CLAN_BOSS_PARTY_REGISTRY_KEY, id);
            if (clanRegistryKey) await store.hdel(clanRegistryKey, id);
            removed += 1;
            continue;
        }
        const expected = registryEntry(party);
        const current = entries[id];
        if (!current || current.clanRegistryKey !== expected.clanRegistryKey || current.updatedAt !== expected.updatedAt || current.status !== expected.status) {
            await Promise.all([
                store.hset(CLAN_BOSS_PARTY_REGISTRY_KEY, { [id]: expected }),
                store.hset(expected.clanRegistryKey, { [id]: { createdAt: party.createdAt, updatedAt: party.updatedAt, status: party.status } }),
            ]);
            if (current?.clanRegistryKey && current.clanRegistryKey !== expected.clanRegistryKey) await store.hdel(current.clanRegistryKey, id);
            repaired += 1;
        }
        if (party.status === 'completed' || party.status === 'disbanded' || party.status === 'expired') {
            const cleared = await Promise.all(party.members.map((member) => clearPartyPlayerIndex(member.slug, party.id, store)));
            terminalIndicesCleared += cleared.filter(Boolean).length;
        } else {
            await indexPartyMembers(party, store);
        }
    }
    return { scanned: page.ids.length, repaired, discovered: 0, removed, terminalIndicesCleared, total: page.total, cursor: page.cursor, nextCursor: page.nextCursor };
}

export async function sweepClanBossPartyRegistry(store: KvLike = kv): Promise<PartyRegistrySweepResult> {
    const cursor = await store.get<string>(CLAN_BOSS_PARTY_SWEEP_CURSOR_KEY);
    const result = await reconcileClanBossPartyRegistry({ cursor, limit: 250, store });
    if (result.nextCursor) await store.set(CLAN_BOSS_PARTY_SWEEP_CURSOR_KEY, result.nextCursor, { ex: CLAN_BOSS_PARTY_TTL });
    else {
        await store.del(CLAN_BOSS_PARTY_SWEEP_CURSOR_KEY);
        // A failed best-effort registry write cannot be found by walking that
        // same registry. At the end of each bounded cycle, reconcile up to one
        // page of authoritative TTL-owned party rows that are missing entirely.
        // This keeps the secondary index self-healing without deleting party data.
        const [liveKeys, registeredIds] = await Promise.all([
            store.keys('clan-boss:party:cbp-*'),
            store.hkeys(CLAN_BOSS_PARTY_REGISTRY_KEY),
        ]);
        const registered = new Set(registeredIds);
        const missingIds = liveKeys
            .map((key) => key.slice('clan-boss:party:'.length))
            .filter((id) => !registered.has(id))
            .sort()
            .slice(0, 250);
        for (const id of missingIds) {
            const party = await store.get<StoredParty>(partyKey(id));
            if (party && await registerPartyRecord(party, store)) result.discovered += 1;
        }
    }
    return result;
}

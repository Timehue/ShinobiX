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
import { withKvLock } from '../_lock.js';
import { safeName } from '../_utils.js';

export const CLAN_BOSS_PARTY_TTL = 2 * 60 * 60;
const PARTY_RECEIPT_CAP = 80;
const INVITE_CAP = 20;

type PartyReceipt = {
    actor: string;
    requestId: string;
    fingerprint: string;
    at: number;
};

export type StoredParty = ClanBossParty & { receipts?: PartyReceipt[] };

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
}

export async function activePartyForPlayer(slug: string): Promise<StoredParty | null> {
    const index = await kv.get<{ partyId?: string }>(partyPlayerKey(slug));
    if (!index?.partyId) return null;
    const party = await loadParty(index.partyId);
    if (!party || !party.members.some((member) => member.slug === slug) || (!isOpenStatus(party.status) && party.status !== 'starting' && party.status !== 'active' && party.status !== 'completed')) {
        await kv.del(partyPlayerKey(slug)).catch(() => 0);
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
        const existing = await activePartyForPlayer(input.player.slug);
        if (existing && existing.status !== 'completed') return existing;
        if (existing?.status === 'completed') await kv.del(partyPlayerKey(input.player.slug));
        const party = createPartyRecord({ ...input, now });
        await saveParty(party);
        await kv.set(partyPlayerKey(input.player.slug), { partyId: party.id }, { ex: CLAN_BOSS_PARTY_TTL });
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

export async function indexPartyMembers(party: StoredParty): Promise<void> {
    await Promise.all(party.members.map((member) => kv.set(partyPlayerKey(member.slug), { partyId: party.id }, { ex: CLAN_BOSS_PARTY_TTL })));
}

export async function clearPartyMemberIndices(party: StoredParty, except: string[] = []): Promise<void> {
    const keep = new Set(except);
    const keys = party.members.filter((member) => !keep.has(member.slug)).map((member) => partyPlayerKey(member.slug));
    if (keys.length) await kv.del(...keys).catch(() => 0);
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
    const parties = await Promise.all([...new Set(ids)].slice(0, 40).map((id) => loadParty(id)));
    return parties.filter((party): party is StoredParty => !!party);
}

export async function partyEnvelope(player: PartyPlayerContext, now = Date.now()): Promise<ClanBossPartyEnvelope> {
    const own = await activePartyForPlayer(player.slug);
    const inviteIds = (await kv.get<string[]>(partyInviteKey(player.slug))) ?? [];
    const invitations = (await loadPartyList(inviteIds)).filter((party) => isOpenStatus(party.status) && party.clanName === player.clanName && party.invitedSlugs.includes(player.slug));
    const keys = await kv.keys('clan-boss:party:cbp-*').catch(() => [] as string[]);
    const publicParties = (await loadPartyList(keys.map((key) => key.slice('clan-boss:party:'.length))))
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
    return withKvLock(partyKey(partyId), async () => {
        const party = await loadParty(partyId);
        if (!party) return null;
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
        return next;
    }, { failClosed: true });
}

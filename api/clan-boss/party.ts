import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import type { ClanBossParty, ClanBossPingKind } from '../../shared/clan-boss-operation.js';
import { CLAN_BOSS_PARTY_MAX } from '../../shared/clan-boss-operation.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { kv } from '../_storage.js';
import { clanBossWeekId, loadClanBossWeek, resolveClanBossDef } from './_storage.js';
import {
    activePartyForPlayer,
    addPartyInvitation,
    addPartyMember,
    canClaimPartyLeadership,
    clanBossPartiesEnabled,
    CLAN_BOSS_PARTY_TTL,
    clearPartyMemberIndices,
    clearPartyPlayerIndex,
    createParty,
    heartbeatParty,
    indexPartyMembers,
    loadPartyPlayerContext,
    mutateParty,
    partyPlayerKey,
    partyEnvelope,
    partyView,
    queueParty,
    removePartyInvitation,
    removePartyMember,
    snapshotForPlayer,
} from './_party.js';
import { captureServerProductEvent } from '../_product-analytics.js';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,96}$/;
const PARTY_ID = /^cbp-[a-f0-9]{32}$/i;
const PING_KINDS = new Set<ClanBossPingKind>(['focus-boss', 'clear-adds', 'need-heal', 'hold', 'ready']);

function parseBody(req: VercelRequest): Record<string, unknown> {
    return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) as Record<string, unknown>;
}

function mutationFingerprint(body: Record<string, unknown>): string {
    const safe = {
        action: String(body.action ?? ''),
        partyId: String(body.partyId ?? ''),
        target: safeName(String(body.target ?? '')),
        visibility: String(body.visibility ?? ''),
        ping: String(body.ping ?? ''),
    };
    return createHash('sha256').update(JSON.stringify(safe)).digest('hex');
}

function genericMutation(party: ClanBossParty, patch: Partial<ClanBossParty>) {
    return { ok: true as const, replayed: false, party: { ...party, ...patch } };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (process.env.ENABLE_CLAN_BOSS !== '1' || !clanBossPartiesEnabled()) return res.status(404).json({ error: 'Not found.' });
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    try {
        const input = req.method === 'GET' ? req.query : parseBody(req);
        const playerName = safeName(String(input.playerName ?? input.player ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing player.' });
        if (!enforceRateLimit(req, res, 'clan-boss-party', req.method === 'GET' ? 90 : 45, 60_000, playerName)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only manage your own party presence.' });
        const player = await loadPartyPlayerContext(playerName);
        if (!player) return res.status(400).json({ error: 'Join a clan before forming an operation party.' });

        if (req.method === 'GET') {
            const current = await activePartyForPlayer(player.slug);
            if (current) await heartbeatParty(current.id, player.slug);
            res.setHeader('Cache-Control', 'private, no-store');
            return res.status(200).json(await partyEnvelope(player));
        }

        const body = input as Record<string, unknown>;
        const action = String(body.action ?? '');
        const requestId = String(body.requestId ?? '');
        if (!REQUEST_ID.test(requestId)) return res.status(400).json({ error: 'A valid request ID is required.', errorCode: 'invalid-request-id' });

        if (action === 'create') {
            const now = Date.now();
            const weekId = clanBossWeekId(now);
            const week = await loadClanBossWeek(weekId);
            const boss = resolveClanBossDef(week);
            if (!week || week.endsAt <= now || !boss) return res.status(409).json({ error: 'No Clan Boss operation is active.', errorCode: 'operation-inactive' });
            const visibility = body.visibility === 'private' ? 'private' : 'public';
            const party = await createParty({ player, weekId, bossId: boss.id, sectorId: boss.sectorId, visibility, now });
            captureServerProductEvent('clan_boss_party_state_changed', { mode: visibility, partySizeBucket: '1', stateCategory: 'created' });
            return res.status(200).json({ ...(await partyEnvelope(player)), party: partyView(party) });
        }

        const partyId = String(body.partyId ?? '');
        const expectedVersion = Number(body.expectedVersion);
        if (!PARTY_ID.test(partyId)) return res.status(400).json({ error: 'Invalid party.', errorCode: 'invalid-party' });
        const fingerprint = mutationFingerprint(body);

        if (action === 'join') {
            // Serialize the active-party check, membership mutation, and index
            // publication on this player. Without the player-key lock, two
            // simultaneous joins to different parties could both observe no
            // active party and leave the player present in both rosters.
            const result = await withKvLock(partyPlayerKey(player.slug), async () => {
                const own = await activePartyForPlayer(player.slug, true);
                if (own && own.id !== partyId) return { ok: false as const, status: 409, code: 'already-in-party', error: 'Leave your current party before joining another.', party: own };
                const joined = await mutateParty({
                    partyId, actor: player.slug, requestId, expectedVersion, fingerprint,
                    mutate: (party, now) => {
                        const invited = party.invitedSlugs.includes(player.slug);
                        if (party.visibility !== 'public' && !invited) return { ok: false, status: 403, code: 'invite-required', error: 'That private party requires an invitation.', party };
                        return addPartyMember(party, player, now);
                    },
                });
                if (joined.ok) await kv.set(partyPlayerKey(player.slug), joined.party.id, { ex: CLAN_BOSS_PARTY_TTL });
                return joined;
            }, { failClosed: true });
            if (!result.ok) return res.status(result.status).json({ error: result.error, errorCode: result.code, party: result.party ? partyView(result.party) : null });
            await removePartyInvitation(player.slug, partyId);
            captureServerProductEvent('clan_boss_party_state_changed', { partySizeBucket: String(result.party.members.length), stateCategory: 'joined' });
            return res.status(200).json(await partyEnvelope(player));
        }

        let queuedAtBeforeMutation = 0;
        const result = await mutateParty({
            partyId, actor: player.slug, requestId, expectedVersion, fingerprint,
            mutate: async (party, now) => {
                queuedAtBeforeMutation = Number(party.queuedAt ?? 0);
                const member = party.members.find((entry) => entry.slug === player.slug);
                const leader = party.leaderSlug === player.slug;
                if (action === 'decline') {
                    if (!party.invitedSlugs.includes(player.slug)) return { ok: true, party, replayed: true };
                    return genericMutation(party, { invitedSlugs: party.invitedSlugs.filter((slug) => slug !== player.slug) });
                }
                if (!member) return { ok: false, status: 403, code: 'not-a-member', error: 'You are not a member of that party.', party };
                if (action === 'heartbeat') {
                    return genericMutation(party, { members: party.members.map((entry) => entry.slug === player.slug ? { ...entry, lastSeenAt: now } : entry) });
                }
                if (action === 'leave') return removePartyMember(party, player.slug, now);
                if (action === 'invite') {
                    if (!leader) return { ok: false, status: 403, code: 'leader-required', error: 'Only the party leader can invite members.', party };
                    const target = await loadPartyPlayerContext(String(body.target ?? ''));
                    if (!target || target.clanName !== party.clanName) return { ok: false, status: 400, code: 'invalid-clanmate', error: 'Choose a current clan member.', party };
                    if (party.members.length >= CLAN_BOSS_PARTY_MAX) return { ok: false, status: 409, code: 'party-full', error: 'The party is full.', party };
                    if (party.members.some((entry) => entry.slug === target.slug) || party.invitedSlugs.includes(target.slug)) return { ok: true, party, replayed: true };
                    return genericMutation(party, { invitedSlugs: [...party.invitedSlugs, target.slug].slice(-12) });
                }
                if (action === 'kick') {
                    if (!leader) return { ok: false, status: 403, code: 'leader-required', error: 'Only the party leader can remove members.', party };
                    const target = safeName(String(body.target ?? ''));
                    if (!target || target === player.slug) return { ok: false, status: 400, code: 'invalid-target', error: 'Choose another party member.', party };
                    return removePartyMember(party, target, now);
                }
                if (action === 'transfer') {
                    if (!leader) return { ok: false, status: 403, code: 'leader-required', error: 'Only the party leader can transfer leadership.', party };
                    const target = safeName(String(body.target ?? ''));
                    if (!party.members.some((entry) => entry.slug === target)) return { ok: false, status: 400, code: 'invalid-target', error: 'Choose a current party member.', party };
                    return genericMutation(party, { leaderSlug: target });
                }
                if (action === 'claim-leadership') {
                    if (!canClaimPartyLeadership(party, player.slug, now)) {
                        return { ok: false, status: 409, code: 'leader-present', error: 'Leadership can only be recovered after the current leader disconnects.', party };
                    }
                    return genericMutation(party, { leaderSlug: player.slug });
                }
                if (action === 'ready') {
                    if (party.status !== 'forming') return { ok: false, status: 409, code: 'party-not-forming', error: 'Readiness is locked while queued or active.', party };
                    return genericMutation(party, { members: party.members.map((entry) => entry.slug === player.slug ? { ...entry, ready: true, snapshot: snapshotForPlayer(player, now), lastSeenAt: now } : entry) });
                }
                if (action === 'unready') {
                    if (party.status !== 'forming') return { ok: false, status: 409, code: 'party-not-forming', error: 'Cancel the queue before changing readiness.', party };
                    return genericMutation(party, { members: party.members.map((entry) => entry.slug === player.slug ? { ...entry, ready: false, snapshot: undefined, lastSeenAt: now } : entry) });
                }
                if (action === 'queue') return queueParty(party, player.slug, now);
                if (action === 'cancel-queue') {
                    if (!leader) return { ok: false, status: 403, code: 'leader-required', error: 'Only the party leader can cancel the finder.', party };
                    if (party.status !== 'queued') return { ok: false, status: 409, code: 'not-queued', error: 'The party is not queued.', party };
                    return genericMutation(party, { status: 'forming', queuedAt: undefined, fallbackAt: undefined, soloFallbackAccepted: false });
                }
                if (action === 'solo-fallback') {
                    if (!leader || party.status !== 'queued' || party.members.length !== 1 || now < Number(party.fallbackAt ?? Number.POSITIVE_INFINITY)) {
                        return { ok: false, status: 409, code: 'fallback-unavailable', error: 'Solo fallback is not available yet.', party };
                    }
                    return genericMutation(party, { status: 'forming', visibility: 'private', soloFallbackAccepted: true, queuedAt: undefined, fallbackAt: undefined });
                }
                if (action === 'ping') {
                    const kind = String(body.ping ?? '') as ClanBossPingKind;
                    if (!PING_KINDS.has(kind)) return { ok: false, status: 400, code: 'invalid-ping', error: 'Choose a supported tactical ping.', party };
                    if (party.status === 'completed' || party.status === 'disbanded' || party.status === 'expired') return { ok: false, status: 409, code: 'party-closed', error: 'That operation is closed.', party };
                    return genericMutation(party, { pings: [{ id: `${now}-${player.slug}`, by: player.slug, kind, at: now }, ...party.pings].slice(0, 20) });
                }
                if (action === 'disband') {
                    if (!leader) return { ok: false, status: 403, code: 'leader-required', error: 'Only the party leader can disband.', party };
                    if (party.status === 'active') return { ok: false, status: 409, code: 'party-active', error: 'An active operation must finish or expire.', party };
                    return genericMutation(party, { status: 'disbanded', disbandReason: 'leader-disbanded' });
                }
                return { ok: false, status: 400, code: 'unknown-action', error: 'Unknown party action.', party };
            },
        });

        if (!result.ok) return res.status(result.status).json({ error: result.error, errorCode: result.code, party: result.party ? partyView(result.party) : null });

        const target = safeName(String(body.target ?? ''));
        if (action === 'invite' && target) await addPartyInvitation(target, partyId);
        if (action === 'decline') await removePartyInvitation(player.slug, partyId);
        if (action === 'leave') await clearPartyPlayerIndex(player.slug, partyId).catch(() => false);
        if (action === 'kick' && target) await clearPartyPlayerIndex(target, partyId).catch(() => false);
        if (result.party.status === 'disbanded') await clearPartyMemberIndices(result.party);
        else await indexPartyMembers(result.party);
        if (!result.replayed && action !== 'heartbeat' && action !== 'ping') {
            const stateByAction: Record<string, string> = {
                invite: 'invited', decline: 'declined', leave: 'abandoned', kick: 'removed',
                transfer: 'leader-transferred', 'claim-leadership': 'leader-recovered', ready: 'ready', unready: 'unready', queue: 'queued',
                'cancel-queue': 'queue-cancelled', 'solo-fallback': 'solo-fallback', disband: 'disbanded',
            };
            const wait = queuedAtBeforeMutation > 0 ? Date.now() - queuedAtBeforeMutation : 0;
            const queueWaitBucket = action !== 'solo-fallback' ? undefined
                : wait < 2 * 60_000 ? 'under-2m'
                    : wait < 5 * 60_000 ? '2-5m'
                        : '5m-plus';
            captureServerProductEvent('clan_boss_party_state_changed', {
                partySizeBucket: String(result.party.members.length),
                stateCategory: stateByAction[action] ?? action,
                ...(queueWaitBucket ? { queueWaitBucket } : {}),
            });
        }
        return res.status(200).json(await partyEnvelope(player));
    } catch (error) {
        console.error('[clan-boss/party]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

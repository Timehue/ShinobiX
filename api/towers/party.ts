import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { getFloor, isPublicFloor } from './_floor-catalog.js';
import { isValidSpireTier } from './_spire-catalog.js';
import { towerModeDisabled } from './_mode-control.js';
import {
    TOWER_PARTY_ID,
    TOWER_PARTY_REQUEST_ID,
    activeTowerPartyForPlayer,
    createTowerParty,
    declineTowerPartyInvitation,
    inviteTowerPartyMember,
    joinTowerParty,
    kickTowerPartyMember,
    leaveTowerParty,
    loadTowerParty,
    resolveTowerPartyCode,
    revokeTowerPartyInvitation,
    setTowerPartyReady,
    towerPartyInvitations,
    towerPartyView,
    type StoredTowerParty,
    type TowerPartyBinding,
    type TowerPartyMutationResult,
} from './_party.js';

const VERSION_REQUIRED_ACTIONS = new Set(['accept', 'decline', 'leave', 'ready', 'unready', 'invite', 'kick', 'revoke-invite']);

function parseBody(req: VercelRequest): Record<string, unknown> {
    return typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) as Record<string, unknown>;
}

function bindingFrom(input: Record<string, unknown>): TowerPartyBinding | null {
    const mode = String(input.mode ?? 'story') === 'spire' ? 'spire' : 'story';
    if (mode === 'spire') {
        const ascensionTier = Math.floor(Number(input.ascensionTier));
        return isValidSpireTier(ascensionTier) ? { mode, ascensionTier } : null;
    }
    const floor = Math.floor(Number(input.floor));
    return isPublicFloor(floor) && getFloor(floor) ? { mode, floor } : null;
}

function mutationFingerprint(body: Record<string, unknown>): string {
    const value = {
        action: String(body.action ?? ''),
        partyId: String(body.partyId ?? ''),
        inviteCode: String(body.inviteCode ?? '').trim().toUpperCase(),
        target: safeName(String(body.target ?? '')),
        ready: body.ready === true || body.action === 'ready',
    };
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function envelope(player: string, party?: StoredTowerParty | null, replayed?: boolean) {
    const current = party === undefined ? await activeTowerPartyForPlayer(player) : party;
    return {
        party: current ? towerPartyView(current) : null,
        invitations: await towerPartyInvitations(player),
        ...(replayed === undefined ? {} : { replayed }),
    };
}

function mutationError(res: VercelResponse, result: Exclude<TowerPartyMutationResult, { ok: true }>) {
    return res.status(result.status).json({
        error: result.error,
        errorCode: result.code,
        party: result.party ? towerPartyView(result.party) : null,
    });
}

/** GET polls status/invitations. POST mutates a Tower-only ready room. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    try {
        const input = req.method === 'GET' ? req.query as Record<string, unknown> : parseBody(req);
        const playerName = safeName(String(input.playerName ?? input.player ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing player.', errorCode: 'invalid-player' });
        if (!enforceRateLimit(req, res, 'tower-party', req.method === 'GET' ? 90 : 45, 60_000, playerName)) return;
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only manage your own Tower party presence.' });
        res.setHeader('Cache-Control', 'private, no-store');

        if (req.method === 'GET') {
            const requestedId = String(input.partyId ?? '');
            if (!requestedId) return res.status(200).json(await envelope(playerName));
            if (!TOWER_PARTY_ID.test(requestedId)) return res.status(400).json({ error: 'Invalid party.', errorCode: 'invalid-party' });
            const requested = await loadTowerParty(requestedId);
            if (!requested) return res.status(404).json({ error: 'That Tower party no longer exists.', errorCode: 'party-not-found' });
            const allowed = identity.admin
                || requested.members.some(member => member.slug === playerName)
                || requested.invitedSlugs.includes(playerName);
            if (!allowed) return res.status(403).json({ error: 'You cannot view that Tower party.', errorCode: 'party-forbidden' });
            return res.status(200).json(await envelope(playerName, requested));
        }

        const body = input;
        const action = String(body.action ?? '');
        const requestId = String(body.requestId ?? '');
        if (!TOWER_PARTY_REQUEST_ID.test(requestId)) {
            return res.status(400).json({ error: 'A valid request ID is required.', errorCode: 'invalid-request-id' });
        }

        const save = await kv.get<Record<string, unknown>>(`save:${playerName}`);
        const character = save?.character as Record<string, unknown> | undefined;
        if (!character) return res.status(404).json({ error: 'Your save was not found.', errorCode: 'save-not-found' });
        const displayName = String(character.name ?? playerName).slice(0, 40);

        if (action === 'create') {
            if (towerModeDisabled()) return res.status(503).json({ error: 'Battle Towers launches are temporarily disabled.', errorCode: 'tower-mode-disabled' });
            const binding = bindingFrom(body);
            if (!binding) return res.status(400).json({ error: 'Choose a valid Tower floor or Spire tier.', errorCode: 'invalid-binding' });
            const result = await createTowerParty({ hostSlug: playerName, displayName, binding });
            if (!result.ok) return mutationError(res, result);
            return res.status(200).json(await envelope(playerName, result.party, result.replayed));
        }

        let partyId = String(body.partyId ?? '');
        let preview: StoredTowerParty | null = null;
        if (action === 'join') {
            preview = await resolveTowerPartyCode(String(body.inviteCode ?? ''));
            if (!preview) return res.status(404).json({ error: 'That Tower invite code is no longer valid.', errorCode: 'party-not-found' });
            partyId = preview.id;
        } else {
            if (!TOWER_PARTY_ID.test(partyId)) return res.status(400).json({ error: 'Invalid party.', errorCode: 'invalid-party' });
            preview = await loadTowerParty(partyId);
            if (!preview) return res.status(404).json({ error: 'That Tower party no longer exists.', errorCode: 'party-not-found' });
        }
        const hasSuppliedVersion = Object.prototype.hasOwnProperty.call(body, 'expectedVersion');
        const suppliedVersion = body.expectedVersion;
        const validSuppliedVersion = typeof suppliedVersion === 'number'
            && Number.isSafeInteger(suppliedVersion)
            && suppliedVersion >= 0;
        if ((VERSION_REQUIRED_ACTIONS.has(action) && !validSuppliedVersion)
            || (action === 'join' && hasSuppliedVersion && !validSuppliedVersion)) {
            return res.status(400).json({
                error: 'A valid expectedVersion is required for this party action.',
                errorCode: 'invalid-version',
                party: towerPartyView(preview),
            });
        }
        // Open-code joiners may not know the current version yet. All mutations
        // by an existing/invited member carry an explicit optimistic version.
        const expectedVersion = validSuppliedVersion ? suppliedVersion : preview.version;
        const fingerprint = mutationFingerprint({ ...body, partyId });

        let result: TowerPartyMutationResult;
        if (action === 'join' || action === 'accept') {
            result = await joinTowerParty({
                actor: playerName,
                displayName,
                partyId,
                requestId,
                expectedVersion,
                fingerprint,
                requireTargetedInvite: action === 'accept',
            });
        } else if (action === 'decline') {
            result = await declineTowerPartyInvitation({ partyId, actor: playerName, requestId, expectedVersion, fingerprint });
        } else if (action === 'leave') {
            result = await leaveTowerParty({ partyId, actor: playerName, requestId, expectedVersion, fingerprint });
        } else if (action === 'ready' || action === 'unready') {
            result = await setTowerPartyReady({
                partyId,
                actor: playerName,
                ready: action === 'ready' ? body.ready !== false : false,
                requestId,
                expectedVersion,
                fingerprint,
            });
        } else if (action === 'invite') {
            const target = safeName(String(body.target ?? ''));
            if (!target || target === playerName || !(await kv.get(`save:${target}`))) {
                return res.status(400).json({ error: 'Choose another current player.', errorCode: 'invalid-target' });
            }
            result = await inviteTowerPartyMember({ partyId, actor: playerName, target, requestId, expectedVersion, fingerprint });
        } else if (action === 'kick') {
            const target = safeName(String(body.target ?? ''));
            if (!target || target === playerName) {
                return res.status(400).json({ error: 'Choose another current party member.', errorCode: 'invalid-target' });
            }
            result = await kickTowerPartyMember({
                partyId,
                actor: playerName,
                target,
                requestId,
                expectedVersion,
                fingerprint,
            });
        } else if (action === 'revoke-invite') {
            const target = safeName(String(body.target ?? ''));
            if (!target || target === playerName) {
                return res.status(400).json({ error: 'Choose another invited player.', errorCode: 'invalid-target' });
            }
            result = await revokeTowerPartyInvitation({
                partyId,
                actor: playerName,
                target,
                requestId,
                expectedVersion,
                fingerprint,
            });
        } else {
            return res.status(400).json({ error: 'Unknown party action.', errorCode: 'unknown-action' });
        }

        if (!result.ok) return mutationError(res, result);
        return res.status(200).json(await envelope(playerName, result.party, result.replayed));
    } catch (error) {
        console.error('[towers/party]', error);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

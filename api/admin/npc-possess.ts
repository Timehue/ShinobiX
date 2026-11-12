import type { ApiRequest, ApiResponse } from '../_vercel.js';
import { cors, safeName } from '../_utils.js';
import { isFullAdmin, issuePlayerToken, playerSessionsEnabled, rotatePlayerSessionEpoch, verifyPlayerToken } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { safeLogValue } from '../_safe-log.js';
import { kv } from '../_storage.js';
import { recordAudit } from '../_audit.js';
import { NPC_VILLAGE_ROSTER, isNpcAccount } from '../../shared/npc-village-roster.js';
import { npcLevelFor, readNpcVillageScaling, ensureNpcPetScaling, NPC_SCALING_FLOOR } from '../_npc-village-scaling.js';
import { NPC_POSSESS_TTL_MS, isNpcPossessed, npcPossessKey, readNpcPossession, type NpcPossession } from '../_npc-possession.js';
import { seedNpcVillage } from '../_npc-village-seed.js';
import { npcAuthOwned } from '../_npc-ownership.js';
import { npcInLiveDuel } from '../_npc-duel.js';
import { npcInLiveCardDuel } from '../_npc-card-duel-driver.js';
import { readNpcLeaders } from '../_npc-village-leaders.js';
import { withKvLock } from '../_lock.js';
import { approveNpcWar, readNpcWarHistory, readNpcWarProposal, rejectNpcWar } from '../_npc-village-war.js';
import { aggressionView, readNpcAggression } from '../_npc-village-aggression.js';
import { holdNpcJourney } from '../_npc-journeys.js';

/**
 * Admin control of a Cinderhold NPC ("log in as the NPC"), 2026-11-08.
 *
 *   GET  /api/admin/npc-possess                       → { sessions, npcs: [...] }
 *   POST /api/admin/npc-possess { npc, action: 'take' }    → { ok, token, name, expiresAt }
 *   POST /api/admin/npc-possess { npc, action: 'release' } → { ok }  (admin, or that NPC's own session)
 *   POST /api/admin/npc-possess { action: 'war-approve' | 'war-reject', proposalId } → Cinderhold's
 *        pending sector-war proposal (api/_npc-village-war.ts); approve declares it with THIS
 *        admin's own credentials through the normal sector-war declare.
 *   (Cinderhold's clans never declare a clan war, owner ruling 2026-11-10, so
 *   there is no clan-war proposal to approve; player clans declare on them.)
 *
 * RISK, stated per CLAUDE.md: this is a second way to mint a player session
 * token. It is bounded four ways:
 *   - full admins only;
 *   - ONLY the 30 password-less Cinderhold slugs (isNpcAccount, a static list
 *     shipped in code), and only while the account is the seeder's own (auth
 *     row stamped npcVillage, no password: api/_npc-ownership.ts) — a real
 *     player's account, even one holding an NPC's name, can never be entered
 *     or released here;
 *   - the token lives 2 h and is never slid into a 24 h session
 *     (maybeRefreshPlayerToken refuses NPC slugs);
 *   - every take/release rotates the NPC's session epoch (kicking any earlier
 *     holder and their sockets) and is written to the `audit:npc` log.
 * With SESSION_SECRET unset there are no tokens, so possession is unavailable
 * and nothing about the no-token player path changes.
 */
export { npcPossessKey } from '../_npc-possession.js';

function parseBody(req: ApiRequest): Record<string, unknown> {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
    return (req.body as Record<string, unknown>) ?? {};
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    // The "Return to my account" bar runs while the browser holds only the NPC's
    // token (the admin password is never stored), so a release may also be sent
    // by the NPC session itself: ending your own takeover grants nothing.
    const body = req.method === 'POST' ? parseBody(req) : {};
    const selfRelease = body.action === 'release' && typeof req.headers['x-player-token'] === 'string'
        && await verifyPlayerToken(req.headers['x-player-token']).catch(() => null) === safeName(String(body.npc ?? ''));
    if (!selfRelease && !isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-npc-possess', 30, 60_000)) return;
    res.setHeader('Cache-Control', 'no-store');

    try {
        if (req.method === 'GET') {
            const scaling = await readNpcVillageScaling();
            const base = scaling?.baseLevel ?? NPC_SCALING_FLOOR;
            const now = Date.now();
            // One read of the thirty auth rows. `seeded` is true only for an
            // account the seeder owns; `playerAccount` flags a name a PLAYER
            // holds (never seeded, never controllable here).
            const auths = await kv.mget<Array<Record<string, unknown> | null>>(...NPC_VILLAGE_ROSTER.map((npc) => `auth:${npc.id}`));
            const npcs = await Promise.all(NPC_VILLAGE_ROSTER.map(async (npc, i) => {
                const possessed = await readNpcPossession(npc.id, now);
                const auth = auths[i] ?? null;
                return { id: npc.id, name: npc.name, rank: npc.rank, personality: npc.personality, level: npcLevelFor(npc.rank, base),
                    bloodline: npc.bloodline.name, seeded: npcAuthOwned(auth), ...(auth && !npcAuthOwned(auth) ? { playerAccount: true } : {}),
                    possessedUntil: possessed?.expiresAt ?? null };
            }));
            const leaders = (await readNpcLeaders()).map(({ seat, name }) => ({ seat, name }));
            const [proposal, history, aggression] = await Promise.all([readNpcWarProposal(now), readNpcWarHistory(), readNpcAggression(now)]);
            const war = { proposal, lastDeclaredAt: history.lastDeclaredAt ?? null, last: history.last ?? null, aggression: aggressionView(aggression) };
            return res.status(200).json({ sessions: playerSessionsEnabled(), baseLevel: base, leaders, npcs, war });
        }

        const action = String(body.action ?? '');
        if (action === 'war-approve' || action === 'war-reject') {
            if (selfRelease) return res.status(403).json({ error: 'Full admin access required.' });
            const proposalId = String(body.proposalId ?? '');
            if (action === 'war-reject') {
                const rejected = await rejectNpcWar(proposalId);
                if (!rejected) return res.status(409).json({ error: 'That proposal is no longer pending.' });
                await recordAudit({ actor: 'admin', domain: 'npc', action: 'npc.war-reject', entityType: 'npc', entityId: 'cinderhold', after: { proposalId } });
                return res.status(200).json({ ok: true });
            }
            // The declare runs as THIS admin: only their own credential headers
            // are forwarded, so the sector-war route re-checks full admin itself.
            const headers: Record<string, string> = {};
            for (const name of ['x-admin-token', 'x-admin-password']) {
                const value = req.headers[name];
                if (typeof value === 'string' && value) headers[name] = value;
            }
            const remoteAddress = String((req as { socket?: { remoteAddress?: string } }).socket?.remoteAddress ?? '');
            // The admin chooses the war's kind here (Push 4b): the proposal's
            // sector war, or a five-day village war on the same village.
            const kind = body.kind === 'village' ? 'village' : 'sector';
            const approved = await approveNpcWar(proposalId, { headers, remoteAddress }, Date.now(), kind);
            if (!approved.ok) return res.status(approved.status).json({ error: approved.error });
            await recordAudit({ actor: 'admin', domain: 'npc', action: 'npc.war-approve', entityType: 'npc', entityId: 'cinderhold', after: { proposalId, kind, contestId: approved.contestId ?? null, warId: approved.warId ?? null } });
            return res.status(200).json(approved);
        }
        if (process.env.DISABLE_NPC_VILLAGE === '1' && (action === 'rebuild' || action === 'take')) {
            return res.status(503).json({ error: 'Cinderhold is switched off on this server (DISABLE_NPC_VILLAGE).' });
        }
        if (action === 'rebuild') {
            // Rebuild all 30 now (the 03:00 UTC pass, on demand): creates any
            // missing account and refreshes every free NPC's save at its level.
            if (selfRelease) return res.status(403).json({ error: 'Full admin access required.' });
            await ensureNpcPetScaling();
            const rebuilt = await seedNpcVillage(Date.now(), (slug) => isNpcPossessed(slug));
            await recordAudit({ actor: 'admin', domain: 'npc', action: 'npc.rebuild', entityType: 'npc', entityId: 'cinderhold',
                after: { seeded: rebuilt.seeded.length, rescaled: rebuilt.rescaled.length, skipped: rebuilt.skipped.length, failures: rebuilt.failures.length } });
            return res.status(200).json({ ok: true, ...rebuilt });
        }
        const slug = safeName(String(body.npc ?? ''));
        if (!slug || !isNpcAccount(slug)) return res.status(400).json({ error: 'Only a Cinderhold NPC can be taken over.' });
        const npc = NPC_VILLAGE_ROSTER.find((entry) => entry.id === slug)!;

        if (action === 'take') {
            if (!playerSessionsEnabled()) return res.status(503).json({ error: 'Session tokens are off on this server (SESSION_SECRET unset), so NPC control is unavailable.' });
            const auth = await kv.get<Record<string, unknown>>(`auth:${slug}`);
            if (!auth) return res.status(409).json({ error: `${npc.name} has not been seeded yet.` });
            // A PLAYER who registered this name before it became an NPC's owns
            // it: taking it would log them out and mint a token for THEIR account.
            if (!npcAuthOwned(auth)) return res.status(409).json({ error: `The account "${slug}" belongs to a player, not to Cinderhold. It cannot be taken over.` });
            // The daily rebuild (api/_npc-village-seed.ts) and a new duel's seal
            // (api/_npc-duel.ts sealNpcDuel) hold this same lock, so a takeover
            // never starts mid-rebuild or between a duel's seal and its publish.
            const taken = await withKvLock(npcPossessKey(slug), async () => {
                // Re-read under the lock the seeder holds: still the NPC's own account.
                if (!npcAuthOwned(await kv.get<Record<string, unknown>>(`auth:${slug}`))) return 'player' as const;
                // Never take over mid-duel: the server's seat is playing a sealed
                // (possibly paid) fight, and a hand-played seat could throw it.
                if (await npcInLiveDuel(slug) || await npcInLiveCardDuel(slug)) return 'busy' as const;
                const epoch = await rotatePlayerSessionEpoch(slug);
                const now = Date.now();
                const token = issuePlayerToken(slug, NPC_POSSESS_TTL_MS, epoch);
                if (!token) return null;
                const possession: NpcPossession = { by: 'admin', at: now, expiresAt: now + NPC_POSSESS_TTL_MS };
                await kv.set(npcPossessKey(slug), possession, { ex: Math.ceil(NPC_POSSESS_TTL_MS / 1000) });
                return { token, possession };
            }, { failClosed: true });
            if (taken === 'player') return res.status(409).json({ error: `The account "${slug}" belongs to a player, not to Cinderhold. It cannot be taken over.` });
            if (taken === 'busy') return res.status(409).json({ error: `${npc.name} is in a duel. Try again when it ends.` });
            if (!taken) return res.status(503).json({ error: 'Could not mint a session for this NPC.' });
            const { token, possession } = taken;
            // The admin walks it from now: its journey walker stands down at
            // once, not at the next presence tick (in memory, no auth effect).
            holdNpcJourney(slug, 'possessed');
            await recordAudit({ actor: 'admin', domain: 'npc', action: 'npc.possess', entityType: 'npc', entityId: slug, after: { expiresAt: possession.expiresAt } });
            return res.status(200).json({ ok: true, token, name: npc.name, expiresAt: possession.expiresAt });
        }
        if (action === 'release') {
            // A player's own account is never "released": that would sign them out.
            if (!npcAuthOwned(await kv.get<Record<string, unknown>>(`auth:${slug}`))) {
                return res.status(409).json({ error: `The account "${slug}" belongs to a player, not to Cinderhold.` });
            }
            await rotatePlayerSessionEpoch(slug);
            await kv.del(npcPossessKey(slug));
            await recordAudit({ actor: 'admin', domain: 'npc', action: 'npc.release', entityType: 'npc', entityId: slug });
            return res.status(200).json({ ok: true });
        }
        return res.status(400).json({ error: "action must be 'take', 'release', 'rebuild', 'war-approve' or 'war-reject'." });
    } catch (err) {
        console.error('[admin/npc-possess]', safeLogValue(err));
        return res.status(503).json({ error: 'NPC control is unavailable. Try again.' });
    }
}

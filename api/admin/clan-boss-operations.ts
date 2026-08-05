import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { cors } from '../_utils.js';
import { isFullAdmin } from '../_auth.js';
import { enforceRateLimit } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { withKvLock } from '../_lock.js';
import { recordAudit } from '../_audit.js';
import { readSession } from '../towers/_tower-store.js';
import { clearPartyMemberIndices, clanBossPartiesEnabled, loadParty, partyKey, saveParty } from '../clan-boss/_party.js';

const RECOVERY_REASONS = new Set(['session-missing', 'stuck-starting', 'operator-request']);

function ageBucket(ms: number): string {
    if (ms < 60_000) return 'under-1m';
    if (ms < 5 * 60_000) return '1-5m';
    if (ms < 15 * 60_000) return '5-15m';
    return 'over-15m';
}

async function operationSnapshot() {
    const now = Date.now();
    const keys = await kv.keys('clan-boss:party:cbp-*');
    const parties = (await Promise.all(keys.slice(0, 500).map((key) => loadParty(key.slice('clan-boss:party:'.length)))))
        .filter((party) => !!party);
    const rows = await Promise.all(parties.map(async (party) => {
        const needsSession = party.status === 'active' || party.status === 'starting';
        const session = party.runId && needsSession ? await readSession(party.runId) : null;
        return {
            partyId: party.id,
            status: party.status,
            memberCount: party.members.length,
            readyCount: party.members.filter((member) => member.ready).length,
            visibility: party.visibility,
            version: party.version,
            ageBucket: ageBucket(now - party.updatedAt),
            hasRunId: !!party.runId,
            missingSession: party.status === 'active' && !!party.runId && !session,
            staleMembers: party.members.filter((member) => now - member.lastSeenAt > 45_000).length,
        };
    }));
    const byStatus: Record<string, number> = {};
    for (const row of rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
    return {
        generatedAt: now,
        feature: { clanBossEnabled: process.env.ENABLE_CLAN_BOSS === '1', partiesEnabled: clanBossPartiesEnabled() },
        totals: {
            parties: rows.length,
            byStatus,
            publicQueued: rows.filter((row) => row.status === 'queued' && row.visibility === 'public').length,
            missingSessions: rows.filter((row) => row.missingSession).length,
            staleMembers: rows.reduce((sum, row) => sum + row.staleMembers, 0),
        },
        parties: rows.sort((a, b) => a.status.localeCompare(b.status) || a.partyId.localeCompare(b.partyId)),
    };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
    if (!isFullAdmin(req)) return res.status(403).json({ error: 'Full admin access required.' });
    if (!enforceRateLimit(req, res, 'admin-clan-boss-operations', req.method === 'GET' ? 60 : 10, 60_000)) return;
    try {
        if (req.method === 'GET') {
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({ ok: true, ...(await operationSnapshot()) });
        }
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const partyId = String(body.partyId ?? '');
        const expectedVersion = Number(body.expectedVersion);
        const reason = String(body.reason ?? '');
        if (body.action !== 'recover-disband' || body.confirm !== true || !RECOVERY_REASONS.has(reason)) {
            return res.status(400).json({ error: 'Recovery requires action, confirm=true, and a canonical reason.' });
        }
        let recovered = false;
        let before: Record<string, unknown> | undefined;
        await withKvLock(partyKey(partyId), async () => {
            const party = await loadParty(partyId);
            if (!party) throw Object.assign(new Error('Party not found.'), { status: 404 });
            if (!Number.isSafeInteger(expectedVersion) || party.version !== expectedVersion) throw Object.assign(new Error('Party version changed.'), { status: 409 });
            if (!['forming', 'queued', 'starting'].includes(party.status)) throw Object.assign(new Error('Only pre-start or stuck-starting parties can be recovered.'), { status: 409 });
            before = { status: party.status, version: party.version, memberCount: party.members.length, hasRunId: !!party.runId };
            await saveParty({
                ...party,
                status: 'disbanded',
                disbandReason: `admin:${reason}`,
                version: party.version + 1,
                updatedAt: Date.now(),
            });
            await clearPartyMemberIndices(party);
            recovered = true;
        }, { failClosed: true });
        await recordAudit({
            domain: 'combat', actor: 'admin', action: 'clan-boss.party-recover-disband',
            entityType: 'clan-boss-party', entityId: partyId, before, after: { status: 'disbanded' }, reason,
        });
        return res.status(200).json({ ok: true, recovered, ...(await operationSnapshot()) });
    } catch (error) {
        const status = Number((error as { status?: number }).status) || 500;
        if (status === 500) console.error('[admin/clan-boss-operations]', error);
        return res.status(status).json({ error: (error as Error).message || 'Internal server error.' });
    }
}

import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { kv } from '../_storage.js';
import { cors, safeName } from '../_utils.js';
import { releaseTowerBattleLeases, towerBattleLeaseMembers } from '../towers/_battle-lease.js';
import { readSession, settleConsumedItemsForMember, writeSession } from '../towers/_tower-store.js';
import { WORLD_CRISIS_80_ID } from '../../shared/world-crisis-80.js';
import { readWorldCrisis80Projection, recordWorldCrisis80Defense } from './_state.js';

/** POST /api/world-crisis-80/combat-settle
 *
 * Reads the terminal Tower session as the outcome proof. No outcome, village,
 * source, contribution amount, consumable use, or reward is accepted from the
 * client. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {}) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        const runId = String(body.runId ?? '').trim().slice(0, 96);
        if (!playerName || !/^wcr80-[a-f0-9]{32}$/.test(runId)) return res.status(400).json({ error: 'Invalid crisis battle receipt.' });
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Can only settle your own deployment.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'world-crisis-80-combat-settle', 30, 60_000, playerName))) return;

        const outcome = await withKvLock(`world:crisis:${WORLD_CRISIS_80_ID}:settle:${runId}`, async () => {
            const session = await readSession(runId);
            if (!session) return { status: 404, body: { error: 'That witness-ledger battle has expired.' }, members: [] as string[] };
            const binding = session.worldCrisis80;
            if (!binding || binding.crisisId !== WORLD_CRISIS_80_ID) {
                return { status: 409, body: { error: 'That fight is not a Hollow Gate Reckoning deployment.' }, members: [] as string[] };
            }
            const member = session.actors.find((actor) => actor.side === 'squad' && actor.ownerSlug === playerName && actor.ai === false);
            if (!identity.admin && !member) return { status: 403, body: { error: 'You were not the shinobi sealed into this deployment.' }, members: [] as string[] };
            if (session.status !== 'done') return { status: 409, body: { error: 'The collection cell is still active.' }, members: [] as string[] };

            const won = session.winner === 'squad';
            const crisis = session.rewardSettlementState === 'settled'
                ? await readWorldCrisis80Projection()
                : await recordWorldCrisis80Defense({
                    playerName,
                    village: binding.village,
                    sourceId: binding.sourceId,
                    proofId: `tower:${runId}`,
                    path: 'shinobi',
                    outcome: won ? 'win' : session.winner === 'draw' ? 'draw' : 'loss',
                });
            const consumables = await settleConsumedItemsForMember({ session, slug: playerName });
            if (session.rewardSettlementState !== 'settled') {
                session.rewardSettlementState = 'settled';
                await writeSession(session);
            }
            const record = await kv.get<Record<string, unknown>>(`save:${playerName}`);
            return {
                status: 200,
                members: towerBattleLeaseMembers(session),
                body: {
                    ok: true,
                    settled: true,
                    won,
                    path: 'shinobi',
                    village: binding.village,
                    crisis,
                    consumables,
                    character: record?.character,
                    _saveVersion: Number(record?._saveVersion ?? 0),
                },
            };
        }, { failClosed: true });

        if (outcome.status === 200 && outcome.members.length) {
            await releaseTowerBattleLeases(runId, outcome.members);
        }
        return res.status(outcome.status).json(outcome.body);
    } catch (error) {
        console.error('[world-crisis-80/combat-settle]', error);
        return res.status(500).json({ error: 'The witness-ledger result could not be sealed. Retry from the battle result.' });
    }
}

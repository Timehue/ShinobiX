import { randomBytes } from 'node:crypto';
import { repairRankedArenaAdmission } from '../_pet-tactics/ranked.js';
import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { cors } from '../_utils.js';
import { kv } from '../_storage.js';
import { LockContendedError, withKvLock } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { TacticsError, validateBuilds } from '../_pet-tactics/engine.js';
import { acknowledgeTacticsRound, advanceTacticsSession, concedeTacticsSession, createTacticsSession, joinTacticsSession, lockTacticsLeads, lockTacticsOrders,
    sessionSeat, tacticsPlayerKey, tacticsRoomKey, tacticsView, TACTICS_SESSION_TTL_SECONDS, type TacticsSession } from '../_pet-tactics/session.js';

type Store = { get(key: string): Promise<unknown>; set(key: string, value: unknown, options: { ex?: number }): Promise<unknown> };
type Dependencies = {
    store: Store; lock<T>(key: string, fn: () => Promise<T>): Promise<T>;
    authenticate(req: VercelRequest): Promise<string | null>;
    limit(req: VercelRequest, res: VercelResponse, name: string): Promise<boolean>;
    now(): number; roomId(): string; seed(): number;
    beforeAdmission?(): Promise<void>;
};
/** Factory supports an isolated local two-browser harness; production always supplies real auth and KV. */
export function createTacticsHandler(deps: Dependencies) {
    const save = (session: TacticsSession) => { session.revision++; return deps.store.set(tacticsRoomKey(session.roomId), session,
        session.ranked && !session.ranked.settled ? {} : { ex: TACTICS_SESSION_TTL_SECONDS }); };
    const read = async (id: string): Promise<TacticsSession> => {
        const session = await deps.store.get(tacticsRoomKey(id)) as TacticsSession | null;
        if (!session || session.ruleset !== 'pet-tactics-v1') throw new TacticsError('That arena room was not found.', 404);
        return session;
    };
    return async (req: VercelRequest, res: VercelResponse) => {
        cors(res, req);
        if (req.method === 'OPTIONS') return res.status(200).end();
        if (req.method !== 'POST') return res.status(405).end();
        res.setHeader('Cache-Control', 'private, no-store');
        try {
            const name = await deps.authenticate(req);
            if (!name) return res.status(401).json({ error: 'A player session is required.' });
            if (!await deps.limit(req, res, name)) return;
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
            const action = body.action ?? 'recover';
            if (!['create', 'join', 'recover', 'poll', 'leads', 'orders', 'ack', 'concede'].includes(action)) throw new TacticsError('Unknown arena action.');
            const now = deps.now();
            if (action === 'create' || action === 'join') {
                const builds = validateBuilds(body.builds);
                const view = await deps.lock('pet:tactics:admission', async () => {
                    await deps.beforeAdmission?.();
                    const pointer = await deps.store.get(tacticsPlayerKey(name));
                    if (typeof pointer === 'string') {
                        const existing = await deps.lock(tacticsRoomKey(pointer), async () => {
                            const current = await read(pointer).catch(error => { if (error instanceof TacticsError && error.status === 404) return null; throw error; });
                            if (current) { advanceTacticsSession(current, now); await save(current); }
                            return current;
                        });
                        if (existing) {
                            if (existing.phase !== 'finished' || existing.ranked && !existing.ranked.settled) return tacticsView(existing, sessionSeat(existing, name), now);
                        }
                    }
                    if (action === 'create') {
                        const roomId = deps.roomId();
                        if (await deps.store.get(tacticsRoomKey(roomId))) throw new TacticsError('Arena code is busy. Retry creation.', 503);
                        const session = createTacticsSession(roomId, name, builds, deps.seed(), now);
                        await save(session);
                        await deps.store.set(tacticsPlayerKey(name), roomId, { ex: TACTICS_SESSION_TTL_SECONDS });
                        return tacticsView(session, 'a', now);
                    }
                    const id = String(body.roomId ?? '').trim().toLowerCase();
                    if (!/^[0-9a-f]{8}$/.test(id)) throw new TacticsError('Enter an eight-character arena code.');
                    return deps.lock(tacticsRoomKey(id), async () => {
                        const session = await read(id);
                        joinTacticsSession(session, name, builds, now); await save(session);
                        await deps.store.set(tacticsPlayerKey(name), id, { ex: TACTICS_SESSION_TTL_SECONDS });
                        return tacticsView(session, 'b', now);
                    });
                });
                return res.status(200).json(view);
            }
            const id = action === 'recover' ? await deps.store.get(tacticsPlayerKey(name)) : body.roomId;
            if (action === 'recover' && !id) return res.status(200).json({ idle: true });
            if (typeof id !== 'string' || !/^[0-9a-f]{8}$/.test(id)) throw new TacticsError('A valid arena room is required.');
            const view = await deps.lock(tacticsRoomKey(id), async () => {
                const session = await read(id);
                const seat = sessionSeat(session, name); // Authorize before advancing or touching private state.
                advanceTacticsSession(session, now);
                // A stale action must still persist an elapsed deadline's transition.
                try {
                    if (action === 'leads') lockTacticsLeads(session, seat, body.leads, now);
                    if (action === 'orders') lockTacticsOrders(session, seat, body.round, body.orders, now);
                    if (action === 'ack') acknowledgeTacticsRound(session, seat, body.round, now);
                    if (action === 'concede') concedeTacticsSession(session, seat);
                } catch (error) { await save(session); throw error; }
                await save(session);
                const after = Number.isSafeInteger(body.afterRound) ? Math.max(-1, body.afterRound) : -1;
                return tacticsView(session, seat, now, after);
            });
            return res.status(200).json(view);
        } catch (error) {
            if (error instanceof TacticsError) return res.status(error.status).json({ error: error.message });
            if (error instanceof SyntaxError) return res.status(400).json({ error: 'Invalid request JSON.' });
            if (error instanceof LockContendedError) return res.status(503).json({ error: 'The arena is updating. Retry your request.' });
            console.error('[pet-tactics] request failed', error);
            return res.status(503).json({ error: 'The arena could not answer. Your accepted orders remain locked; reconnect to recover them.' });
        }
    };
}

export default createTacticsHandler({
    store: kv, lock: (key, fn) => withKvLock(key, fn, { failClosed: true }),
    authenticate: async req => { const identity = await authedPlayerOrAdmin(req, ''); return identity && !identity.admin ? identity.name : null; },
    limit: (req, res, name) => enforceRateLimitKv(req, res, 'pet-tactics', 100, 60_000, name, { strict: true }),
    now: Date.now, roomId: () => randomBytes(4).toString('hex'), seed: () => randomBytes(4).readInt32LE(),
    beforeAdmission: () => repairRankedArenaAdmission(kv),
});

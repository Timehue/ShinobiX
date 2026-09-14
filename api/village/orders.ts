import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { cors, safeName } from '../_utils.js';
import { kv } from '../_storage.js';
import { withKvLock, LockContendedError } from '../_lock.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { villageOrderRole } from '../_village-order-role.js';
import { getActiveSilence } from '../admin/moderation.js';
import { sanitizeUserText, TEXT_LIMITS } from '../_text-moderation.js';
import { invalidateProcCache } from '../_proc-cache.js';
import { elderVillageKey } from './_elders.js';
import { MAX_WILD_SECTOR } from '../../shared/sector-geo.js';
import { safeLogValue } from '../_safe-log.js';

type Order = Record<string, unknown>;

/** Single-order actions preserve posts made since the caller last loaded the board. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.method !== 'POST') return res.status(405).end();
    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
        const playerName = safeName(String(body.playerName ?? ''));
        const { action, id } = body;
        if (!playerName || !['post', 'pin', 'delete'].includes(action) || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
            return res.status(400).json({ error: 'Invalid village order action.' });
        }
        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) return res.status(403).json({ error: 'Not your village orders.' });
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'village-orders', 30, 60_000, playerName))) return;
        const save = await kv.get<{ character?: { name?: string; village?: string } }>(`save:${playerName}`);
        const village = save?.character?.village?.trim();
        if (!village) return res.status(404).json({ error: 'Player village not found.' });
        const stateKey = elderVillageKey(village);
        const kageKey = `village:kage:${village.toLowerCase().replace(/\s+/g, '-')}`;
        const result = await withKvLock(kageKey, () => withKvLock(stateKey, async () => {
            const state = await kv.get<Record<string, unknown>>(stateKey) ?? {};
            const kage = await kv.get<{ seatedKage?: string }>(kageKey);
            const role = await villageOrderRole(playerName, village, state, kage);
            if (!role) return { status: 403, body: { error: 'Only the seated Kage, ANBU, and current village Elders can manage orders.' } };
            const posts: Order[] = Array.isArray(state.noticePosts) ? state.noticePosts : [];
            const previous = posts.find(post => post.id === id);
            if (previous && role !== 'Kage' && safeName(String(previous.author ?? '')) !== playerName) {
                return { status: 403, body: { error: 'Only the Kage or the current leadership author can manage this order.' } };
            }
            if (action !== 'delete' && await getActiveSilence(playerName)) return { status: 403, body: { error: 'You are silenced and cannot post or pin orders.' } };
            let noticePosts = posts;
            if (action === 'post') {
                if (previous) return { status: 200, body: { ok: true, noticePosts, unchanged: true } };
                if (!['order', 'raid', 'guard', 'medic', 'trade', 'general'].includes(body.type) || typeof body.title !== 'string' || typeof body.body !== 'string') {
                    return { status: 400, body: { error: 'Choose an order type and enter a title and message.' } };
                }
                const title = sanitizeUserText(body.title, TEXT_LIMITS.noticeTitle).trim();
                const message = sanitizeUserText(body.body, TEXT_LIMITS.noticeBody).trim();
                if (!title || !message) return { status: 400, body: { error: 'Add a title and message for the order.' } };
                const sector = Number(body.sector);
                const post = { id, type: body.type, title, body: message, author: save?.character?.name || playerName, authorRole: role,
                    createdAt: Date.now(), pinned: body.type === 'order',
                    ...(Number.isInteger(sector) && sector >= 1 && sector <= MAX_WILD_SECTOR ? { sector } : {}) };
                // Retention is a server policy, so a full board never asks an
                // ANBU/elder to delete another author's post merely to publish.
                noticePosts = [post, ...posts].slice(0, 60);
            } else if (action === 'pin') {
                if (!previous) return { status: 404, body: { error: 'That order no longer exists.' } };
                if (typeof body.pinned !== 'boolean') return { status: 400, body: { error: 'Choose pin or unpin.' } };
                noticePosts = posts.map(post => post.id === id ? { ...post, pinned: body.pinned } : post);
            } else noticePosts = posts.filter(post => post.id !== id);
            noticePosts = [...noticePosts].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || Number(b.createdAt) - Number(a.createdAt));
            await kv.set(stateKey, { ...state, noticePosts });
            invalidateProcCache('game-state:frame');
            return { status: 200, body: { ok: true, noticePosts } };
        }, { failClosed: true }), { failClosed: true });
        return res.status(result.status).json(result.body);
    } catch (error) {
        if (error instanceof LockContendedError) return res.status(503).json({ error: 'Village orders are being updated. Please retry.' });
        console.error('[village/orders]', safeLogValue(error));
        return res.status(500).json({ error: 'Unable to update village orders.' });
    }
}

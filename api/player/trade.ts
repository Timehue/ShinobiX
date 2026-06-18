import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { kv } from '../_storage.js';
import { cors, safeName, mergePreservingImages } from '../_utils.js';
import { authedPlayerOrAdmin } from '../_auth.js';
import { enforceRateLimitKv } from '../_ratelimit.js';
import { withKvLock } from '../_lock.js';
import { hasRecentIpOrFpOverlap } from '../_player-ips.js';
import { planTrade, isTradeCurrency } from './_trade-core.js';

/*
 * /api/player/trade — POST (direct player-to-player transfer)
 *
 * One-way taxed SEND. The sender is debited the full amount; the recipient
 * receives amount minus a burned tax (the economy sink). Server-authoritative:
 * balances are read fresh under BOTH save locks (sorted order → no deadlock,
 * both failClosed → currency safety), the split is recomputed from _trade-core,
 * and neither side's amount comes from the client body.
 *
 *   POST { playerName, toPlayer, currency, amount, nonce? }
 *     → { ok, currency, debit, credit, burned, toPlayer }
 *
 * Money safety:
 *   - only ryo / fateShards / boneCharms / auraStones are tradeable (honor seals
 *     are Vanguard-locked, mythic seals are top-rarity — both excluded).
 *   - VOID when sender + recipient share an IP/device (no funnelling to an alt).
 *   - optional client `nonce` makes a retried request idempotent (NX receipt).
 */

const AUDIT_PREFIX = 'audit:player-trade:';
const NONCE_TTL_SECONDS = 24 * 60 * 60;

function num(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    cors(res, req);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).end();

    try {
        const body = (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})) as Record<string, unknown>;
        const playerName = safeName(String(body.playerName ?? ''));
        if (!playerName) return res.status(400).json({ error: 'Missing playerName.' });

        const identity = await authedPlayerOrAdmin(req, playerName);
        if (!identity) return res.status(401).json({ error: 'Authentication required.' });
        if (!identity.admin && identity.name !== playerName) {
            return res.status(403).json({ error: 'You can only act for your own account.' });
        }
        if (!identity.admin && !(await enforceRateLimitKv(req, res, 'player-trade', 20, 60_000, identity.name))) return;

        const currency = String(body.currency ?? '');
        if (!isTradeCurrency(currency)) return res.status(400).json({ error: 'That currency cannot be traded.' });
        const amount = Math.floor(num(body.amount));

        const toRaw = typeof body.toPlayer === 'string' ? body.toPlayer.trim() : '';
        if (!toRaw) return res.status(400).json({ error: 'Choose a player to send to.' });
        const toSlug = safeName(toRaw);
        if (!toSlug) return res.status(400).json({ error: 'Invalid recipient.' });
        if (toSlug === playerName) return res.status(400).json({ error: "You can't send to yourself." });

        const toRec = await kv.get<Record<string, unknown>>(`save:${toSlug}`);
        const toChar = (toRec?.character ?? null) as Record<string, unknown> | null;
        if (!toRec || !toChar) return res.status(404).json({ error: 'That player was not found.' });
        const toDisplay = (toChar.name as string) ?? toRaw;

        // No funnelling currency to an account on your own connection.
        if (!identity.admin) {
            try {
                if (await hasRecentIpOrFpOverlap(playerName, toSlug)) {
                    return res.status(403).json({ error: "You can't send to someone sharing your connection." });
                }
            } catch { /* fail open — a broken anti-cheat check must not block a legit transfer */ }
        }

        // Optional idempotency: a client-supplied nonce makes a retried send a
        // no-op instead of a double-debit. NX-set BEFORE the transfer so a
        // concurrent retry loses the race and returns the harmless duplicate.
        const nonce = typeof body.nonce === 'string' ? body.nonce.slice(0, 64).replace(/[^a-zA-Z0-9_-]/g, '') : '';
        if (nonce) {
            const placed = await kv.set(`trade:nonce:${playerName}:${nonce}`, { ts: Date.now() }, { nx: true, ex: NONCE_TTL_SECONDS } as never);
            if (!placed) return res.status(200).json({ ok: true, duplicate: true });
        }

        const now = Date.now();
        // Lock BOTH saves in a stable (sorted) order so concurrent autosaves /
        // other transfers can't clobber the read-modify-write and two trades in
        // opposite directions can't deadlock.
        const senderKey = `save:${playerName}`;
        const recipientKey = `save:${toSlug}`;
        const [k1, k2] = [senderKey, recipientKey].sort();

        const out = await withKvLock<{ status: number; body: Record<string, unknown> }>(k1, async () =>
            withKvLock<{ status: number; body: Record<string, unknown> }>(k2, async () => {
                const senderRec = await kv.get<Record<string, unknown>>(senderKey);
                const senderChar = (senderRec?.character ?? null) as Record<string, unknown> | null;
                if (!senderRec || !senderChar) return { status: 404, body: { error: 'Your save was not found.' } };
                const recipientRec = await kv.get<Record<string, unknown>>(recipientKey);
                const recipientChar = (recipientRec?.character ?? null) as Record<string, unknown> | null;
                if (!recipientRec || !recipientChar) return { status: 404, body: { error: 'That player was not found.' } };

                const plan = planTrade(currency, amount, num(senderChar[currency]));
                if (!plan.ok) return { status: 400, body: { error: plan.reason } };

                await kv.set(senderKey, mergePreservingImages(
                    { ...senderRec, character: { ...senderChar, [currency]: num(senderChar[currency]) - plan.debit } },
                    senderRec,
                ));
                await kv.set(recipientKey, mergePreservingImages(
                    { ...recipientRec, character: { ...recipientChar, [currency]: num(recipientChar[currency]) + plan.credit } },
                    recipientRec,
                ));
                return { status: 200, body: { ok: true, currency, debit: plan.debit, credit: plan.credit, burned: plan.burned, toPlayer: toDisplay } };
            }, { failClosed: true }),
        { failClosed: true });

        if (out.status === 200) {
            await kv.set(`${AUDIT_PREFIX}${now}`, { ts: now, from: playerName, to: toSlug, currency, debit: out.body.debit, credit: out.body.credit, burned: out.body.burned }, { ex: 30 * 24 * 60 * 60 }).catch(() => undefined);
        }
        return res.status(out.status).json(out.body);
    } catch (err) {
        console.error('[player/trade]', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
}

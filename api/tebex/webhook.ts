import type { VercelRequest, VercelResponse } from '../_vercel.js';
import { clientIp } from '../_client-ip.js';
import { mutatePlayerSave } from '../save/_mutate-player-save.js';
import {
    isReversalWebhook,
    isTebexSourceIp,
    isValidationWebhook,
    parseTebexWebhook,
    shardGrantsForPayment,
    verifyTebexSignature,
} from './_webhook-core.js';

/*
 * POST /api/tebex/webhook — Tebex purchase notifications.
 *
 * This is a currency faucet reached by an unauthenticated public URL, so it is
 * written to be boring and suspicious. Every decision about whether to trust a
 * request, and what a payment is worth, lives in _webhook-core.ts where it is
 * unit-tested; this file does the IO.
 *
 * ⛔ THE SIGNATURE IS OVER THE RAW BYTES. server.ts captures req.rawBody for
 * this one path. Verifying a re-stringified body silently fails, and Tebex's own
 * docs call out Express by name for exactly this.
 *
 * DELIVERY MODEL: Tebex refuses to publish a package with no deliverable unless
 * a validated webhook endpoint exists, so this endpoint IS the delivery
 * mechanism for every shard package. It must be reachable and must answer the
 * validation ping before packages can be created at all.
 *
 * Responses are deliberately 2XX for anything we understood but chose not to
 * act on. Tebex retries non-2XX and eventually marks the endpoint failed, which
 * would take the whole storefront down — a webhook we knowingly ignore is not
 * an error.
 */

const TEBEX_WEBHOOK_SECRET = (): string => String(process.env.TEBEX_WEBHOOK_SECRET ?? '').trim();

/** Receipt ledger on the character — same shape as redeemedNamedForges. */
function receipts(character: Record<string, unknown>): string[] {
    const raw = character.redeemedTebexPurchases;
    return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // No CORS: this is server-to-server. A browser has no business here.
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

    // 1. Source. Tebex publishes exactly two addresses and recommends 404 for
    //    anything else — a 404 leaks less than a 403 about what lives here.
    const ip = clientIp(req as Parameters<typeof clientIp>[0]);
    if (!isTebexSourceIp(ip)) return res.status(404).end();

    // 2. Signature over the raw bytes, fail-closed on an unset secret.
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    const rawText = typeof rawBody === 'string' ? rawBody : Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : '';
    if (!verifyTebexSignature(rawText, req.headers['x-signature'], TEBEX_WEBHOOK_SECRET())) {
        return res.status(403).json({ error: 'Invalid signature.' });
    }

    let payload: unknown;
    try { payload = JSON.parse(rawText); } catch { return res.status(400).json({ error: 'Malformed body.' }); }

    const webhook = parseTebexWebhook(payload);
    if (!webhook) return res.status(400).json({ error: 'Unrecognized webhook.' });

    // 3. The validation ping. Tebex will not deliver anything to an endpoint
    //    that has not echoed this back, so it must be handled before any of the
    //    business logic and must respond with the id verbatim.
    if (isValidationWebhook(webhook)) {
        return res.status(200).json({ id: webhook.id });
    }

    // 4. Reversals are recorded for a human, never auto-clawed back: the shards
    //    may already be spent, and driving a balance negative to reclaim them
    //    breaks more than it fixes.
    if (isReversalWebhook(webhook)) {
        console.warn('[tebex] reversal', webhook.type, JSON.stringify(webhook.subject.transaction_id ?? ''));
        return res.status(200).json({ ok: true, action: 'logged' });
    }

    const outcome = shardGrantsForPayment(webhook);
    if (outcome.action === 'ignore') {
        // Acknowledged on purpose. Retrying this would never succeed.
        return res.status(200).json({ ok: true, action: 'ignored', reason: outcome.reason });
    }

    // 5. Grant, under the save lock, exactly once per Tebex transaction.
    const result = await mutatePlayerSave<{ granted: boolean; shards: number }>(
        outcome.playerName,
        ({ character }) => {
            const ledger = receipts(character as unknown as Record<string, unknown>);
            if (ledger.includes(outcome.transactionId)) {
                // A redelivered webhook. Idempotent by construction: the receipt
                // is written in the same committed save as the shards, so there
                // is no window where one exists without the other.
                return { ok: true as const, character, write: false, value: { granted: false, shards: 0 } };
            }
            const balance = Math.max(0, Math.floor(Number((character as unknown as Record<string, unknown>).fateShards ?? 0)) || 0);
            const next = {
                ...character,
                fateShards: balance + outcome.totalShards,
                redeemedTebexPurchases: [...ledger, outcome.transactionId].slice(-200),
            } as typeof character;
            return { ok: true as const, character: next, value: { granted: true, shards: outcome.totalShards } };
        },
    );

    if (!result.ok) {
        // A real failure — no save, or storage refused. Returning non-2XX asks
        // Tebex to retry, which is what we want: the player has paid.
        console.error('[tebex] grant failed', outcome.transactionId, result.status, result.error);
        return res.status(500).json({ error: 'Grant failed; will retry.' });
    }

    console.log('[tebex] granted', outcome.transactionId, outcome.playerName, result.value.shards, result.value.granted ? 'new' : 'replay');
    // `_saveVersion` is echoed even though the caller is Tebex rather than a
    // player's client, so there is no autosave to reconcile against. It costs
    // nothing, it keeps this route inside the repo-wide rule that a
    // mutatePlayerSave route acknowledges the version it committed, and Tebex's
    // webhook delivery log records response bodies — so a support question
    // about a missing purchase can be answered with the exact save version the
    // shards landed on.
    return res.status(200).json({
        ok: true,
        granted: result.value.granted,
        shards: result.value.shards,
        _saveVersion: result._saveVersion,
    });
}

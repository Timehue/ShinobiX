/*
 * Tebex webhook trust boundary — pure, side-effect free, fully testable.
 *
 * Underscore-prefixed: shared helper, not a route. The HTTP handler lives in
 * api/tebex/webhook.ts and does the storage work; everything that decides
 * WHETHER to trust a payload and WHAT it is worth lives here, so it can be
 * tested without a network, a database, or a running server.
 *
 * This is a currency faucet, so it follows the same rule as every other reward
 * path in this repo: the payload says what happened, WE decide what it is worth.
 * A verified webhook names a Tebex package id; the shard amount is then read
 * from shared/shard-packages.ts, never from any number in the request.
 *
 * THREE INDEPENDENT CHECKS, all fail-closed:
 *  1. Source IP is one of Tebex's two published addresses.
 *  2. `X-Signature` matches an HMAC we recompute from the RAW body.
 *  3. The payload is a completed payment for packages we actually sell.
 *
 * ⛔ THE SIGNATURE IS OVER THE RAW BYTES. Tebex's own docs call this out for
 * Express specifically: a parsed-then-restringified body will not match, because
 * JSON.stringify does not reproduce byte-for-byte what was sent. server.ts must
 * capture the raw Buffer for this one path — the same scoped `express.json({
 * verify })` parser the Patreon rail used to need.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { shardPackageForProvider, type ShardPackage } from '../../shared/shard-packages.js';

/** The only two addresses Tebex sends webhooks from (their docs, 2026-08). */
export const TEBEX_WEBHOOK_IPS: readonly string[] = ['18.209.80.3', '54.87.231.232'];

/** Tebex status ids. 1 is the only one that means "money actually settled". */
export const TEBEX_STATUS_COMPLETE = 1;
export const TEBEX_STATUS_REFUND = 2;
export const TEBEX_STATUS_CHARGEBACK = 3;

/**
 * A hostile or malformed payload should not be able to mint an unbounded
 * amount. Quantity arrives inside a signed body so it is already trusted, but a
 * cap turns a Tebex-side bug or a compromised secret from "unlimited currency"
 * into "at most this much", which is the difference between an incident and a
 * catastrophe.
 */
export const MAX_PACKAGE_QUANTITY = 25;

export interface TebexWebhookEnvelope {
    id: string;
    type: string;
    date: string;
    subject: Record<string, unknown>;
}

/**
 * Recompute the signature Tebex should have sent.
 *
 * Their scheme, which is unusual enough to be worth stating: SHA-256 the raw
 * JSON body to hex, then HMAC-SHA256 *that hex string* using the webhook secret
 * as the key. It is a hash of a hash, not a plain HMAC of the body.
 */
export function tebexExpectedSignature(rawBody: string, secret: string): string {
    const bodyHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');
    return createHmac('sha256', secret).update(bodyHash, 'utf8').digest('hex');
}

/** Constant-time compare that never throws on odd input. */
function safeEquals(a: string, b: string): boolean {
    const left = Buffer.from(a, 'utf8');
    const right = Buffer.from(b, 'utf8');
    if (left.length !== right.length) return false;
    try { return timingSafeEqual(left, right); } catch { return false; }
}

/**
 * Verify `X-Signature`. Fails closed on a missing secret — an unconfigured
 * deployment must reject every webhook rather than accept every webhook.
 */
export function verifyTebexSignature(rawBody: string, headerSignature: unknown, secret: string): boolean {
    if (!secret) return false;
    if (typeof headerSignature !== 'string' || !headerSignature) return false;
    if (typeof rawBody !== 'string' || !rawBody) return false;
    return safeEquals(headerSignature.trim().toLowerCase(), tebexExpectedSignature(rawBody, secret));
}

export function isTebexSourceIp(ip: unknown): boolean {
    return typeof ip === 'string' && TEBEX_WEBHOOK_IPS.includes(ip.trim());
}

/** Shape-check the standard envelope every Tebex webhook shares. */
export function parseTebexWebhook(raw: unknown): TebexWebhookEnvelope | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const value = raw as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id : '';
    const type = typeof value.type === 'string' ? value.type : '';
    if (!id || !type) return null;
    const subject = value.subject && typeof value.subject === 'object' && !Array.isArray(value.subject)
        ? value.subject as Record<string, unknown>
        : {};
    return { id, type, date: typeof value.date === 'string' ? value.date : '', subject };
}

/** A validation ping must be echoed back with its id, or the endpoint never activates. */
export function isValidationWebhook(webhook: TebexWebhookEnvelope): boolean {
    return webhook.type === 'validation.webhook';
}

export interface ShardGrantLine {
    packageId: string;
    shards: number;
    quantity: number;
}

export type PaymentOutcome =
    | { action: 'ignore'; reason: string }
    | {
        action: 'grant';
        transactionId: string;
        playerName: string;
        lines: ShardGrantLine[];
        totalShards: number;
    };

function readUsernameId(source: unknown): string {
    if (!source || typeof source !== 'object') return '';
    const username = (source as { username?: unknown }).username;
    if (!username || typeof username !== 'object') return '';
    const id = (username as { id?: unknown }).id;
    return typeof id === 'string' ? id.trim() : typeof id === 'number' ? String(id) : '';
}

/**
 * Decide what a payment webhook is worth.
 *
 * `lookup` resolves a Tebex package id to our catalogue row; it is injected so
 * this stays pure and so a test can exercise unknown-package handling without
 * touching the real provider map.
 */
export function shardGrantsForPayment(
    webhook: TebexWebhookEnvelope,
    lookup: (providerId: string) => ShardPackage | null = (id) => shardPackageForProvider('tebex', id),
): PaymentOutcome {
    if (webhook.type !== 'payment.completed') {
        return { action: 'ignore', reason: `unhandled-type:${webhook.type}` };
    }
    const subject = webhook.subject;

    // Only a settled payment pays out. Pending Checkout (19) in particular looks
    // like a purchase and is not one yet.
    const status = subject.status as { id?: unknown } | undefined;
    const statusId = typeof status?.id === 'number' ? status.id : -1;
    if (statusId !== TEBEX_STATUS_COMPLETE) {
        return { action: 'ignore', reason: `status-not-complete:${statusId}` };
    }

    const transactionId = typeof subject.transaction_id === 'string' ? subject.transaction_id.trim() : '';
    if (!transactionId) return { action: 'ignore', reason: 'missing-transaction-id' };

    const products = Array.isArray(subject.products) ? subject.products : [];
    if (products.length === 0) return { action: 'ignore', reason: 'no-products' };

    // Identity comes from the ident we bound at basket creation, never from
    // anything the buyer typed. Product-level wins over customer-level because
    // that is where the basket ident lands.
    let playerName = '';
    const lines: ShardGrantLine[] = [];

    for (const entry of products) {
        if (!entry || typeof entry !== 'object') continue;
        const product = entry as Record<string, unknown>;

        const providerId = typeof product.id === 'number' ? String(product.id)
            : typeof product.id === 'string' ? product.id.trim() : '';
        const pack = providerId ? lookup(providerId) : null;
        // A package we do not sell is skipped rather than guessed at. Granting a
        // default would let an unmapped product mint shards.
        if (!pack) continue;

        const rawQuantity = typeof product.quantity === 'number' ? Math.floor(product.quantity) : 1;
        if (!Number.isFinite(rawQuantity) || rawQuantity < 1) continue;
        const quantity = Math.min(rawQuantity, MAX_PACKAGE_QUANTITY);

        playerName = playerName || readUsernameId(product);
        lines.push({ packageId: pack.id, shards: pack.shards * quantity, quantity });
    }

    playerName = playerName || readUsernameId(subject.customer);
    if (!playerName) return { action: 'ignore', reason: 'no-player-identity' };
    if (lines.length === 0) return { action: 'ignore', reason: 'no-known-packages' };

    const totalShards = lines.reduce((sum, line) => sum + line.shards, 0);
    if (totalShards <= 0) return { action: 'ignore', reason: 'zero-value' };

    return { action: 'grant', transactionId, playerName, lines, totalShards };
}

/**
 * Refunds and chargebacks are reported so an operator can act, but this
 * deliberately does NOT auto-revoke shards: they may already be spent, and
 * driving a balance negative to reclaim them breaks more than it fixes. Tebex
 * Seller Protection also means a lost dispute usually leaves the revenue intact,
 * so a reflexive clawback would be wrong as often as it was right.
 */
export function isReversalWebhook(webhook: TebexWebhookEnvelope): boolean {
    return webhook.type === 'payment.refunded'
        || webhook.type === 'payment.dispute.lost'
        || webhook.type === 'payment.dispute.opened';
}

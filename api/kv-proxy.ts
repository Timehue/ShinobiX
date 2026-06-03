/**
 * Internal KV proxy endpoint.
 *
 * Mounted at /api/kv/<op> on the cPanel server. Vercel reaches the disk-backed
 * keys through here. Authenticated via x-kv-token (shared secret env var).
 *
 * Wire format (POST JSON):
 *   /api/kv/get    { key }                       → { value }
 *   /api/kv/set    { key, value, options? }      → { result }
 *   /api/kv/del    { keys: string[] }            → { count }
 *   /api/kv/keys   { pattern }                   → { keys }
 *   /api/kv/mget   { keys: string[] }            → { values }
 *   /api/kv/hset   { key, fields }               → { count }
 *   /api/kv/hdel   { key, fields: string[] }     → { count }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { _diskKvForProxy } from './_storage.js';
import { safeEqual } from './_auth.js';
import { allow } from './_ratelimit.js';

// Brute-force guard: cap FAILED auth attempts per IP. Successful authenticated
// calls are NEVER throttled — this proxy carries legitimate, high-volume
// server-to-server traffic (Vercel → cPanel disk overlay), so we must not
// rate-limit the happy path. Only wrong/missing tokens count against the bucket.
const FAILED_AUTH_MAX = 30;
const FAILED_AUTH_WINDOW_MS = 5 * 60_000;

function proxyClientIp(req: VercelRequest): string {
    const xff = req.headers['x-forwarded-for'];
    const xffStr = Array.isArray(xff) ? xff[0] : xff;
    return xffStr?.split(',')[0]?.trim()
        || req.socket?.remoteAddress
        || 'unknown';
}

// Optional IP allowlist via KV_PROXY_IP_ALLOWLIST (comma-separated). Disabled
// (allow-all) when the env var is unset, so this is a no-op unless an operator
// opts in — auth via the token is always required regardless.
function ipAllowed(ip: string): boolean {
    const raw = process.env.KV_PROXY_IP_ALLOWLIST;
    if (!raw) return true;
    const list = raw.split(',').map(s => s.trim()).filter(Boolean);
    return list.length === 0 || list.includes(ip);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }

    const ip = proxyClientIp(req);

    // Optional operator-configured IP allowlist (off by default).
    if (!ipAllowed(ip)) {
        console.warn(`[kv-proxy] DENIED disallowed IP ${ip} at ${new Date().toISOString()}`);
        res.status(403).json({ error: 'forbidden' });
        return;
    }

    // Accept either KV_PROXY_TOKEN (current) or KV_PROXY_TOKEN_NEXT (during a
    // rotation). Set both during the rotation window, switch callers to NEXT,
    // then drop the old. Avoids the all-or-nothing swap that causes 401 storms.
    const expectedTokens = [process.env.KV_PROXY_TOKEN, process.env.KV_PROXY_TOKEN_NEXT].filter(Boolean) as string[];
    if (expectedTokens.length === 0) {
        res.status(500).json({ error: 'KV_PROXY_TOKEN not configured on server' });
        return;
    }
    const providedRaw = req.headers['x-kv-token'];
    const provided = Array.isArray(providedRaw) ? providedRaw[0] : providedRaw;
    const tokenOk = !!provided && expectedTokens.some((t) => safeEqual(provided, t));
    if (!tokenOk) {
        // Audit + brute-force throttle. Each failure consumes the per-IP bucket;
        // once exhausted, further attempts get 429 instead of 401 so guessing
        // the token is bounded to FAILED_AUTH_MAX tries per window.
        const d = allow(`kvproxy-fail:${ip}`, FAILED_AUTH_MAX, FAILED_AUTH_WINDOW_MS);
        console.warn(`[kv-proxy] DENIED bad/missing token from ${ip} at ${new Date().toISOString()}`);
        if (!d.ok) {
            res.status(429).json({ error: 'too many failed attempts' });
            return;
        }
        res.status(401).json({ error: 'invalid x-kv-token' });
        return;
    }

    if (!_diskKvForProxy) {
        res.status(500).json({ error: 'DISK_KV_DIR not configured on server' });
        return;
    }

    // The server's route helper merges req.params into req.query, so the
    // :op route param shows up as req.query.op. Fall back to URL parsing
    // for the bare Vercel function case (where the file path provides op).
    const opFromQuery = (req.query?.op as string | undefined) ?? '';
    const m = (req.url ?? '').match(/\/kv\/([a-z]+)(?:\?|$|\/)/);
    const op = opFromQuery || m?.[1] || '';
    const body = (req.body ?? {}) as Record<string, unknown>;

    try {
        switch (op) {
            case 'get': {
                const value = await _diskKvForProxy.get(String(body.key));
                res.status(200).json({ value });
                return;
            }
            case 'set': {
                const result = await _diskKvForProxy.set(
                    String(body.key),
                    body.value,
                    body.options as { ex?: number; nx?: boolean } | undefined,
                );
                res.status(200).json({ result });
                return;
            }
            case 'del': {
                const count = await _diskKvForProxy.del(...((body.keys ?? []) as string[]));
                res.status(200).json({ count });
                return;
            }
            case 'keys': {
                const keys = await _diskKvForProxy.keys(String(body.pattern ?? '*'));
                res.status(200).json({ keys });
                return;
            }
            case 'mget': {
                const values = await _diskKvForProxy.mget(...((body.keys ?? []) as string[]));
                res.status(200).json({ values });
                return;
            }
            case 'hset': {
                const count = await _diskKvForProxy.hset(
                    String(body.key),
                    (body.fields ?? {}) as Record<string, unknown>,
                );
                res.status(200).json({ count });
                return;
            }
            case 'hdel': {
                const count = await _diskKvForProxy.hdel(
                    String(body.key),
                    ...((body.fields ?? []) as string[]),
                );
                res.status(200).json({ count });
                return;
            }
            default:
                res.status(404).json({ error: `unknown op: ${op}` });
                return;
        }
    } catch (err) {
        console.error('[kv-proxy] error', op, err);
        res.status(500).json({ error: 'Internal server error.' });
    }
}

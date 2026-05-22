"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = handler;
const _storage_js_1 = require("./_storage.js");
async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'POST only' });
        return;
    }
    const expectedToken = process.env.KV_PROXY_TOKEN;
    if (!expectedToken) {
        res.status(500).json({ error: 'KV_PROXY_TOKEN not configured on server' });
        return;
    }
    const provided = req.headers['x-kv-token'];
    if (provided !== expectedToken) {
        res.status(401).json({ error: 'invalid x-kv-token' });
        return;
    }
    if (!_storage_js_1._diskKvForProxy) {
        res.status(500).json({ error: 'DISK_KV_DIR not configured on server' });
        return;
    }
    // The server's route helper merges req.params into req.query, so the
    // :op route param shows up as req.query.op. Fall back to URL parsing
    // for the bare Vercel function case (where the file path provides op).
    const opFromQuery = req.query?.op ?? '';
    const m = (req.url ?? '').match(/\/kv\/([a-z]+)(?:\?|$|\/)/);
    const op = opFromQuery || m?.[1] || '';
    const body = (req.body ?? {});
    try {
        switch (op) {
            case 'get': {
                const value = await _storage_js_1._diskKvForProxy.get(String(body.key));
                res.status(200).json({ value });
                return;
            }
            case 'set': {
                const result = await _storage_js_1._diskKvForProxy.set(String(body.key), body.value, body.options);
                res.status(200).json({ result });
                return;
            }
            case 'del': {
                const count = await _storage_js_1._diskKvForProxy.del(...(body.keys ?? []));
                res.status(200).json({ count });
                return;
            }
            case 'keys': {
                const keys = await _storage_js_1._diskKvForProxy.keys(String(body.pattern ?? '*'));
                res.status(200).json({ keys });
                return;
            }
            case 'mget': {
                const values = await _storage_js_1._diskKvForProxy.mget(...(body.keys ?? []));
                res.status(200).json({ values });
                return;
            }
            case 'hset': {
                const count = await _storage_js_1._diskKvForProxy.hset(String(body.key), (body.fields ?? {}));
                res.status(200).json({ count });
                return;
            }
            case 'hdel': {
                const count = await _storage_js_1._diskKvForProxy.hdel(String(body.key), ...(body.fields ?? []));
                res.status(200).json({ count });
                return;
            }
            default:
                res.status(404).json({ error: `unknown op: ${op}` });
                return;
        }
    }
    catch (err) {
        console.error('[kv-proxy] error', op, err);
        res.status(500).json({ error: String(err) });
    }
}

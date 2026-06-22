"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stampPlayerIp = stampPlayerIp;
exports.recentIps = recentIps;
exports.recentFps = recentFps;
exports.hasRecentIpOverlap = hasRecentIpOverlap;
exports.hasRecentIpOrFpOverlap = hasRecentIpOrFpOverlap;
const _storage_js_1 = require("./_storage.js");
const _utils_js_1 = require("./_utils.js");
const _client_ip_js_1 = require("./_client-ip.js");
// Per-player recent-IP / fingerprint tracking. Stamps two keys with 7-day TTL
// whenever a player is observed: `player-ip:{name}:{ip}` and
// `player-fp:{name}:{fp}`. Lets us cheaply detect alt-account farming.
//
// IP-only is bypassable with a VPN. Fingerprint-only is bypassable by clearing
// localStorage / using incognito. Together they require BOTH evasions, which
// raises the cost of farming meaningfully.
const TTL_SECONDS = 7 * 24 * 60 * 60;
function ipKey(name, ip) {
    return `player-ip:${(0, _utils_js_1.safeName)(name)}:${ip}`;
}
function fpKey(name, fp) {
    return `player-fp:${(0, _utils_js_1.safeName)(name)}:${fp}`;
}
// Cloudflare-aware client IP (honors CF-Connecting-IP behind Cloudflare, else
// falls back to the XFF/socket chain). See `api/_client-ip.ts`.
function extractIp(req) {
    return (0, _client_ip_js_1.clientIp)(req);
}
function extractFp(req) {
    const v = req.headers['x-client-fp'];
    const s = Array.isArray(v) ? v[0] : v;
    if (!s)
        return null;
    if (!/^([0-9a-f]{32}|[0-9a-f]{64})$/.test(s))
        return null;
    return s;
}
// Record this request's IP for the given player (idempotent — refreshes TTL).
// Best-effort; failures are swallowed so we never break the calling endpoint.
async function stampPlayerIp(req, name) {
    try {
        const ip = extractIp(req);
        const fp = extractFp(req);
        await Promise.all([
            ip ? _storage_js_1.kv.set(ipKey(name, ip), 1, { ex: TTL_SECONDS }) : Promise.resolve(),
            fp ? _storage_js_1.kv.set(fpKey(name, fp), 1, { ex: TTL_SECONDS }) : Promise.resolve(),
        ]);
    }
    catch { /* ignore */ }
}
// List the IPs we've recently seen for a player.
async function recentIps(name) {
    try {
        const keys = await _storage_js_1.kv.keys(`player-ip:${(0, _utils_js_1.safeName)(name)}:*`);
        const prefix = `player-ip:${(0, _utils_js_1.safeName)(name)}:`;
        return keys.map(k => k.slice(prefix.length)).filter(Boolean);
    }
    catch {
        return [];
    }
}
async function recentFps(name) {
    try {
        const keys = await _storage_js_1.kv.keys(`player-fp:${(0, _utils_js_1.safeName)(name)}:*`);
        const prefix = `player-fp:${(0, _utils_js_1.safeName)(name)}:`;
        return keys.map(k => k.slice(prefix.length)).filter(Boolean);
    }
    catch {
        return [];
    }
}
// True if the two players share at least one IP within the 7-day window.
async function hasRecentIpOverlap(nameA, nameB) {
    const [a, b] = await Promise.all([recentIps(nameA), recentIps(nameB)]);
    if (a.length === 0 || b.length === 0)
        return false;
    const setB = new Set(b);
    return a.some(ip => setB.has(ip));
}
// True if the two players share an IP OR a browser fingerprint within 7 days.
// Used by anti-alt checks where either signal indicates alt farming.
async function hasRecentIpOrFpOverlap(nameA, nameB) {
    const [ipsA, ipsB, fpsA, fpsB] = await Promise.all([
        recentIps(nameA), recentIps(nameB), recentFps(nameA), recentFps(nameB),
    ]);
    if (ipsA.length > 0 && ipsB.length > 0) {
        const setB = new Set(ipsB);
        if (ipsA.some((ip) => setB.has(ip)))
            return true;
    }
    if (fpsA.length > 0 && fpsB.length > 0) {
        const setB = new Set(fpsB);
        if (fpsA.some((fp) => setB.has(fp)))
            return true;
    }
    return false;
}

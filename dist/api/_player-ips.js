"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stampPlayerIp = stampPlayerIp;
exports.recentIps = recentIps;
exports.hasRecentIpOverlap = hasRecentIpOverlap;
const _storage_js_1 = require("./_storage.js");
// Per-player recent-IP tracking. Stamps `player-ip:{name}:{ip}` with a 7-day
// TTL whenever a player is observed from a given IP. Lets us cheaply detect
// alt-account farming (same IP used by attacker and target within 7 days).
const TTL_SECONDS = 7 * 24 * 60 * 60;
function ipKey(name, ip) {
    return `player-ip:${name.toLowerCase()}:${ip}`;
}
function extractIp(req) {
    const xff = req.headers['x-forwarded-for'];
    const xffStr = Array.isArray(xff) ? xff[0] : xff;
    const ip = xffStr?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress;
    return ip || null;
}
// Record this request's IP for the given player (idempotent — refreshes TTL).
// Best-effort; failures are swallowed so we never break the calling endpoint.
async function stampPlayerIp(req, name) {
    try {
        const ip = extractIp(req);
        if (!ip)
            return;
        await _storage_js_1.kv.set(ipKey(name, ip), 1, { ex: TTL_SECONDS });
    }
    catch { /* ignore */ }
}
// List the IPs we've recently seen for a player.
async function recentIps(name) {
    try {
        const keys = await _storage_js_1.kv.keys(`player-ip:${name.toLowerCase()}:*`);
        const prefix = `player-ip:${name.toLowerCase()}:`;
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

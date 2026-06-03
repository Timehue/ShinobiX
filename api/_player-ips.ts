import { kv } from './_storage.js';

// Per-player recent-IP / fingerprint tracking. Stamps two keys with 7-day TTL
// whenever a player is observed: `player-ip:{name}:{ip}` and
// `player-fp:{name}:{fp}`. Lets us cheaply detect alt-account farming.
//
// IP-only is bypassable with a VPN. Fingerprint-only is bypassable by clearing
// localStorage / using incognito. Together they require BOTH evasions, which
// raises the cost of farming meaningfully.

const TTL_SECONDS = 7 * 24 * 60 * 60;

function ipKey(name: string, ip: string): string {
    return `player-ip:${name.toLowerCase()}:${ip}`;
}
function fpKey(name: string, fp: string): string {
    return `player-fp:${name.toLowerCase()}:${fp}`;
}

function extractIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }): string | null {
    const xff = req.headers['x-forwarded-for'];
    const xffStr = Array.isArray(xff) ? xff[0] : xff;
    const ip = xffStr?.split(',')[0]?.trim() || req.ip || req.socket?.remoteAddress;
    return ip || null;
}

function extractFp(req: { headers: Record<string, string | string[] | undefined> }): string | null {
    const v = req.headers['x-client-fp'];
    const s = Array.isArray(v) ? v[0] : v;
    if (!s) return null;
    if (!/^([0-9a-f]{32}|[0-9a-f]{64})$/.test(s)) return null;
    return s;
}

// Record this request's IP for the given player (idempotent — refreshes TTL).
// Best-effort; failures are swallowed so we never break the calling endpoint.
export async function stampPlayerIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }, name: string): Promise<void> {
    try {
        const ip = extractIp(req);
        const fp = extractFp(req);
        await Promise.all([
            ip ? kv.set(ipKey(name, ip), 1, { ex: TTL_SECONDS }) : Promise.resolve(),
            fp ? kv.set(fpKey(name, fp), 1, { ex: TTL_SECONDS }) : Promise.resolve(),
        ]);
    } catch { /* ignore */ }
}

// List the IPs we've recently seen for a player.
export async function recentIps(name: string): Promise<string[]> {
    try {
        const keys = await kv.keys(`player-ip:${name.toLowerCase()}:*`);
        const prefix = `player-ip:${name.toLowerCase()}:`;
        return keys.map(k => k.slice(prefix.length)).filter(Boolean);
    } catch {
        return [];
    }
}

export async function recentFps(name: string): Promise<string[]> {
    try {
        const keys = await kv.keys(`player-fp:${name.toLowerCase()}:*`);
        const prefix = `player-fp:${name.toLowerCase()}:`;
        return keys.map(k => k.slice(prefix.length)).filter(Boolean);
    } catch {
        return [];
    }
}

// True if the two players share at least one IP within the 7-day window.
export async function hasRecentIpOverlap(nameA: string, nameB: string): Promise<boolean> {
    const [a, b] = await Promise.all([recentIps(nameA), recentIps(nameB)]);
    if (a.length === 0 || b.length === 0) return false;
    const setB = new Set(b);
    return a.some(ip => setB.has(ip));
}

// True if the two players share an IP OR a browser fingerprint within 7 days.
// Used by anti-alt checks where either signal indicates alt farming.
export async function hasRecentIpOrFpOverlap(nameA: string, nameB: string): Promise<boolean> {
    const [ipsA, ipsB, fpsA, fpsB] = await Promise.all([
        recentIps(nameA), recentIps(nameB), recentFps(nameA), recentFps(nameB),
    ]);
    if (ipsA.length > 0 && ipsB.length > 0) {
        const setB = new Set(ipsB);
        if (ipsA.some((ip) => setB.has(ip))) return true;
    }
    if (fpsA.length > 0 && fpsB.length > 0) {
        const setB = new Set(fpsB);
        if (fpsA.some((fp) => setB.has(fp))) return true;
    }
    return false;
}

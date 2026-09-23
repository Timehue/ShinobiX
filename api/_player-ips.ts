import { kv, type KvLike } from './_storage.js';
import { safeName } from './_utils.js';
import { isPublicVisitorIp, trustedVisitorIp } from './_client-ip.js';

// Per-player recent-IP / fingerprint tracking. Stamps two keys with 7-day TTL
// whenever a player is observed: `player-ip:{name}:v2:{trusted-ip}` and
// `player-fp:{name}:{fp}`. Lets us cheaply detect alt-account farming.
//
// IP-only is bypassable with a VPN. Fingerprint-only is bypassable by clearing
// localStorage / using incognito. Together they require BOTH evasions, which
// raises the cost of farming meaningfully.

const TTL_SECONDS = 7 * 24 * 60 * 60;

// Re-stamp throttle. The heartbeat fires ~once/second per online player and used
// to write BOTH the ip and fp keys every beat purely to refresh a 7-day TTL — a
// steady write flood on the hottest endpoint for zero anti-alt benefit. The keys
// only need to EXIST within the 7-day window; refreshing at most once per this
// interval is functionally identical for detection (5 min << 7 days). Anti-alt
// semantics are unchanged: a NEW (player, ip/fp) pair always writes on first
// sight (memo miss), and a process restart clears the memo → the next beat
// re-stamps (strictly more writes, never fewer). This memo NEVER decides what is
// recorded, only how often an already-recorded pair is re-touched.
const RESTAMP_INTERVAL_MS = Number(process.env.PLAYER_IP_RESTAMP_MS ?? 5 * 60_000);
const _lastStampedAt = new Map<string, number>();

// Return true (and record the stamp) if this key hasn't been written within the
// throttle window; false if it was and the write can be skipped. Opportunistic
// prune keeps the map bounded to roughly (online players × recent ips/fps).
// Exported for deterministic unit testing (time is injected via `now`).
export function _shouldStamp(memoKey: string, now: number): boolean {
    const last = _lastStampedAt.get(memoKey);
    if (last !== undefined && now - last < RESTAMP_INTERVAL_MS) return false;
    _lastStampedAt.set(memoKey, now);
    if (_lastStampedAt.size > 5000) {
        for (const [k, t] of _lastStampedAt) {
            if (now - t >= RESTAMP_INTERVAL_MS * 2) _lastStampedAt.delete(k);
        }
    }
    return true;
}

// Test-only: reset the in-process throttle memo.
export function _resetPlayerIpStampMemo(): void {
    _lastStampedAt.clear();
}

function ipKey(name: string, ip: string): string {
    // Ignore legacy player-ip keys: some contain a Railway proxy's public IP.
    return `player-ip:${safeName(name)}:v2:${ip}`;
}
function fpKey(name: string, fp: string): string {
    return `player-fp:${safeName(name)}:${fp}`;
}

// Only a verified visitor address is usable as anti-alt evidence. See
// `api/_client-ip.ts` for the Railway and Cloudflare trust boundaries.
function extractIp(req: { headers: Record<string, string | string[] | undefined>; ip?: string; socket?: { remoteAddress?: string } }): string | null {
    return trustedVisitorIp(req);
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
        const now = Date.now();
        // Only issue the write when this pair hasn't been stamped within the
        // throttle window (see _shouldStamp). A new ip/fp still writes immediately.
        const writes: Promise<unknown>[] = [];
        if (ip && _shouldStamp(ipKey(name, ip), now)) writes.push(kv.set(ipKey(name, ip), 1, { ex: TTL_SECONDS }));
        if (fp && _shouldStamp(fpKey(name, fp), now)) writes.push(kv.set(fpKey(name, fp), 1, { ex: TTL_SECONDS }));
        if (writes.length) await Promise.all(writes);
    } catch { /* ignore */ }
}

// List the IPs we've recently seen for a player.
export async function recentIps(name: string, store: Pick<KvLike, 'keys'> = kv): Promise<string[]> {
    try {
        const keys = await store.keys(`player-ip:${safeName(name)}:v2:*`);
        const prefix = `player-ip:${safeName(name)}:v2:`;
        return keys.map(k => k.slice(prefix.length)).filter(Boolean);
    } catch {
        return [];
    }
}

export async function recentFps(name: string, store: Pick<KvLike, 'keys'> = kv): Promise<string[]> {
    try {
        const keys = await store.keys(`player-fp:${safeName(name)}:*`);
        const prefix = `player-fp:${safeName(name)}:`;
        return keys.map(k => k.slice(prefix.length)).filter(Boolean);
    } catch {
        return [];
    }
}

// True if the two players share at least one IP within the 7-day window.
export async function hasRecentIpOverlap(nameA: string, nameB: string, store: Pick<KvLike, 'keys'> = kv): Promise<boolean> {
    const [a, b] = await Promise.all([recentIps(nameA, store), recentIps(nameB, store)]);
    if (a.length === 0 || b.length === 0) return false;
    const setB = new Set(b);
    return a.some(ip => setB.has(ip));
}

// True if the two players share an IP OR a browser fingerprint within 7 days.
// Used by anti-alt checks where either signal indicates alt farming.
export async function hasRecentIpOrFpOverlap(nameA: string, nameB: string, store: Pick<KvLike, 'keys'> = kv): Promise<boolean> {
    const [ipsA, ipsB, fpsA, fpsB] = await Promise.all([
        recentIps(nameA, store), recentIps(nameB, store), recentFps(nameA, store), recentFps(nameB, store),
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

/** Fail-closed evidence lookup for Player Ranked V2 settlement. */
export async function hasRecentIpOrFpOverlapStrict(
    nameA: string,
    nameB: string,
    store: Pick<KvLike, 'keys'> = kv,
): Promise<boolean> {
    const a = safeName(nameA);
    const b = safeName(nameB);
    const [ipKeysA, ipKeysB, fpKeysA, fpKeysB] = await Promise.all([
        store.keys(`player-ip:${a}:v2:*`),
        store.keys(`player-ip:${b}:v2:*`),
        store.keys(`player-fp:${a}:*`),
        store.keys(`player-fp:${b}:*`),
    ]);
    const suffixes = (keys: string[], prefix: string) => keys
        .map((key) => key.slice(prefix.length))
        .filter(Boolean);
    const overlaps = (left: string[], right: string[]) => {
        const rightSet = new Set(right);
        return left.some((value) => rightSet.has(value));
    };
    return overlaps(
        suffixes(ipKeysA, `player-ip:${a}:v2:`).filter(isPublicVisitorIp),
        suffixes(ipKeysB, `player-ip:${b}:v2:`).filter(isPublicVisitorIp),
    )
        || overlaps(suffixes(fpKeysA, `player-fp:${a}:`), suffixes(fpKeysB, `player-fp:${b}:`));
}

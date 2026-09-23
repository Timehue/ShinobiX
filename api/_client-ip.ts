/**
 * Cloudflare-aware client IP extraction (shared by all player-facing IP sites).
 *
 * The app runs behind Cloudflare → (Railway | cPanel/Passenger). Cloudflare
 * puts the visitor in `CF-Connecting-IP`; Railway also provides a trusted
 * `X-Real-IP` for the visitor. An X-Forwarded-For hop can be a public proxy
 * address and must not become evidence that unrelated players share a network.
 *
 * Trust model: on Railway, use its edge-owned `X-Real-IP`; it validates the
 * Cloudflare connection before replacing that header with the visitor's IP.
 * Elsewhere, `CF-Connecting-IP` is only honored when the immediate peer or
 * proxy-facing XFF hop is within Cloudflare's published ranges. Direct-origin
 * callers cannot establish identity by adding a Cloudflare-looking XFF hop.
 *
 * NOTE: the fully robust mitigation against direct-to-origin spoofing is an
 * infra one — restrict the origin to Cloudflare (Authenticated Origin Pulls or
 * a firewall allowlist of Cloudflare IPs). This helper is the best the app
 * layer can do, and it is a strict improvement over recording a proxy IP.
 *
 * Cloudflare ranges below are from https://www.cloudflare.com/ips-v4 and
 * https://www.cloudflare.com/ips-v6 (fetched 2026-06-22). They change very
 * rarely; refresh from those URLs if Cloudflare ever publishes new ranges.
 */

export type IpRequestLike = {
    headers: Record<string, string | string[] | undefined>;
    ip?: string;
    socket?: { remoteAddress?: string };
};

const CLOUDFLARE_CIDRS_V4 = [
    '173.245.48.0/20',
    '103.21.244.0/22',
    '103.22.200.0/22',
    '103.31.4.0/22',
    '141.101.64.0/18',
    '108.162.192.0/18',
    '190.93.240.0/20',
    '188.114.96.0/20',
    '197.234.240.0/22',
    '198.41.128.0/17',
    '162.158.0.0/15',
    '104.16.0.0/13',
    '104.24.0.0/14',
    '172.64.0.0/13',
    '131.0.72.0/22',
] as const;

const CLOUDFLARE_CIDRS_V6 = [
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32',
] as const;

type ParsedIp = { version: 4 | 6; value: bigint };
type ParsedCidr = { base: bigint; mask: bigint; version: 4 | 6 };

/** Normalize a raw IP token: trim, drop IPv6 brackets/zone, unwrap v4-mapped v6. */
function normalizeIp(raw: string): string {
    let ip = raw.trim();
    if (!ip) return '';
    // [::1]:443 / [2606:4700::1] → strip brackets (and any trailing :port).
    if (ip.startsWith('[')) {
        const end = ip.indexOf(']');
        if (end !== -1) ip = ip.slice(1, end);
    }
    // IPv4 with port (1.2.3.4:5678) → drop the port. (IPv6 has many colons.)
    if (ip.indexOf('.') !== -1 && ip.indexOf(':') !== -1 && ip.split(':').length === 2) {
        ip = ip.slice(0, ip.indexOf(':'));
    }
    // IPv6 zone id (fe80::1%eth0) → drop it.
    const pct = ip.indexOf('%');
    if (pct !== -1) ip = ip.slice(0, pct);
    ip = ip.toLowerCase();
    // IPv4-mapped IPv6 (::ffff:1.2.3.4) → bare IPv4.
    const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) ip = mapped[1];
    return ip;
}

function parseIpv4(ip: string): bigint | null {
    const parts = ip.split('.');
    if (parts.length !== 4) return null;
    let value = 0n;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const n = Number(part);
        if (n > 255) return null;
        value = (value << 8n) | BigInt(n);
    }
    return value;
}

function parseIpv6(ip: string): bigint | null {
    if (ip.indexOf(':') === -1) return null;
    let head = ip;
    let tailV4 = 0n;
    let v4Hextets = 0;
    // Trailing embedded IPv4 (e.g. ::ffff:1.2.3.4 after normalization is rare,
    // but 64:ff9b::1.2.3.4 is valid) — convert it to two hextets.
    const lastColon = head.lastIndexOf(':');
    const maybeV4 = head.slice(lastColon + 1);
    if (maybeV4.indexOf('.') !== -1) {
        const v4 = parseIpv4(maybeV4);
        if (v4 === null) return null;
        tailV4 = v4;
        v4Hextets = 2;
        head = head.slice(0, lastColon + 1);
        if (head.endsWith(':') && !head.endsWith('::')) head = head.slice(0, -1);
    }

    const halves = head.split('::');
    if (halves.length > 2) return null;
    const toHextets = (s: string): number[] | null => {
        if (s === '') return [];
        const out: number[] = [];
        for (const g of s.split(':')) {
            if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
            out.push(parseInt(g, 16));
        }
        return out;
    };
    const left = toHextets(halves[0]);
    const right = halves.length === 2 ? toHextets(halves[1]) : [];
    if (left === null || right === null) return null;

    const total = left.length + right.length + v4Hextets;
    let groups: number[];
    if (halves.length === 2) {
        if (total > 7) return null; // '::' must stand for >=1 zero group
        groups = [...left, ...Array(8 - total).fill(0), ...right];
    } else {
        if (total !== 8) return null;
        groups = [...left, ...right];
    }

    let value = 0n;
    for (const g of groups.slice(0, 8 - v4Hextets)) value = (value << 16n) | BigInt(g);
    if (v4Hextets) value = (value << 32n) | tailV4;
    return value;
}

function parseIp(raw: string): ParsedIp | null {
    const ip = normalizeIp(raw);
    if (!ip) return null;
    if (ip.indexOf(':') !== -1) {
        const v6 = parseIpv6(ip);
        return v6 === null ? null : { version: 6, value: v6 };
    }
    const v4 = parseIpv4(ip);
    return v4 === null ? null : { version: 4, value: v4 };
}

function parseCidr(cidr: string): ParsedCidr | null {
    const [addr, prefixStr] = cidr.split('/');
    const parsed = parseIp(addr);
    if (!parsed) return null;
    const bits = parsed.version === 4 ? 32 : 128;
    const prefix = Number(prefixStr);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) return null;
    const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
    return { base: parsed.value & mask, mask, version: parsed.version };
}

const CF_RANGES: ParsedCidr[] = [...CLOUDFLARE_CIDRS_V4, ...CLOUDFLARE_CIDRS_V6]
    .map(parseCidr)
    .filter((c): c is ParsedCidr => c !== null);

const NON_VISITOR_RANGES: ParsedCidr[] = [
    '0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
    '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
    '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4',
    '::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8',
].map(parseCidr).filter((c): c is ParsedCidr => c !== null);

/** True if `raw` parses to an address inside any Cloudflare published range. */
export function isCloudflareIp(raw: string): boolean {
    const ip = parseIp(raw);
    if (!ip) return false;
    for (const range of CF_RANGES) {
        if (range.version === ip.version && (ip.value & range.mask) === range.base) return true;
    }
    return false;
}

/** Proxy and private addresses are not evidence that two ranked players share a connection. */
export function isPublicVisitorIp(raw: string): boolean {
    const ip = parseIp(raw);
    if (!ip || isCloudflareIp(raw)) return false;
    return !NON_VISITOR_RANGES.some(range => range.version === ip.version && (ip.value & range.mask) === range.base);
}

function firstHeader(req: IpRequestLike, name: string): string | undefined {
    const raw = req.headers[name];
    return Array.isArray(raw) ? raw[0] : raw;
}

type IpPlatform = 'railway' | 'other';

function ipPlatform(): IpPlatform {
    return process.env.RAILWAY_SERVICE_ID || process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_ENVIRONMENT
        ? 'railway' : 'other';
}

function railwayRealIp(req: IpRequestLike): string | null {
    // Railway replaces X-Real-IP at its edge with the connecting visitor's IP,
    // including when the request came through Cloudflare. A public Railway hop
    // can be the rightmost XFF entry, so XFF is not ranked identity evidence.
    const raw = req.headers['x-real-ip'];
    if (typeof raw !== 'string' || !parseIp(raw)) return null;
    return normalizeIp(raw);
}

function forwardedIps(req: IpRequestLike): string[] {
    const xff = firstHeader(req, 'x-forwarded-for');
    if (!xff) return [];
    return xff.split(',').map((h) => h.trim()).filter((h) => Boolean(h) && parseIp(h) !== null);
}

/** True only when the proxy-facing verified hop is a Cloudflare edge. */
export function requestTransitedCloudflare(req: IpRequestLike): boolean {
    if (req.socket?.remoteAddress && isCloudflareIp(req.socket.remoteAddress)) return true;
    const forwarded = forwardedIps(req);
    return forwarded.length > 0 && isCloudflareIp(forwarded[forwarded.length - 1]);
}

/**
 * Resolve the client IP for logging, moderation, and rate limiting.
 *
 * Railway's edge-owned `X-Real-IP` takes precedence there. Elsewhere, honor
 * `CF-Connecting-IP` when Cloudflare transit is verified, then use the
 * proxy-facing XFF hop or socket. Anti-alt stamps require the stricter
 * `trustedVisitorIp()` function below.
 */
export function clientIp(req: IpRequestLike, platform: IpPlatform = ipPlatform()): string | null {
    if (platform === 'railway') {
        const realIp = railwayRealIp(req);
        if (realIp) return realIp;
    }
    const cf = firstHeader(req, 'cf-connecting-ip');
    if (cf && cf.trim() && parseIp(cf) && requestTransitedCloudflare(req)) {
        return normalizeIp(cf);
    }

    const forwarded = forwardedIps(req);
    if (forwarded.length > 0) return normalizeIp(forwarded[forwarded.length - 1]);

    const fallback = req.ip || req.socket?.remoteAddress;
    return fallback ? fallback.trim() : null;
}

/** IP suitable for anti-alt evidence only when its provenance is trusted. */
export function trustedVisitorIp(req: IpRequestLike, platform: IpPlatform = ipPlatform()): string | null {
    if (platform === 'railway') {
        const realIp = railwayRealIp(req);
        return realIp && isPublicVisitorIp(realIp) ? realIp : null;
    }

    const cf = firstHeader(req, 'cf-connecting-ip');
    if (cf && parseIp(cf) && requestTransitedCloudflare(req)) {
        const visitor = normalizeIp(cf);
        return isPublicVisitorIp(visitor) ? visitor : null;
    }

    // With no proxy, the TCP peer is the only non-spoofable address available.
    const peer = req.socket?.remoteAddress;
    return peer && isPublicVisitorIp(peer) ? normalizeIp(peer) : null;
}

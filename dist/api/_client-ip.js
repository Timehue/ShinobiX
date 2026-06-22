"use strict";
/**
 * Cloudflare-aware client IP extraction (shared by all player-facing IP sites).
 *
 * The app runs behind Cloudflare → (Railway | cPanel/Passenger). On that path
 * the request's *immediate* peer and the left-most `X-Forwarded-For` hop are a
 * Cloudflare edge IP (e.g. 162.158.x.x), NOT the visitor. Cloudflare puts the
 * real visitor in the `CF-Connecting-IP` header. The naive `xff.split(',')[0]`
 * therefore records Cloudflare PoPs instead of players, which makes IP-based
 * anti-cheat (alt-account / ban-evasion detection, IP rate-limit fallback)
 * group unrelated players by data center. See `clientIp()` below.
 *
 * Trust model: `CF-Connecting-IP` is only honored when we can corroborate that
 * the request actually transited Cloudflare — i.e. the immediate peer or some
 * `X-Forwarded-For` hop is within Cloudflare's published ranges. If a request
 * reaches the origin *directly* (local dev, or a direct-to-origin hit that
 * bypasses Cloudflare) the header is ignored and we fall back to the previous
 * XFF/socket logic. This keeps a direct-to-origin caller from spoofing an
 * arbitrary IP via a forged `CF-Connecting-IP` alone.
 *
 * NOTE: the fully robust mitigation against direct-to-origin spoofing is an
 * infra one — restrict the origin to Cloudflare (Authenticated Origin Pulls or
 * a firewall allowlist of Cloudflare IPs). This helper is the best the app
 * layer can do, and it is a strict improvement over recording the edge IP.
 *
 * Cloudflare ranges below are from https://www.cloudflare.com/ips-v4 and
 * https://www.cloudflare.com/ips-v6 (fetched 2026-06-22). They change very
 * rarely; refresh from those URLs if Cloudflare ever publishes new ranges.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCloudflareIp = isCloudflareIp;
exports.requestTransitedCloudflare = requestTransitedCloudflare;
exports.clientIp = clientIp;
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
];
const CLOUDFLARE_CIDRS_V6 = [
    '2400:cb00::/32',
    '2606:4700::/32',
    '2803:f800::/32',
    '2405:b500::/32',
    '2405:8100::/32',
    '2a06:98c0::/29',
    '2c0f:f248::/32',
];
/** Normalize a raw IP token: trim, drop IPv6 brackets/zone, unwrap v4-mapped v6. */
function normalizeIp(raw) {
    let ip = raw.trim();
    if (!ip)
        return '';
    // [::1]:443 / [2606:4700::1] → strip brackets (and any trailing :port).
    if (ip.startsWith('[')) {
        const end = ip.indexOf(']');
        if (end !== -1)
            ip = ip.slice(1, end);
    }
    // IPv4 with port (1.2.3.4:5678) → drop the port. (IPv6 has many colons.)
    if (ip.indexOf('.') !== -1 && ip.indexOf(':') !== -1 && ip.split(':').length === 2) {
        ip = ip.slice(0, ip.indexOf(':'));
    }
    // IPv6 zone id (fe80::1%eth0) → drop it.
    const pct = ip.indexOf('%');
    if (pct !== -1)
        ip = ip.slice(0, pct);
    ip = ip.toLowerCase();
    // IPv4-mapped IPv6 (::ffff:1.2.3.4) → bare IPv4.
    const mapped = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped)
        ip = mapped[1];
    return ip;
}
function parseIpv4(ip) {
    const parts = ip.split('.');
    if (parts.length !== 4)
        return null;
    let value = 0n;
    for (const part of parts) {
        if (!/^\d{1,3}$/.test(part))
            return null;
        const n = Number(part);
        if (n > 255)
            return null;
        value = (value << 8n) | BigInt(n);
    }
    return value;
}
function parseIpv6(ip) {
    if (ip.indexOf(':') === -1)
        return null;
    let head = ip;
    let tailV4 = 0n;
    let v4Hextets = 0;
    // Trailing embedded IPv4 (e.g. ::ffff:1.2.3.4 after normalization is rare,
    // but 64:ff9b::1.2.3.4 is valid) — convert it to two hextets.
    const lastColon = head.lastIndexOf(':');
    const maybeV4 = head.slice(lastColon + 1);
    if (maybeV4.indexOf('.') !== -1) {
        const v4 = parseIpv4(maybeV4);
        if (v4 === null)
            return null;
        tailV4 = v4;
        v4Hextets = 2;
        head = head.slice(0, lastColon + 1);
        if (head.endsWith(':') && !head.endsWith('::'))
            head = head.slice(0, -1);
    }
    const halves = head.split('::');
    if (halves.length > 2)
        return null;
    const toHextets = (s) => {
        if (s === '')
            return [];
        const out = [];
        for (const g of s.split(':')) {
            if (!/^[0-9a-f]{1,4}$/.test(g))
                return null;
            out.push(parseInt(g, 16));
        }
        return out;
    };
    const left = toHextets(halves[0]);
    const right = halves.length === 2 ? toHextets(halves[1]) : [];
    if (left === null || right === null)
        return null;
    const total = left.length + right.length + v4Hextets;
    let groups;
    if (halves.length === 2) {
        if (total > 7)
            return null; // '::' must stand for >=1 zero group
        groups = [...left, ...Array(8 - total).fill(0), ...right];
    }
    else {
        if (total !== 8)
            return null;
        groups = [...left, ...right];
    }
    let value = 0n;
    for (const g of groups.slice(0, 8 - v4Hextets))
        value = (value << 16n) | BigInt(g);
    if (v4Hextets)
        value = (value << 32n) | tailV4;
    return value;
}
function parseIp(raw) {
    const ip = normalizeIp(raw);
    if (!ip)
        return null;
    if (ip.indexOf(':') !== -1) {
        const v6 = parseIpv6(ip);
        return v6 === null ? null : { version: 6, value: v6 };
    }
    const v4 = parseIpv4(ip);
    return v4 === null ? null : { version: 4, value: v4 };
}
function parseCidr(cidr) {
    const [addr, prefixStr] = cidr.split('/');
    const parsed = parseIp(addr);
    if (!parsed)
        return null;
    const bits = parsed.version === 4 ? 32 : 128;
    const prefix = Number(prefixStr);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits)
        return null;
    const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
    return { base: parsed.value & mask, mask, version: parsed.version };
}
const CF_RANGES = [...CLOUDFLARE_CIDRS_V4, ...CLOUDFLARE_CIDRS_V6]
    .map(parseCidr)
    .filter((c) => c !== null);
/** True if `raw` parses to an address inside any Cloudflare published range. */
function isCloudflareIp(raw) {
    const ip = parseIp(raw);
    if (!ip)
        return false;
    for (const range of CF_RANGES) {
        if (range.version === ip.version && (ip.value & range.mask) === range.base)
            return true;
    }
    return false;
}
function firstHeader(req, name) {
    const raw = req.headers[name];
    return Array.isArray(raw) ? raw[0] : raw;
}
/** Every IP we saw on the wire: the immediate peer plus each XFF hop. */
function requestHopIps(req) {
    const hops = [];
    const xff = firstHeader(req, 'x-forwarded-for');
    if (xff)
        for (const h of xff.split(','))
            if (h.trim())
                hops.push(h.trim());
    if (req.socket?.remoteAddress)
        hops.push(req.socket.remoteAddress);
    return hops;
}
/** True if any hop is a Cloudflare edge IP — i.e. the request transited Cloudflare. */
function requestTransitedCloudflare(req) {
    return requestHopIps(req).some(isCloudflareIp);
}
/**
 * Resolve the real client IP for a request.
 *
 * Honors `CF-Connecting-IP` when the request demonstrably came through
 * Cloudflare; otherwise falls back to the first `X-Forwarded-For` hop, then
 * `x-real-ip`, then `req.ip` / the socket peer. Returns null if nothing usable
 * is present.
 */
function clientIp(req) {
    const cf = firstHeader(req, 'cf-connecting-ip');
    if (cf && cf.trim() && parseIp(cf) && requestTransitedCloudflare(req)) {
        return normalizeIp(cf);
    }
    const xff = firstHeader(req, 'x-forwarded-for');
    const fromXff = xff?.split(',')[0]?.trim();
    if (fromXff)
        return fromXff;
    const real = firstHeader(req, 'x-real-ip');
    if (real && real.trim())
        return real.trim();
    const fallback = req.ip || req.socket?.remoteAddress;
    return fallback ? fallback.trim() : null;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_LEGACY_DUPLICATE_HOSTS = exports.DEFAULT_CANONICAL_ORIGIN = void 0;
exports.canonicalOrigin = canonicalOrigin;
exports.hostWithoutPort = hostWithoutPort;
exports.legacyDuplicateHosts = legacyDuplicateHosts;
exports.canonicalHost = canonicalHost;
exports.isCanonicalHost = isCanonicalHost;
exports.isLegacyDuplicateHost = isLegacyDuplicateHost;
exports.isCanonicalRedirectExcludedPath = isCanonicalRedirectExcludedPath;
exports.shouldRedirectToCanonical = shouldRedirectToCanonical;
exports.canonicalRedirectLocation = canonicalRedirectLocation;
exports.robotsTxt = robotsTxt;
exports.sitemapXml = sitemapXml;
exports.DEFAULT_CANONICAL_ORIGIN = 'https://shinobijourney.com';
exports.DEFAULT_LEGACY_DUPLICATE_HOSTS = ['theravensark.com', 'www.theravensark.com'];
const STATIC_OR_OPERATIONAL_PREFIXES = [
    '/api',
    '/kv',
    '/assets',
    '/badges',
    '/music',
    '/sfx',
    '/scenes',
    '/sector-map',
    '/socket.io',
];
const STATIC_OR_OPERATIONAL_EXACT = new Set([
    '/favicon.ico',
    '/favicon.svg',
    '/health',
    '/health/db',
    '/restart',
    '/robots.txt',
    '/sitemap.xml',
    '/Shinobi-Journeys.png',
]);
function canonicalOrigin(env = process.env) {
    const raw = env.CANONICAL_ORIGIN || env.PUBLIC_CANONICAL_ORIGIN || exports.DEFAULT_CANONICAL_ORIGIN;
    try {
        const url = new URL(raw);
        return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
    }
    catch {
        return exports.DEFAULT_CANONICAL_ORIGIN;
    }
}
function hostWithoutPort(hostHeader) {
    const raw = Array.isArray(hostHeader) ? hostHeader[0] ?? '' : hostHeader ?? '';
    return raw.trim().toLowerCase().replace(/:\d+$/, '');
}
function legacyDuplicateHosts(env = process.env) {
    const raw = env.LEGACY_DUPLICATE_HOSTS;
    if (!raw)
        return exports.DEFAULT_LEGACY_DUPLICATE_HOSTS;
    return raw.split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
}
function canonicalHost(env = process.env) {
    return new URL(canonicalOrigin(env)).host.toLowerCase();
}
function isCanonicalHost(hostHeader, env = process.env) {
    const host = hostWithoutPort(hostHeader);
    const canonical = canonicalHost(env);
    return host === canonical || host === `www.${canonical}`;
}
function isLegacyDuplicateHost(hostHeader, env = process.env) {
    const host = hostWithoutPort(hostHeader);
    return legacyDuplicateHosts(env).includes(host);
}
function isCanonicalRedirectExcludedPath(pathname) {
    if (STATIC_OR_OPERATIONAL_EXACT.has(pathname))
        return true;
    if (/\.[A-Za-z0-9]{2,8}$/.test(pathname))
        return true;
    return STATIC_OR_OPERATIONAL_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
function shouldRedirectToCanonical(hostHeader, pathname, env = process.env) {
    return isLegacyDuplicateHost(hostHeader, env) && !isCanonicalRedirectExcludedPath(pathname);
}
function canonicalRedirectLocation(originalUrl, env = process.env) {
    const pathAndQuery = originalUrl.startsWith('/') ? originalUrl : `/${originalUrl}`;
    return new URL(pathAndQuery, canonicalOrigin(env)).toString();
}
function robotsTxt(env = process.env) {
    return [
        'User-agent: *',
        'Allow: /',
        `Sitemap: ${canonicalOrigin(env)}/sitemap.xml`,
        '',
    ].join('\n');
}
function sitemapXml(env = process.env) {
    const origin = canonicalOrigin(env);
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        '  <url>',
        `    <loc>${origin}/</loc>`,
        '  </url>',
        '</urlset>',
        '',
    ].join('\n');
}

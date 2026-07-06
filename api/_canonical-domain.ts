export const DEFAULT_CANONICAL_ORIGIN = 'https://shinobijourney.com';
export const DEFAULT_LEGACY_DUPLICATE_HOSTS = ['theravensark.com', 'www.theravensark.com'];

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

export function canonicalOrigin(env: NodeJS.ProcessEnv = process.env): string {
    const raw = env.CANONICAL_ORIGIN || env.PUBLIC_CANONICAL_ORIGIN || DEFAULT_CANONICAL_ORIGIN;
    try {
        const url = new URL(raw);
        return `${url.protocol}//${url.host}`.replace(/\/+$/, '');
    } catch {
        return DEFAULT_CANONICAL_ORIGIN;
    }
}

export function hostWithoutPort(hostHeader: string | string[] | undefined): string {
    const raw = Array.isArray(hostHeader) ? hostHeader[0] ?? '' : hostHeader ?? '';
    return raw.trim().toLowerCase().replace(/:\d+$/, '');
}

export function legacyDuplicateHosts(env: NodeJS.ProcessEnv = process.env): string[] {
    const raw = env.LEGACY_DUPLICATE_HOSTS;
    if (!raw) return DEFAULT_LEGACY_DUPLICATE_HOSTS;
    return raw.split(',').map(host => host.trim().toLowerCase()).filter(Boolean);
}

export function canonicalHost(env: NodeJS.ProcessEnv = process.env): string {
    return new URL(canonicalOrigin(env)).host.toLowerCase();
}

export function isCanonicalHost(hostHeader: string | string[] | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
    const host = hostWithoutPort(hostHeader);
    const canonical = canonicalHost(env);
    return host === canonical || host === `www.${canonical}`;
}

export function isLegacyDuplicateHost(hostHeader: string | string[] | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
    const host = hostWithoutPort(hostHeader);
    return legacyDuplicateHosts(env).includes(host);
}

export function isCanonicalRedirectExcludedPath(pathname: string): boolean {
    if (STATIC_OR_OPERATIONAL_EXACT.has(pathname)) return true;
    if (/\.[A-Za-z0-9]{2,8}$/.test(pathname)) return true;
    return STATIC_OR_OPERATIONAL_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export function shouldRedirectToCanonical(hostHeader: string | string[] | undefined, pathname: string, env: NodeJS.ProcessEnv = process.env): boolean {
    return isLegacyDuplicateHost(hostHeader, env) && !isCanonicalRedirectExcludedPath(pathname);
}

export function canonicalRedirectLocation(originalUrl: string, env: NodeJS.ProcessEnv = process.env): string {
    const pathAndQuery = originalUrl.startsWith('/') ? originalUrl : `/${originalUrl}`;
    return new URL(pathAndQuery, canonicalOrigin(env)).toString();
}

export function robotsTxt(env: NodeJS.ProcessEnv = process.env): string {
    return [
        'User-agent: *',
        'Allow: /',
        `Sitemap: ${canonicalOrigin(env)}/sitemap.xml`,
        '',
    ].join('\n');
}

export function sitemapXml(env: NodeJS.ProcessEnv = process.env): string {
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

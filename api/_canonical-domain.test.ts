import assert from 'node:assert/strict';
import test from 'node:test';
import {
    canonicalOrigin,
    canonicalRedirectLocation,
    isCanonicalRedirectExcludedPath,
    isCanonicalHost,
    isLegacyDuplicateHost,
    robotsTxt,
    shouldRedirectToCanonical,
    sitemapXml,
} from './_canonical-domain.js';

test('canonical origin defaults to shinobijourney.com and is configurable', () => {
    assert.equal(canonicalOrigin({}), 'https://shinobijourney.com');
    assert.equal(canonicalOrigin({ CANONICAL_ORIGIN: 'https://example.com/path' }), 'https://example.com');
    assert.equal(canonicalOrigin({ CANONICAL_ORIGIN: 'not a url' }), 'https://shinobijourney.com');
});

test('theravensark duplicate host redirects normal SPA pages to the canonical site', () => {
    assert.equal(isLegacyDuplicateHost('theravensark.com'), true);
    assert.equal(isLegacyDuplicateHost('www.theravensark.com:443'), true);
    assert.equal(shouldRedirectToCanonical('theravensark.com', '/profile'), true);
    assert.equal(canonicalRedirectLocation('/profile?tab=pvp'), 'https://shinobijourney.com/profile?tab=pvp');
});

test('canonical www duplicate redirects normal SPA pages to the apex canonical site', () => {
    assert.equal(isCanonicalHost('shinobijourney.com'), true);
    assert.equal(isCanonicalHost('www.shinobijourney.com:443'), true);
    assert.equal(shouldRedirectToCanonical('shinobijourney.com', '/'), false);
    assert.equal(shouldRedirectToCanonical('www.shinobijourney.com', '/'), true);
    assert.equal(shouldRedirectToCanonical('www.shinobijourney.com', '/profile'), true);
    assert.equal(canonicalRedirectLocation('/profile?tab=pvp'), 'https://shinobijourney.com/profile?tab=pvp');
});

test('canonical redirect never leaves the canonical origin (open-redirect regression)', () => {
    for (const raw of [
        '//evil.example/login',
        '/\\evil.example/x',
        '\\\\evil.example/x',
        '///evil.example',
        '/\t/evil.example/x',
        ' //evil.example',
    ]) {
        const location = canonicalRedirectLocation(raw, {});
        assert.equal(new URL(location).origin, 'https://shinobijourney.com', `${JSON.stringify(raw)} -> ${location}`);
        assert.doesNotMatch(new URL(location).host, /evil/);
    }
    assert.equal(canonicalRedirectLocation('//evil.example/login', {}), 'https://shinobijourney.com/evil.example/login');
    assert.equal(canonicalRedirectLocation('', {}), 'https://shinobijourney.com/');
    assert.equal(canonicalRedirectLocation('profile', {}), 'https://shinobijourney.com/profile');
});

test('API, storage, health, robots, sitemap, and static paths are not redirected', () => {
    for (const pathname of [
        '/api/pvp/session',
        '/health',
        '/health/db',
        '/restart',
        '/robots.txt',
        '/sitemap.xml',
        '/assets/index-B72MdXjq.js',
        '/Shinobi-Journeys.png',
        '/favicon.svg',
    ]) {
        assert.equal(isCanonicalRedirectExcludedPath(pathname), true, `${pathname} should be excluded`);
        assert.equal(shouldRedirectToCanonical('theravensark.com', pathname), false, `${pathname} should not redirect`);
    }
});

test('robots.txt and sitemap.xml advertise only the canonical domain', () => {
    const robots = robotsTxt({});
    assert.match(robots, /Sitemap: https:\/\/shinobijourney\.com\/sitemap\.xml/);
    assert.doesNotMatch(robots, /theravensark\.com/);

    const sitemap = sitemapXml({});
    assert.match(sitemap, /<loc>https:\/\/shinobijourney\.com\/<\/loc>/);
    assert.doesNotMatch(sitemap, /theravensark\.com/);
});

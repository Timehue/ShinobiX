"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const _canonical_domain_js_1 = require("./_canonical-domain.js");
(0, node_test_1.default)('canonical origin defaults to shinobijourney.com and is configurable', () => {
    strict_1.default.equal((0, _canonical_domain_js_1.canonicalOrigin)({}), 'https://shinobijourney.com');
    strict_1.default.equal((0, _canonical_domain_js_1.canonicalOrigin)({ CANONICAL_ORIGIN: 'https://example.com/path' }), 'https://example.com');
    strict_1.default.equal((0, _canonical_domain_js_1.canonicalOrigin)({ CANONICAL_ORIGIN: 'not a url' }), 'https://shinobijourney.com');
});
(0, node_test_1.default)('theravensark duplicate host redirects normal SPA pages to the canonical site', () => {
    strict_1.default.equal((0, _canonical_domain_js_1.isLegacyDuplicateHost)('theravensark.com'), true);
    strict_1.default.equal((0, _canonical_domain_js_1.isLegacyDuplicateHost)('www.theravensark.com:443'), true);
    strict_1.default.equal((0, _canonical_domain_js_1.shouldRedirectToCanonical)('theravensark.com', '/profile'), true);
    strict_1.default.equal((0, _canonical_domain_js_1.canonicalRedirectLocation)('/profile?tab=pvp'), 'https://shinobijourney.com/profile?tab=pvp');
});
(0, node_test_1.default)('API, storage, health, robots, sitemap, and static paths are not redirected', () => {
    for (const pathname of [
        '/api/kv/get',
        '/api/pvp/session',
        '/kv/get',
        '/health',
        '/health/db',
        '/restart',
        '/robots.txt',
        '/sitemap.xml',
        '/assets/index-B72MdXjq.js',
        '/Shinobi-Journeys.png',
        '/favicon.svg',
    ]) {
        strict_1.default.equal((0, _canonical_domain_js_1.isCanonicalRedirectExcludedPath)(pathname), true, `${pathname} should be excluded`);
        strict_1.default.equal((0, _canonical_domain_js_1.shouldRedirectToCanonical)('theravensark.com', pathname), false, `${pathname} should not redirect`);
    }
});
(0, node_test_1.default)('robots.txt and sitemap.xml advertise only the canonical domain', () => {
    const robots = (0, _canonical_domain_js_1.robotsTxt)({});
    strict_1.default.match(robots, /Sitemap: https:\/\/shinobijourney\.com\/sitemap\.xml/);
    strict_1.default.doesNotMatch(robots, /theravensark\.com/);
    const sitemap = (0, _canonical_domain_js_1.sitemapXml)({});
    strict_1.default.match(sitemap, /<loc>https:\/\/shinobijourney\.com\/<\/loc>/);
    strict_1.default.doesNotMatch(sitemap, /theravensark\.com/);
});

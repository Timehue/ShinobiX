"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _client_ip_js_1 = require("./_client-ip.js");
// Verifies the Cloudflare-aware client-IP extraction shared by the player IP
// tracker, the moderation IP index, and the rate-limiter fallback. The bug
// this guards against: behind Cloudflare, the left-most X-Forwarded-For hop is
// a Cloudflare edge IP (162.158.x.x), so the naive xff.split(',')[0] recorded
// PoPs instead of players. CF-Connecting-IP carries the real visitor.
function req(headers, socketIp) {
    return { headers, socket: socketIp ? { remoteAddress: socketIp } : undefined };
}
(0, node_test_1.describe)('isCloudflareIp', () => {
    (0, node_test_1.it)('matches Cloudflare IPv4 ranges (the observed 162.158.0.0/15)', () => {
        node_assert_1.strict.equal((0, _client_ip_js_1.isCloudflareIp)('162.158.14.68'), true);
        node_assert_1.strict.equal((0, _client_ip_js_1.isCloudflareIp)('162.158.19.87'), true);
        node_assert_1.strict.equal((0, _client_ip_js_1.isCloudflareIp)('104.16.0.1'), true);
        node_assert_1.strict.equal((0, _client_ip_js_1.isCloudflareIp)('173.245.48.5'), true);
    });
    (0, node_test_1.it)('matches Cloudflare IPv6 ranges', () => {
        node_assert_1.strict.equal((0, _client_ip_js_1.isCloudflareIp)('2606:4700::1'), true);
        node_assert_1.strict.equal((0, _client_ip_js_1.isCloudflareIp)('2a06:98c0:3600::1'), true);
    });
    (0, node_test_1.it)('rejects non-Cloudflare addresses', () => {
        node_assert_1.strict.equal((0, _client_ip_js_1.isCloudflareIp)('8.8.8.8'), false);
        node_assert_1.strict.equal((0, _client_ip_js_1.isCloudflareIp)('86.123.45.67'), false); // a real RO client-style IP
        node_assert_1.strict.equal((0, _client_ip_js_1.isCloudflareIp)('2001:4860:4860::8888'), false);
        node_assert_1.strict.equal((0, _client_ip_js_1.isCloudflareIp)('not-an-ip'), false);
        node_assert_1.strict.equal((0, _client_ip_js_1.isCloudflareIp)(''), false);
    });
});
(0, node_test_1.describe)('requestTransitedCloudflare', () => {
    (0, node_test_1.it)('is true when an XFF hop is a Cloudflare edge IP', () => {
        node_assert_1.strict.equal((0, _client_ip_js_1.requestTransitedCloudflare)(req({ 'x-forwarded-for': '162.158.14.68' })), true);
    });
    (0, node_test_1.it)('is true when the immediate socket peer is Cloudflare (cPanel path)', () => {
        node_assert_1.strict.equal((0, _client_ip_js_1.requestTransitedCloudflare)(req({}, '162.158.14.68')), true);
    });
    (0, node_test_1.it)('is false for a direct (non-Cloudflare) request', () => {
        node_assert_1.strict.equal((0, _client_ip_js_1.requestTransitedCloudflare)(req({ 'x-forwarded-for': '86.123.45.67' }, '10.0.0.3')), false);
    });
});
(0, node_test_1.describe)('clientIp', () => {
    (0, node_test_1.it)('returns the real visitor from CF-Connecting-IP when behind Cloudflare', () => {
        // Production shape: Railway sees XFF[0] = Cloudflare egress; the visitor
        // is in CF-Connecting-IP.
        const r = req({
            'cf-connecting-ip': '86.123.45.67',
            'x-forwarded-for': '162.158.14.68',
        });
        node_assert_1.strict.equal((0, _client_ip_js_1.clientIp)(r), '86.123.45.67');
    });
    (0, node_test_1.it)('handles an IPv6 visitor behind Cloudflare', () => {
        const r = req({
            'cf-connecting-ip': '2001:4860:4860::8888',
            'x-forwarded-for': '162.158.14.68',
        });
        node_assert_1.strict.equal((0, _client_ip_js_1.clientIp)(r), '2001:4860:4860::8888');
    });
    (0, node_test_1.it)('IGNORES a forged CF-Connecting-IP when the request did not transit Cloudflare', () => {
        // Direct-to-origin attacker forging the header but with no Cloudflare hop.
        const r = req({
            'cf-connecting-ip': '1.2.3.4',
            'x-forwarded-for': '86.123.45.67',
        }, '10.0.0.3');
        node_assert_1.strict.equal((0, _client_ip_js_1.clientIp)(r), '86.123.45.67');
    });
    (0, node_test_1.it)('falls back to the first XFF hop when no CF header is present', () => {
        const r = req({ 'x-forwarded-for': '86.123.45.67, 10.0.0.1' });
        node_assert_1.strict.equal((0, _client_ip_js_1.clientIp)(r), '86.123.45.67');
    });
    (0, node_test_1.it)('falls back to x-real-ip when XFF is absent', () => {
        node_assert_1.strict.equal((0, _client_ip_js_1.clientIp)(req({ 'x-real-ip': '86.123.45.67' })), '86.123.45.67');
    });
    (0, node_test_1.it)('falls back to the socket peer when no proxy headers are present', () => {
        node_assert_1.strict.equal((0, _client_ip_js_1.clientIp)(req({}, '86.123.45.67')), '86.123.45.67');
    });
    (0, node_test_1.it)('unwraps IPv4-mapped IPv6 from CF-Connecting-IP', () => {
        const r = req({
            'cf-connecting-ip': '::ffff:86.123.45.67',
            'x-forwarded-for': '162.158.14.68',
        });
        node_assert_1.strict.equal((0, _client_ip_js_1.clientIp)(r), '86.123.45.67');
    });
    (0, node_test_1.it)('handles array-valued headers (takes the first)', () => {
        const r = req({
            'cf-connecting-ip': ['86.123.45.67'],
            'x-forwarded-for': ['162.158.14.68'],
        });
        node_assert_1.strict.equal((0, _client_ip_js_1.clientIp)(r), '86.123.45.67');
    });
    (0, node_test_1.it)('returns null when nothing usable is present', () => {
        node_assert_1.strict.equal((0, _client_ip_js_1.clientIp)(req({})), null);
    });
});

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { clientIp, isCloudflareIp, requestTransitedCloudflare, type IpRequestLike } from './_client-ip.js';

// Verifies the Cloudflare-aware client-IP extraction shared by the player IP
// tracker, the moderation IP index, and the rate-limiter fallback. The bug
// this guards against: behind Cloudflare, the left-most X-Forwarded-For hop is
// a Cloudflare edge IP (162.158.x.x), so the naive xff.split(',')[0] recorded
// PoPs instead of players. CF-Connecting-IP carries the real visitor.

function req(headers: Record<string, string | string[] | undefined>, socketIp?: string): IpRequestLike {
    return { headers, socket: socketIp ? { remoteAddress: socketIp } : undefined };
}

describe('isCloudflareIp', () => {
    it('matches Cloudflare IPv4 ranges (the observed 162.158.0.0/15)', () => {
        assert.equal(isCloudflareIp('162.158.14.68'), true);
        assert.equal(isCloudflareIp('162.158.19.87'), true);
        assert.equal(isCloudflareIp('104.16.0.1'), true);
        assert.equal(isCloudflareIp('173.245.48.5'), true);
    });
    it('matches Cloudflare IPv6 ranges', () => {
        assert.equal(isCloudflareIp('2606:4700::1'), true);
        assert.equal(isCloudflareIp('2a06:98c0:3600::1'), true);
    });
    it('rejects non-Cloudflare addresses', () => {
        assert.equal(isCloudflareIp('8.8.8.8'), false);
        assert.equal(isCloudflareIp('86.123.45.67'), false); // a real RO client-style IP
        assert.equal(isCloudflareIp('2001:4860:4860::8888'), false);
        assert.equal(isCloudflareIp('not-an-ip'), false);
        assert.equal(isCloudflareIp(''), false);
    });
});

describe('requestTransitedCloudflare', () => {
    it('is true when an XFF hop is a Cloudflare edge IP', () => {
        assert.equal(requestTransitedCloudflare(req({ 'x-forwarded-for': '162.158.14.68' })), true);
    });
    it('is true when the immediate socket peer is Cloudflare (cPanel path)', () => {
        assert.equal(requestTransitedCloudflare(req({}, '162.158.14.68')), true);
    });
    it('is false for a direct (non-Cloudflare) request', () => {
        assert.equal(requestTransitedCloudflare(req({ 'x-forwarded-for': '86.123.45.67' }, '10.0.0.3')), false);
    });
});

describe('clientIp', () => {
    it('returns the real visitor from CF-Connecting-IP when behind Cloudflare', () => {
        // Production shape: Railway sees XFF[0] = Cloudflare egress; the visitor
        // is in CF-Connecting-IP.
        const r = req({
            'cf-connecting-ip': '86.123.45.67',
            'x-forwarded-for': '162.158.14.68',
        });
        assert.equal(clientIp(r), '86.123.45.67');
    });

    it('handles an IPv6 visitor behind Cloudflare', () => {
        const r = req({
            'cf-connecting-ip': '2001:4860:4860::8888',
            'x-forwarded-for': '162.158.14.68',
        });
        assert.equal(clientIp(r), '2001:4860:4860::8888');
    });

    it('IGNORES a forged CF-Connecting-IP when the request did not transit Cloudflare', () => {
        // Direct-to-origin attacker forging the header but with no Cloudflare hop.
        const r = req({
            'cf-connecting-ip': '1.2.3.4',
            'x-forwarded-for': '86.123.45.67',
        }, '10.0.0.3');
        assert.equal(clientIp(r), '86.123.45.67');
    });

    it('falls back to the first XFF hop when no CF header is present', () => {
        const r = req({ 'x-forwarded-for': '86.123.45.67, 10.0.0.1' });
        assert.equal(clientIp(r), '86.123.45.67');
    });

    it('falls back to x-real-ip when XFF is absent', () => {
        assert.equal(clientIp(req({ 'x-real-ip': '86.123.45.67' })), '86.123.45.67');
    });

    it('falls back to the socket peer when no proxy headers are present', () => {
        assert.equal(clientIp(req({}, '86.123.45.67')), '86.123.45.67');
    });

    it('unwraps IPv4-mapped IPv6 from CF-Connecting-IP', () => {
        const r = req({
            'cf-connecting-ip': '::ffff:86.123.45.67',
            'x-forwarded-for': '162.158.14.68',
        });
        assert.equal(clientIp(r), '86.123.45.67');
    });

    it('handles array-valued headers (takes the first)', () => {
        const r = req({
            'cf-connecting-ip': ['86.123.45.67'],
            'x-forwarded-for': ['162.158.14.68'],
        });
        assert.equal(clientIp(r), '86.123.45.67');
    });

    it('returns null when nothing usable is present', () => {
        assert.equal(clientIp(req({})), null);
    });
});

import { describe, it, beforeEach } from 'node:test';
import { strict as assert } from 'node:assert';
import { noteRealIpAgreementOnce, _resetRealIpAgreementLogForTests } from './_client-ip.js';

// L15: a once-per-process diagnostic that reports ONLY whether X-Real-IP and
// CF-Connecting-IP agree. It must never write either address to the log.

describe('noteRealIpAgreementOnce', () => {
    beforeEach(() => _resetRealIpAgreementLogForTests());

    it('logs nothing until a request carries both headers', () => {
        const lines: string[] = [];
        assert.equal(noteRealIpAgreementOnce({ headers: { 'x-real-ip': '203.0.113.7' } }, l => lines.push(l)), null);
        assert.equal(noteRealIpAgreementOnce({ headers: { 'cf-connecting-ip': '203.0.113.7' } }, l => lines.push(l)), null);
        assert.equal(noteRealIpAgreementOnce({ headers: {} }, l => lines.push(l)), null);
        assert.deepEqual(lines, []);
    });

    it('logs a boolean once, never the IP values', () => {
        const lines: string[] = [];
        const first = noteRealIpAgreementOnce(
            { headers: { 'x-real-ip': '203.0.113.7', 'cf-connecting-ip': '198.51.100.9' } },
            l => lines.push(l),
        );
        assert.equal(first, false);
        const second = noteRealIpAgreementOnce(
            { headers: { 'x-real-ip': '203.0.113.7', 'cf-connecting-ip': '203.0.113.7' } },
            l => lines.push(l),
        );
        assert.equal(second, null, 'only the first dual-header request is logged');
        assert.equal(lines.length, 1);
        assert.match(lines[0], /: false$/);
        assert.doesNotMatch(lines[0], /203\.0\.113|198\.51\.100/);
    });

    it('treats normalised-equal addresses as agreeing', () => {
        const lines: string[] = [];
        assert.equal(noteRealIpAgreementOnce(
            { headers: { 'x-real-ip': '::ffff:203.0.113.7', 'cf-connecting-ip': ' 203.0.113.7 ' } },
            l => lines.push(l),
        ), true);
        assert.match(lines[0], /: true$/);
    });
});

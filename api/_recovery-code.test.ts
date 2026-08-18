import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
    RECOVERY_CODE_ENTROPY_BITS,
    RECOVERY_CODE_LENGTH,
    buildRecoveryCodeRecord,
    generateRecoveryCode,
    normalizeRecoveryCode,
    recoveryCodeKey,
    recoveryCodeMatches,
} from './_recovery-code.js';

describe('recovery code shape', () => {
    it('generates a grouped, transcribable code with no ambiguous characters', () => {
        for (let i = 0; i < 50; i += 1) {
            const code = generateRecoveryCode();
            assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
            // I, L, O and U are the characters people confuse when copying by
            // hand, and normalization folds them onto digits — so a generated
            // code must never contain one or the fold would be lossy.
            assert.ok(!/[ILOU]/.test(code), `generated code contains an ambiguous character: ${code}`);
        }
    });

    it('carries enough entropy that guessing is not a threat model', () => {
        // The rate limiter is not what makes redemption safe; this is. If the
        // code ever gets shorter, the no-per-account-lockout decision in
        // player-auth has to be revisited.
        assert.equal(RECOVERY_CODE_LENGTH, 20);
        assert.ok(RECOVERY_CODE_ENTROPY_BITS >= 100, `entropy dropped to ${RECOVERY_CODE_ENTROPY_BITS} bits`);
    });

    it('does not repeat itself', () => {
        const seen = new Set<string>();
        for (let i = 0; i < 200; i += 1) seen.add(generateRecoveryCode());
        assert.equal(seen.size, 200);
    });

    it('keys storage under the name slug', () => {
        assert.equal(recoveryCodeKey('Kaito Sun'), 'auth-recovery:kaitosun');
    });
});

describe('recovery code normalization', () => {
    it('accepts what a human actually types', () => {
        const code = generateRecoveryCode();
        const canonical = normalizeRecoveryCode(code);
        assert.equal(canonical.length, RECOVERY_CODE_LENGTH);
        for (const variant of [
            code.toLowerCase(),
            code.replace(/-/g, ''),
            code.replace(/-/g, ' '),
            `  ${code}  `,
        ]) {
            assert.equal(normalizeRecoveryCode(variant), canonical, `variant failed: ${variant}`);
        }
    });

    it('folds the ambiguous letters onto the digits they are mistaken for', () => {
        assert.equal(normalizeRecoveryCode('OOOOO-11111-22222-33333'), '00000111112222233333');
        assert.equal(normalizeRecoveryCode('IIIII-LLLLL-22222-33333'), '11111111112222233333');
        assert.equal(normalizeRecoveryCode('UUUUU-11111-22222-33333'), 'VVVVV111112222233333');
    });

    it('rejects anything that is not a code', () => {
        for (const bad of [
            '', 'nope', null, undefined, 42, {},
            'ABCDE-ABCDE-ABCDE',              // too short
            'ABCDE-ABCDE-ABCDE-ABCDE-ABCDE',  // too long
            'ABCD!-ABCDE-ABCDE-ABCDE',        // character outside the alphabet
        ]) {
            assert.equal(normalizeRecoveryCode(bad as unknown), '', `should have rejected: ${String(bad)}`);
        }
    });
});

describe('recovery code storage form', () => {
    it('never stores the code itself', () => {
        const code = generateRecoveryCode();
        const record = buildRecoveryCodeRecord(code, 1_000);
        const serialized = JSON.stringify(record);
        assert.ok(!serialized.includes(normalizeRecoveryCode(code)));
        assert.ok(!serialized.includes(code));
        assert.equal(record.issuedAt, 1_000);
        assert.match(record.hash, /^[0-9a-f]{64}$/);
    });

    it('matches the code it was built from, in any typed form', () => {
        const code = generateRecoveryCode();
        const record = buildRecoveryCodeRecord(code);
        assert.equal(recoveryCodeMatches(record, code), true);
        assert.equal(recoveryCodeMatches(record, code.toLowerCase().replace(/-/g, '')), true);
        assert.equal(recoveryCodeMatches(record, generateRecoveryCode()), false);
    });

    it('salts, so two accounts holding the same code do not share a hash', () => {
        const code = generateRecoveryCode();
        const a = buildRecoveryCodeRecord(code);
        const b = buildRecoveryCodeRecord(code);
        assert.notEqual(a.salt, b.salt);
        assert.notEqual(a.hash, b.hash);
        assert.equal(recoveryCodeMatches(a, code), true);
        assert.equal(recoveryCodeMatches(b, code), true);
    });

    it('FAILS CLOSED on a missing or malformed record', () => {
        // The same invariant verifyAgainst carries: "there is no stored
        // credential" must never be reachable from "the supplied one matched".
        const code = generateRecoveryCode();
        for (const record of [
            null,
            undefined,
            {} as never,
            { hash: '', salt: '' } as never,
            { hash: 'abc' } as never,
            { salt: 'abc' } as never,
            { hash: undefined, salt: undefined } as never,
        ]) {
            assert.equal(recoveryCodeMatches(record, code), false);
        }
    });

    it('rejects an empty supplied code against a real record', () => {
        const record = buildRecoveryCodeRecord(generateRecoveryCode());
        for (const supplied of ['', null, undefined, '   ']) {
            assert.equal(recoveryCodeMatches(record, supplied as unknown), false);
        }
    });
});

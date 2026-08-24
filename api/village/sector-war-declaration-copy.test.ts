import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

/*
 * /api/village/sector-war — declaration-fault copy.
 *
 * The six 503s in doDeclare all mean "the war chest's bookkeeping for this
 * sector could not be trusted, so nothing was charged". They used to hand the
 * Kage the DIAGNOSTIC as the message ("Sector-war funding fingerprint is
 * invalid; an administrator must inspect it."). Now each one returns a single
 * player-facing sentence and the technical detail is logged server-side.
 *
 * Source-text contract: reproducing a torn funding row through the handler needs
 * a corrupted KV fixture per branch, which pins implementation rather than copy.
 */

// Repo-root relative (the runner's cwd) — `import.meta` is unavailable under
// the CommonJS server tsconfig, and every other api/ source-contract test reads
// its subject the same way.
const source = readFileSync(join(process.cwd(), 'api', 'village', 'sector-war.ts'), 'utf8');

/** Every string literal handed to a `res.status(...).json({ error: ... })`. */
function inlineErrorBodies(text: string): string[] {
    return [...text.matchAll(/res\.status\(\d+\)\.json\(\{\s*error:\s*'([^']*)'/g)].map(m => m[1]);
}

describe('sector-war declaration faults', () => {
    it('routes every declaration fault through the logging helper, not a raw 503 body', () => {
        assert.match(source, /function declarationFault\(res: VercelResponse, code: string, message: string, detail: Record<string, unknown>\)/);
        assert.match(source, /console\.warn\('\[village\/sector-war\] declaration-fault', safeLogValue\(\{ code, \.\.\.detail \}\)\)/);
        const codes = [...source.matchAll(/declarationFault\(res, '([a-z-]+)'/g)].map(m => m[1]);
        assert.deepEqual(codes.slice().sort(), [
            'existing-state-invalid',
            'funding-fingerprint-mismatch',
            'funding-identity-invalid',
            'funding-state-invalid',
            'generation-exhausted',
            'multiple-funding-rows',
        ], 'all six declaration faults must go through declarationFault');
        assert.equal(new Set(codes).size, codes.length, 'each fault needs its own code');
    });

    it('gives each fault its own player-facing sentence, with no bookkeeping jargon', () => {
        const messages = [...source.matchAll(/declarationFault\(res, '[a-z-]+',\s*\n\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]);
        assert.equal(messages.length, 6, 'expected one sentence per fault');
        assert.equal(new Set(messages).size, 6, 'the sentences must not be copy-pasted');
        for (const msg of messages) {
            assert.match(msg, /[.!]$/, `"${msg}" is not a sentence`);
            assert.doesNotMatch(msg, /Sector-war|fingerprint|generation|funding row|declarationFunding/i, `"${msg}" still leaks bookkeeping jargon`);
            // Every one has to reassure that no War Resources were burned, or
            // else say what to do next.
            assert.match(msg, /nothing was spent|left untouched|Try again|administrator/i, `"${msg}" gives the Kage nothing to do`);
        }
    });

    it('never sends the diagnostic to the client', () => {
        for (const body of inlineErrorBodies(source)) {
            assert.doesNotMatch(body, /an administrator must inspect it|require administrator inspection|generation is exhausted/, body);
        }
        for (const retired of [
            'Multiple sector-war funding rows require administrator inspection.',
            'Sector-war funding identity is invalid; an administrator must inspect it.',
            'Sector-war funding fingerprint is invalid; an administrator must inspect it.',
            'Sector-war funding state is invalid; an administrator must inspect it.',
            'Existing sector-war state is invalid; an administrator must inspect it.',
            'Sector-war declaration generation is exhausted.',
        ]) {
            assert.ok(!source.includes(retired), `the raw diagnostic "${retired}" is back`);
        }
    });

    it('keeps the ordinary retryable 503s as they were — they are not faults', () => {
        const bodies = inlineErrorBodies(source);
        assert.ok(bodies.includes('That sector is busy right now — try again in a moment.'));
        assert.ok(bodies.includes('Sector-war funding is settling — try again.'));
    });
});

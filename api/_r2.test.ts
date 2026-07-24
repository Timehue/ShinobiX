import { describe, it, afterEach } from 'node:test';
import { strict as assert } from 'node:assert';
import {
    objectKeyForId,
    r2PublicUrl,
    r2ReadEnabled,
    r2WriteEnabled,
    putImage,
    r2ObjectExists,
} from './_r2.js';

// Snapshot + restore the R2 env so tests don't leak into each other or the
// process. All gating is read at call time (not cached), so setting these before
// a call is enough.
const R2_ENV = ['R2_PUBLIC_BASE', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'] as const;
const saved: Record<string, string | undefined> = {};
for (const k of R2_ENV) saved[k] = process.env[k];
function clearR2Env() { for (const k of R2_ENV) delete process.env[k]; }
afterEach(() => {
    for (const k of R2_ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

describe('objectKeyForId', () => {
    it('maps colons to slashes so ids lay out as folders', () => {
        assert.equal(objectKeyForId('ai:enemy-x'), 'ai/enemy-x');
        assert.equal(objectKeyForId('card:tc-042'), 'card/tc-042');
        assert.equal(objectKeyForId('vn:evt-1:page:0:left'), 'vn/evt-1/page/0/left');
        assert.equal(objectKeyForId('leader:leaf:kage'), 'leader/leaf/kage');
    });
});

describe('r2PublicUrl', () => {
    it('returns null when R2_PUBLIC_BASE is unset', () => {
        clearR2Env();
        assert.equal(r2PublicUrl('ai:enemy-x'), null);
    });
    it('builds an encoded, slash-preserving URL and trims trailing slashes on the base', () => {
        clearR2Env();
        process.env.R2_PUBLIC_BASE = 'https://img.example.com/';
        assert.equal(r2PublicUrl('ai:enemy-x'), 'https://img.example.com/ai/enemy-x');
        assert.equal(r2PublicUrl('vn:evt-1:page:0'), 'https://img.example.com/vn/evt-1/page/0');
    });
    it('percent-encodes unsafe characters within a segment but keeps the path slashes', () => {
        clearR2Env();
        process.env.R2_PUBLIC_BASE = 'https://img.example.com';
        assert.equal(r2PublicUrl('avatar:Ka Ge'), 'https://img.example.com/avatar/Ka%20Ge');
    });
});

describe('gating', () => {
    it('r2ReadEnabled tracks only R2_PUBLIC_BASE', () => {
        clearR2Env();
        assert.equal(r2ReadEnabled(), false);
        process.env.R2_PUBLIC_BASE = 'https://img.example.com';
        assert.equal(r2ReadEnabled(), true);
    });
    it('r2WriteEnabled requires all four write creds', () => {
        clearR2Env();
        assert.equal(r2WriteEnabled(), false);
        process.env.R2_ACCOUNT_ID = 'acct';
        process.env.R2_ACCESS_KEY_ID = 'key';
        process.env.R2_SECRET_ACCESS_KEY = 'secret';
        assert.equal(r2WriteEnabled(), false, 'missing bucket → still disabled');
        process.env.R2_BUCKET = 'bucket';
        assert.equal(r2WriteEnabled(), true);
    });
    it('blank/whitespace env values do not count as configured', () => {
        clearR2Env();
        process.env.R2_PUBLIC_BASE = '   ';
        assert.equal(r2ReadEnabled(), false);
    });
});

describe('putImage', () => {
    it('is a no-op returning false when write creds are absent (never throws, no network)', async () => {
        clearR2Env();
        const ok = await putImage('ai:enemy-x', { mime: 'image/png', buf: Buffer.from([0x89, 0x50]) });
        assert.equal(ok, false);
    });
});

describe('r2ObjectExists', () => {
    it('returns false when reads are disabled (no public base, no network)', async () => {
        clearR2Env();
        assert.equal(await r2ObjectExists('ai:enemy-x'), false);
    });
});

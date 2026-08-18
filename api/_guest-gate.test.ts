import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://localhost:1';
process.env.SUPABASE_SERVICE_KEY ??= 'test';

const store = new Map<string, unknown>();
const clone = <T>(value: T): T => (
    value === undefined || value === null ? value : JSON.parse(JSON.stringify(value)) as T
);

/** Set for one test to make every read throw, standing in for a storage outage. */
let readFails = false;

let gate: typeof import('./_guest-gate.js');
let originalGet: unknown;
let originalLock: string | undefined;
let originalError: typeof console.error;

before(async () => {
    const { kv } = await import('./_storage.js');
    originalGet = kv.get;
    kv.get = async <T,>(key: string) => {
        if (readFails) throw new Error('storage down');
        return clone(store.get(key)) as T | null;
    };
    gate = await import('./_guest-gate.js');
    originalLock = process.env.DISABLE_GUEST_SOCIAL_LOCK;
    originalError = console.error;
});

after(async () => {
    const { kv } = await import('./_storage.js');
    (kv as { get: unknown }).get = originalGet;
    if (originalLock === undefined) delete process.env.DISABLE_GUEST_SOCIAL_LOCK;
    else process.env.DISABLE_GUEST_SOCIAL_LOCK = originalLock;
    console.error = originalError;
});

beforeEach(() => {
    store.clear();
    readFails = false;
    delete process.env.DISABLE_GUEST_SOCIAL_LOCK;
    store.set('auth:guesty', { sessionEpoch: 0, guest: true, createdAt: 1 });
    store.set('auth:claimed', { sessionEpoch: 0, google: { sub: 'g1', linkedAt: 1 } });
    store.set('auth:oldschool', { sessionEpoch: 0, hash: 'h', salt: 's' });
    // A guest who set a first password: `player-auth` action `change` spreads
    // the record, so `guest: true` survives alongside the new credential.
    store.set('auth:settled', { sessionEpoch: 1, guest: true, hash: 'h', salt: 's' });
});

/** Minimal stand-in for the handler `res` — records the one JSON answer. */
function recordingRes() {
    const sent: { code: number; body: Record<string, unknown> }[] = [];
    return {
        sent,
        status(code: number) {
            return { json(body: unknown) { sent.push({ code, body: body as Record<string, unknown> }); return body; } };
        },
    };
}

describe('guestSocialLockEnabled', () => {
    it('ships on and reads only the exact kill-switch value', () => {
        assert.equal(gate.guestSocialLockEnabled({} as NodeJS.ProcessEnv), true);
        assert.equal(gate.guestSocialLockEnabled({ DISABLE_GUEST_SOCIAL_LOCK: '1' } as unknown as NodeJS.ProcessEnv), false);
        // Anything other than the exact '1' leaves the lock on, matching every
        // other DISABLE_* flag in _release-flags.ts.
        assert.equal(gate.guestSocialLockEnabled({ DISABLE_GUEST_SOCIAL_LOCK: 'true' } as unknown as NodeJS.ProcessEnv), true);
        assert.equal(gate.guestSocialLockEnabled({ DISABLE_GUEST_SOCIAL_LOCK: '0' } as unknown as NodeJS.ProcessEnv), true);
    });
});

describe('isUnclaimedGuest', () => {
    it('is true only for a guest record with no password', async () => {
        assert.equal(await gate.isUnclaimedGuest('guesty'), true);
        assert.equal(await gate.isUnclaimedGuest('claimed'), false);
        assert.equal(await gate.isUnclaimedGuest('oldschool'), false);
    });

    it('is false for an account with no auth record at all', async () => {
        assert.equal(await gate.isUnclaimedGuest('ghost'), false);
    });

    it('canonicalizes the name to the storage slug', async () => {
        assert.equal(await gate.isUnclaimedGuest('  GuEsTy '), true);
    });

    it('is false for an empty name rather than reading a bare "auth:" key', async () => {
        store.set('auth:', { guest: true });
        assert.equal(await gate.isUnclaimedGuest('   '), false);
    });

    it('releases a guest who set a password, even though the guest flag survives', async () => {
        // The whole point of the lock is that a throwaway account costs
        // nothing. A password is a real credential, so the account is no longer
        // throwaway — even though `player-auth` action `change` keeps the flag.
        assert.equal(await gate.isUnclaimedGuest('settled'), false);
    });

    it('still holds a guest whose record is half a credential', async () => {
        // isPasswordlessRecord requires BOTH hash and salt; a record with one
        // of them cannot verify a password, so it is not a real credential.
        store.set('auth:halfway', { sessionEpoch: 1, guest: true, hash: 'h' });
        assert.equal(await gate.isUnclaimedGuest('halfway'), true);
        store.set('auth:halfway', { sessionEpoch: 1, guest: true, salt: 's' });
        assert.equal(await gate.isUnclaimedGuest('halfway'), true);
    });

    it('releases a guest who linked Google, which clears the flag outright', async () => {
        store.set('auth:linked', { sessionEpoch: 2, google: { sub: 'g9', linkedAt: 2 } });
        assert.equal(await gate.isUnclaimedGuest('linked'), false);
    });
});

describe('socialSurfacesLocked', () => {
    it('locks an unclaimed guest and leaves everyone else alone', async () => {
        assert.equal(await gate.socialSurfacesLocked('guesty'), true);
        assert.equal(await gate.socialSurfacesLocked('claimed'), false);
        assert.equal(await gate.socialSurfacesLocked('settled'), false);
    });

    it('unlocks everyone when the kill switch is thrown, without reading storage', async () => {
        process.env.DISABLE_GUEST_SOCIAL_LOCK = '1';
        readFails = true;
        assert.equal(await gate.socialSurfacesLocked('guesty'), false);
    });

    it('fails OPEN on a storage error so one blip cannot silence the whole village', async () => {
        readFails = true;
        console.error = () => {};
        try {
            assert.equal(await gate.socialSurfacesLocked('guesty'), false);
        } finally {
            console.error = originalError;
        }
    });
});

describe('rejectUnclaimedGuest', () => {
    it('answers 403 with a machine-readable code and reports that it handled the request', async () => {
        const res = recordingRes();
        assert.equal(await gate.rejectUnclaimedGuest(res, { admin: false, name: 'guesty' }), true);
        assert.equal(res.sent.length, 1);
        assert.equal(res.sent[0].code, 403);
        assert.equal(res.sent[0].body.errorCode, gate.GUEST_SOCIAL_ERROR_CODE);
        assert.equal(res.sent[0].body.guestLocked, true);
        assert.equal(res.sent[0].body.error, gate.GUEST_SOCIAL_ERROR);
    });

    it('lets a claimed account through untouched', async () => {
        const res = recordingRes();
        assert.equal(await gate.rejectUnclaimedGuest(res, { admin: false, name: 'claimed' }), false);
        assert.equal(res.sent.length, 0);
    });

    it('lets a guest who set a password through untouched', async () => {
        const res = recordingRes();
        assert.equal(await gate.rejectUnclaimedGuest(res, { admin: false, name: 'settled' }), false);
        assert.equal(res.sent.length, 0);
    });

    it('never gates an admin, matching every other moderation bypass in the chat handlers', async () => {
        const res = recordingRes();
        assert.equal(await gate.rejectUnclaimedGuest(res, { admin: true }), false);
        assert.equal(res.sent.length, 0);
    });
});

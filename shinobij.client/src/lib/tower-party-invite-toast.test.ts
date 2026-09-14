import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    noteTowerPartyInvites,
    resetTowerPartyInviteToastState,
} from './tower-party-invite-toast';
import type { TowerPartyEnvelope, TowerPartyInvitationView } from './towers-api';

/*
 * The bug this guards: an invited player was never told. The toast is the ONLY
 * signal they get, so the two ways it can fail are both covered here — never
 * firing (the original bug), and firing for an invitation the server no longer
 * vouches for (which would send them to an empty ready room).
 */

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function stubStorage(): Map<string, string> {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => { store.set(key, value); },
            removeItem: (key: string) => { store.delete(key); },
        },
    });
    return store;
}

function invitation(partyId: string, hostDisplayName = 'Hoshi'): TowerPartyInvitationView {
    return {
        partyId,
        inviteCode: 'ABC123',
        hostSlug: hostDisplayName.toLowerCase(),
        hostDisplayName,
        binding: { mode: 'story', floor: 4 },
        memberCount: 2,
        expiresAt: Date.now() + 60_000,
    };
}

function envelopeOf(invitations: TowerPartyInvitationView[]): TowerPartyEnvelope {
    return { party: null, invitations };
}

describe('Battle Towers invite toast', () => {
    beforeEach(() => {
        stubStorage();
        resetTowerPartyInviteToastState();
    });

    afterEach(() => {
        if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
        else delete (globalThis as { localStorage?: Storage }).localStorage;
    });

    it('toasts a newly arrived invitation the server confirms', async () => {
        const toasts: string[] = [];
        await noteTowerPartyInvites(['party-1'], 'alice', {
            fetchParty: async () => envelopeOf([invitation('party-1')]),
            toast: (message) => { toasts.push(message); },
        });
        assert.equal(toasts.length, 1);
        assert.match(toasts[0], /Hoshi invited you to a Battle Towers party/);
        assert.match(toasts[0], /floor 4/);
    });

    it('names the Spire tier instead of a floor for a spire party', async () => {
        const toasts: string[] = [];
        await noteTowerPartyInvites(['party-spire'], 'alice', {
            fetchParty: async () => envelopeOf([{
                ...invitation('party-spire'),
                binding: { mode: 'spire', ascensionTier: 7 },
            }]),
            toast: (message) => { toasts.push(message); },
        });
        assert.match(toasts[0], /Spire tier 7/);
    });

    it('never toasts the same invitation twice, and stops re-fetching it', async () => {
        const toasts: string[] = [];
        let fetches = 0;
        const deps = {
            fetchParty: async () => { fetches += 1; return envelopeOf([invitation('party-1')]); },
            toast: (message: string) => { toasts.push(message); },
        };
        await noteTowerPartyInvites(['party-1'], 'alice', deps);
        // The heartbeat beats every second and keeps carrying the same id.
        await noteTowerPartyInvites(['party-1'], 'alice', deps);
        await noteTowerPartyInvites(['party-1'], 'alice', deps);
        assert.equal(toasts.length, 1, 'one invitation is one toast');
        assert.equal(fetches, 1, 'a seen id must not re-validate on every beat');
    });

    it('does not toast an index entry the server no longer vouches for', async () => {
        const toasts: string[] = [];
        let fetches = 0;
        const deps = {
            // The party expired: its id lingers in the per-player index but the
            // validated envelope no longer lists it.
            fetchParty: async () => { fetches += 1; return envelopeOf([]); },
            toast: (message: string) => { toasts.push(message); },
        };
        await noteTowerPartyInvites(['ghost-party'], 'alice', deps);
        assert.equal(toasts.length, 0, 'an unvalidated id must never become a toast');

        await noteTowerPartyInvites(['ghost-party'], 'alice', deps);
        assert.equal(fetches, 1, 'a rejected id is recorded so it cannot loop the fetch');
    });

    it('toasts again if the same party re-invites after the offer lapsed', async () => {
        const toasts: string[] = [];
        const deps = {
            fetchParty: async () => envelopeOf([invitation('party-1')]),
            toast: (message: string) => { toasts.push(message); },
        };
        await noteTowerPartyInvites(['party-1'], 'alice', deps);
        // Offer withdrawn — the id leaves the index, which must prune the receipt.
        await noteTowerPartyInvites([], 'alice', deps);
        // Re-invited.
        await noteTowerPartyInvites(['party-1'], 'alice', deps);
        assert.equal(toasts.length, 2, 'a fresh invitation to the same party must announce itself');
    });

    it('retries on the next beat when validation fails, losing nothing', async () => {
        const toasts: string[] = [];
        let attempt = 0;
        const deps = {
            fetchParty: async () => {
                attempt += 1;
                if (attempt === 1) throw new Error('offline');
                return envelopeOf([invitation('party-1')]);
            },
            toast: (message: string) => { toasts.push(message); },
        };
        await noteTowerPartyInvites(['party-1'], 'alice', deps);
        assert.equal(toasts.length, 0, 'a failed validation toasts nothing');
        await noteTowerPartyInvites(['party-1'], 'alice', deps);
        assert.equal(toasts.length, 1, 'the invitation is delayed, never dropped');
    });

    it('does not fetch at all when the beat carries no invitations', async () => {
        let fetches = 0;
        const deps = {
            fetchParty: async () => { fetches += 1; return envelopeOf([]); },
            toast: () => {},
        };
        await noteTowerPartyInvites(undefined, 'alice', deps);
        await noteTowerPartyInvites([], 'alice', deps);
        assert.equal(fetches, 0, 'the common case must cost nothing');
    });

    it('holds the toast while the tab is hidden, then announces it on return', async () => {
        const toasts: string[] = [];
        const deps = {
            fetchParty: async () => envelopeOf([invitation('party-1')]),
            toast: (message: string) => { toasts.push(message); },
        };
        const originalDoc = Object.getOwnPropertyDescriptor(globalThis, 'document');
        let hidden = true;
        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: { get hidden() { return hidden; } },
        });
        try {
            await noteTowerPartyInvites(['party-1'], 'alice', deps);
            assert.equal(toasts.length, 0, 'a toast fired into a hidden tab is a toast nobody sees');
            hidden = false;
            await noteTowerPartyInvites(['party-1'], 'alice', deps);
            assert.equal(toasts.length, 1, 'the invitation must survive until the player is back');
        } finally {
            if (originalDoc) Object.defineProperty(globalThis, 'document', originalDoc);
            else delete (globalThis as { document?: Document }).document;
        }
    });

    it('keeps receipts per player, so a shared device does not swallow a toast', async () => {
        const toasts: string[] = [];
        const deps = {
            fetchParty: async () => envelopeOf([invitation('party-1')]),
            toast: (message: string) => { toasts.push(message); },
        };
        await noteTowerPartyInvites(['party-1'], 'alice', deps);
        await noteTowerPartyInvites(['party-1'], 'bob', deps);
        assert.equal(toasts.length, 2, 'the second player has not seen this invitation');
    });
});

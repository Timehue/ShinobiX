/*
 * Shared social-list store — the original one-way Following list plus the
 * player's explicit Friends address book, fetched together once per logged-in
 * player and mutated optimistically. Mirrors lib/mail-unread's subscribe pattern
 * so every screen shares ONE fetch and stays in sync. Auth rides the global
 * window.fetch interceptor (authFetch.ts), so a bare /api/ fetch is signed.
 *
 * Stores display names; all comparisons are case-insensitive. The store
 * auto-reloads when the subscribing player changes (account switch), so callers
 * never have to reset it on logout.
 */

let following: string[] = [];
let friends: string[] = [];
let loadedFor: string | null = null;
const followingSubs = new Set<(list: string[]) => void>();
const friendSubs = new Set<(list: string[]) => void>();

function emitFollowing(): void {
    followingSubs.forEach((cb) => { try { cb(following); } catch { /* a bad subscriber must not break the rest */ } });
}

function emitFriends(): void {
    friendSubs.forEach((cb) => { try { cb(friends); } catch { /* a bad subscriber must not break the rest */ } });
}

function emitAll(): void {
    emitFollowing();
    emitFriends();
}

function eq(a: string, b: string): boolean {
    return a.toLowerCase() === b.toLowerCase();
}

async function load(playerName: string): Promise<void> {
    try {
        const r = await fetch(`/api/player/friends?playerName=${encodeURIComponent(playerName)}`);
        if (!r.ok) return;
        const j = await r.json();
        if (loadedFor !== playerName) return; // a newer player subscribed mid-flight
        following = Array.isArray(j?.following) ? j.following : [];
        friends = Array.isArray(j?.friends) ? j.friends : [];
        emitAll();
    } catch { /* offline — keep what we have */ }
}

export function getFollowing(): string[] {
    return following;
}

export function isFollowing(name: string): boolean {
    return following.some((f) => eq(f, name));
}

/** Subscribe to the follow list; immediately invoked with the current value.
 *  Loads (or reloads, on account switch) for the given player. */
export function subscribeFollowing(playerName: string, cb: (list: string[]) => void): () => void {
    followingSubs.add(cb);
    cb(following);
    if (loadedFor !== playerName) {
        loadedFor = playerName;
        following = [];
        friends = [];
        void load(playerName);
    }
    return () => { followingSubs.delete(cb); };
}

/** Subscribe to the explicit Friends list. It shares the same account-scoped
 *  load as Following so mounting both controls still performs one request. */
export function subscribeFriends(playerName: string, cb: (list: string[]) => void): () => void {
    friendSubs.add(cb);
    cb(friends);
    if (loadedFor !== playerName) {
        loadedFor = playerName;
        following = [];
        friends = [];
        void load(playerName);
    }
    return () => { friendSubs.delete(cb); };
}

export async function follow(playerName: string, target: string): Promise<void> {
    if (isFollowing(target)) return;
    following = [...following, target]; // optimistic
    emitFollowing();
    try {
        const r = await fetch('/api/player/friends', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, targetName: target }),
        });
        if (r.ok) {
            const j = await r.json();
            if (Array.isArray(j?.following)) { following = j.following; emitFollowing(); }
        } else {
            following = following.filter((f) => !eq(f, target)); emitFollowing(); // rollback
        }
    } catch {
        following = following.filter((f) => !eq(f, target)); emitFollowing(); // rollback
    }
}

export async function unfollow(playerName: string, target: string): Promise<void> {
    const prev = following;
    following = following.filter((f) => !eq(f, target)); // optimistic
    emitFollowing();
    try {
        const r = await fetch('/api/player/friends', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, targetName: target }),
        });
        if (r.ok) {
            const j = await r.json();
            if (Array.isArray(j?.following)) { following = j.following; emitFollowing(); }
        } else {
            following = prev; emitFollowing(); // rollback
        }
    } catch {
        following = prev; emitFollowing(); // rollback
    }
}

export function isFriend(name: string): boolean {
    return friends.some((friend) => eq(friend, name));
}

async function friendMutation(playerName: string, target: string, method: 'POST' | 'DELETE'): Promise<void> {
    const cleanTarget = target.trim();
    if (!cleanTarget) throw new Error('Enter a player name.');

    const previous = friends;
    if (method === 'POST') {
        if (isFriend(cleanTarget)) return;
        friends = [...friends, cleanTarget];
    } else {
        friends = friends.filter((friend) => !eq(friend, cleanTarget));
    }
    emitFriends();

    try {
        const r = await fetch('/api/player/friends', {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, targetName: cleanTarget, list: 'friends' }),
        });
        const data = await r.json().catch(() => ({})) as { error?: string; friends?: unknown };
        if (!r.ok) throw new Error(data.error || 'Could not update your friends list.');
        friends = Array.isArray(data.friends) ? data.friends.map(String) : previous;
        emitFriends();
    } catch (cause) {
        friends = previous;
        emitFriends();
        throw cause instanceof Error ? cause : new Error('Could not update your friends list.');
    }
}

export function addFriend(playerName: string, target: string): Promise<void> {
    return friendMutation(playerName, target, 'POST');
}

export function removeFriend(playerName: string, target: string): Promise<void> {
    return friendMutation(playerName, target, 'DELETE');
}

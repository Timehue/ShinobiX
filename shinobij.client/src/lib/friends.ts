/*
 * Shared "following" store — a one-way follow list, fetched once per logged-in
 * player and mutated optimistically. Mirrors lib/mail-unread's subscribe pattern
 * so the Users directory and a player's profile share ONE fetch and stay in
 * sync. Auth rides the global window.fetch interceptor (authFetch.ts), so a bare
 * /api/ fetch is signed automatically.
 *
 * Stores display names; all comparisons are case-insensitive. The store
 * auto-reloads when the subscribing player changes (account switch), so callers
 * never have to reset it on logout.
 */

let following: string[] = [];
let loadedFor: string | null = null;
const subs = new Set<(list: string[]) => void>();

function emit(): void {
    subs.forEach((cb) => { try { cb(following); } catch { /* a bad subscriber must not break the rest */ } });
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
        emit();
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
    subs.add(cb);
    cb(following);
    if (loadedFor !== playerName) {
        loadedFor = playerName;
        following = [];
        void load(playerName);
    }
    return () => { subs.delete(cb); };
}

export async function follow(playerName: string, target: string): Promise<void> {
    if (isFollowing(target)) return;
    following = [...following, target]; // optimistic
    emit();
    try {
        const r = await fetch('/api/player/friends', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, targetName: target }),
        });
        if (r.ok) {
            const j = await r.json();
            if (Array.isArray(j?.following)) { following = j.following; emit(); }
        } else {
            following = following.filter((f) => !eq(f, target)); emit(); // rollback
        }
    } catch {
        following = following.filter((f) => !eq(f, target)); emit(); // rollback
    }
}

export async function unfollow(playerName: string, target: string): Promise<void> {
    const prev = following;
    following = following.filter((f) => !eq(f, target)); // optimistic
    emit();
    try {
        const r = await fetch('/api/player/friends', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playerName, targetName: target }),
        });
        if (r.ok) {
            const j = await r.json();
            if (Array.isArray(j?.following)) { following = j.following; emit(); }
        } else {
            following = prev; emit(); // rollback
        }
    } catch {
        following = prev; emit(); // rollback
    }
}

/** Account-scoped social lists. Server replies own membership; mutations serialize
 * per list so a late response or rollback cannot erase another successful edit. */
type ListKind = 'following' | 'friends';
type Listener = (list: string[]) => void;
const subscribers: Record<ListKind, Map<Listener, string>> = { following: new Map(), friends: new Map() };
let owner = '';
let epoch = 0;
let lists: Record<ListKind, string[]> = { following: [], friends: [] };
let revisions: Record<ListKind, number> = { following: 0, friends: 0 };
let queues: Record<ListKind, Promise<void>> = { following: Promise.resolve(), friends: Promise.resolve() };
let loading: Promise<void> | null = null;
let pending: Record<ListKind, number> = { following: 0, friends: 0 };
let removeRefreshListeners: (() => void) | null = null;
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const validList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string');

function emit(kind: ListKind) {
    subscribers[kind].forEach((name, callback) => {
        try { callback(eq(name, owner) ? lists[kind] : []); } catch { /* isolated subscriber */ }
    });
}

export function refreshSocialLists(): Promise<void> {
    if (loading || !owner) return loading ?? Promise.resolve();
    const started = epoch;
    const versions = { ...revisions };
    const busy = { ...pending };
    const name = owner;
    const request = (async () => {
        try {
            const response = await fetch(`/api/player/friends?playerName=${encodeURIComponent(name)}`);
            const data: unknown = await response.json();
            if (!response.ok || started !== epoch || !data || typeof data !== 'object') return;
            for (const kind of ['following', 'friends'] as const) {
                const value = (data as Record<string, unknown>)[kind];
                if (!busy[kind] && !pending[kind] && versions[kind] === revisions[kind] && validList(value)) { lists[kind] = value; emit(kind); }
            }
        } catch { /* retain the last confirmed list and refresh on reconnect */ }
    })();
    loading = request;
    void request.finally(() => { if (loading === request) loading = null; });
    return request;
}

function selectOwner(playerName: string) {
    if (eq(owner, playerName)) return;
    owner = playerName;
    epoch++;
    lists = { following: [], friends: [] };
    revisions = { following: 0, friends: 0 };
    queues = { following: Promise.resolve(), friends: Promise.resolve() };
    loading = null;
    pending = { following: 0, friends: 0 };
    emit('following'); emit('friends');
    void refreshSocialLists();
}

function subscribe(kind: ListKind, playerName: string, callback: Listener): () => void {
    selectOwner(playerName);
    subscribers[kind].set(callback, playerName);
    callback(lists[kind]);
    if (!removeRefreshListeners && typeof window !== 'undefined') {
        const refresh = () => { if (!document.hidden) void refreshSocialLists(); };
        window.addEventListener('online', refresh);
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', refresh);
        removeRefreshListeners = () => {
            window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh);
            document.removeEventListener('visibilitychange', refresh);
        };
    }
    return () => {
        subscribers[kind].delete(callback);
        if (!subscribers.following.size && !subscribers.friends.size) { removeRefreshListeners?.(); removeRefreshListeners = null; }
    };
}

export const subscribeFollowing = (name: string, callback: Listener) => subscribe('following', name, callback);
export const subscribeFriends = (name: string, callback: Listener) => subscribe('friends', name, callback);
export const getFollowing = () => lists.following;
export const isFollowing = (name: string) => lists.following.some(item => eq(item, name));
export const isFriend = (name: string) => lists.friends.some(item => eq(item, name));

function mutate(kind: ListKind, playerName: string, target: string, method: 'POST' | 'DELETE'): Promise<void> {
    const clean = target.trim();
    if (!clean) return Promise.reject(new Error('Enter a player name.'));
    selectOwner(playerName);
    const started = epoch;
    // Invalidate GETs both when queued and when committed, including reads that
    // begin while a mutation is in flight.
    revisions[kind]++;
    pending[kind]++;
    const operation = queues[kind].then(async () => {
        if (started !== epoch) throw new Error('Your account changed. Please try again.');
        const previous = lists[kind];
        const present = previous.some(item => eq(item, clean));
        if ((method === 'POST') === present) return;
        lists[kind] = method === 'POST' ? [...previous, clean] : previous.filter(item => !eq(item, clean));
        emit(kind);
        try {
            const response = await fetch('/api/player/friends', {
                method, headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ playerName, targetName: clean, ...(kind === 'friends' ? { list: kind } : {}) }),
            });
            const data = await response.json().catch(() => null) as Record<string, unknown> | null;
            if (started !== epoch) throw new Error('Your account changed. Please try again.');
            if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Could not update your social list. Try again.');
            if (!validList(data?.[kind])) throw new Error('Could not confirm your social list. Reconnect and try again.');
            lists[kind] = data[kind];
            emit(kind);
        } catch (error) {
            if (started === epoch) { lists[kind] = previous; emit(kind); }
            throw error instanceof Error ? error : new Error('Could not update your social list. Try again.');
        }
    }).finally(() => {
        if (started === epoch) { revisions[kind]++; pending[kind]--; }
    });
    queues[kind] = operation.catch(() => {});
    return operation;
}

export const follow = (player: string, target: string) => mutate('following', player, target, 'POST');
export const unfollow = (player: string, target: string) => mutate('following', player, target, 'DELETE');
export const addFriend = (player: string, target: string) => mutate('friends', player, target, 'POST');
export const removeFriend = (player: string, target: string) => mutate('friends', player, target, 'DELETE');

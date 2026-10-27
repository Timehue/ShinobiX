import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { addFriend, follow, getFollowing, refreshSocialLists, subscribeFollowing, subscribeFriends, unfollow } from './friends';

const originalFetch = globalThis.fetch;
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); globalThis.fetch = originalFetch; });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise(resolve => setImmediate(resolve));

test('same-list edits serialize, repeats coalesce, and a failed edit does not erase a later success', async () => {
    const first = deferred<Response>(); const requests: string[] = [];
    globalThis.fetch = async (_url, init) => {
        if (!init) return response({ following: [], friends: [] });
        const { targetName } = JSON.parse(String(init.body)); requests.push(targetName);
        return requests.length === 1 ? first.promise : response({ following: ['Second'] });
    };
    cleanups.push(subscribeFollowing('serial-player', () => {})); await refreshSocialLists();
    const failed = assert.rejects(follow('serial-player', 'First'), /offline/);
    const second = follow('serial-player', 'Second');
    const repeat = follow('serial-player', 'Second');
    await tick(); assert.deepEqual(requests, ['First']);
    first.resolve(response({ error: 'offline' }, 503));
    await Promise.all([failed, second, repeat]);
    assert.deepEqual(requests, ['First', 'Second']); assert.deepEqual(getFollowing(), ['Second']);
});

test('a delayed directory load cannot undo an accepted mutation', async () => {
    const read = deferred<Response>();
    globalThis.fetch = async (_url, init) => init ? response({ following: ['New'] }) : read.promise;
    cleanups.push(subscribeFollowing('late-read-player', () => {}));
    await follow('late-read-player', 'New'); read.resolve(response({ following: [], friends: [] }));
    await refreshSocialLists(); assert.deepEqual(getFollowing(), ['New']);
});

test('switching accounts clears immediately and rejects old responses even after switching back', async () => {
    const old = deferred<Response>();
    globalThis.fetch = async (_url, init) => init ? old.promise : response({ following: [], friends: [] });
    cleanups.push(subscribeFollowing('account-a', () => {})); await refreshSocialLists();
    const mutation = assert.rejects(follow('account-a', 'PrivateFriend'), /account changed/);
    await tick();
    const observed: string[][] = [];
    cleanups.push(subscribeFollowing('account-b', list => observed.push([...list])));
    assert.deepEqual(observed[0], []);
    cleanups.push(subscribeFollowing('account-a', () => {})); await refreshSocialLists();
    old.resolve(response({ following: ['PrivateFriend'] })); await mutation;
    assert.deepEqual(getFollowing(), []);
    assert.ok(observed.every(list => list.length === 0));
});

test('malformed acknowledgements roll back and a reconnect refresh recovers server membership', async () => {
    let stored = false;
    globalThis.fetch = async (_url, init) => {
        if (init) { stored = true; return response({ ok: true }); }
        return response({ following: stored ? ['Accepted'] : [], friends: [] });
    };
    cleanups.push(subscribeFollowing('reconnect-player', () => {})); await refreshSocialLists();
    await assert.rejects(follow('reconnect-player', 'Accepted'), /confirm/);
    assert.deepEqual(getFollowing(), []);
    await refreshSocialLists(); assert.deepEqual(getFollowing(), ['Accepted']);
});

test('follow then unfollow preserves click order and case-insensitive membership', async () => {
    const methods: string[] = [];
    globalThis.fetch = async (_url, init) => {
        if (!init) return response({ following: [], friends: [] });
        methods.push(init.method!); return response({ following: init.method === 'POST' ? ['Rival'] : [] });
    };
    cleanups.push(subscribeFollowing('ordered-player', () => {})); await refreshSocialLists();
    await Promise.all([follow('ordered-player', 'Rival'), unfollow('ordered-player', 'rival')]);
    assert.deepEqual(methods, ['POST', 'DELETE']); assert.deepEqual(getFollowing(), []);
});

test('Friends keeps canonical names from the server and validates acknowledgements', async () => {
    let list: string[] = []; let count = 0;
    globalThis.fetch = async (_url, init) => {
        if (!init) return response({ following: [], friends: [] });
        count++; return response(count === 1 ? { friends: ['CanonicalName'] } : { friends: [123] });
    };
    cleanups.push(subscribeFriends('friends-player', next => { list = next; })); await refreshSocialLists();
    await addFriend('friends-player', 'Display Alias'); assert.deepEqual(list, ['CanonicalName']);
    await assert.rejects(addFriend('friends-player', 'Other'), /confirm/);
    assert.deepEqual(list, ['CanonicalName']);
});

test('returning to the same account refreshes changes made while the social screen was closed', async () => {
    let following = ['Before']; let reads = 0;
    globalThis.fetch = async () => { reads++; return response({ following, friends: [] }); };
    const leave = subscribeFollowing('returning-player', () => {});
    cleanups.push(leave); await refreshSocialLists(); leave();
    following = ['ChangedElsewhere'];
    let visible: string[] = [];
    cleanups.push(subscribeFollowing('returning-player', list => { visible = list; }));
    await tick();
    assert.equal(reads, 2, 'a remount must revalidate the cached server list');
    assert.deepEqual(visible, ['ChangedElsewhere']);
});

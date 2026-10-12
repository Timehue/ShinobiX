import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_SUBSCRIBE_EVENT, CHAT_UNSUBSCRIBE_EVENT, chatPushRoom } from '../../shared/chat-push.js';

// The one ordering a real socket can't pin deterministically: an unsubscribe
// that lands while the subscribe's membership read is still in flight must
// not be undone by the late join.

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let wireChatRooms: typeof import('./chat-rooms.js').wireChatRooms;

before(async () => {
    const { kv } = await import('../_storage.js');
    await kv.set('save:raceplayer', { _saveVersion: 1, character: { name: 'raceplayer', village: 'Frostfang Village' } });
    ({ wireChatRooms } = await import('./chat-rooms.js'));
});

function fakeSocket() {
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    const rooms = new Set<string>();
    const socket = {
        data: { name: 'raceplayer' },
        connected: true,
        on: (event: string, fn: (...args: unknown[]) => unknown) => { handlers.set(event, fn); },
        join: (room: string) => { rooms.add(room); },
        leave: (room: string) => { rooms.delete(room); },
    };
    wireChatRooms(socket as never);
    return { handlers, rooms };
}

test('an unsubscribe during the membership check wins over the late join', async () => {
    const { handlers, rooms } = fakeSocket();
    const replies: unknown[] = [];
    const request = { channel: 'village', key: 'Frostfang Village' };
    const pending = handlers.get(CHAT_SUBSCRIBE_EVENT)!(request, (r: unknown) => replies.push(r));
    handlers.get(CHAT_UNSUBSCRIBE_EVENT)!(request);
    await pending;
    assert.deepEqual([...replies], [{ ok: false, reason: 'unavailable' }]);
    assert.equal(rooms.size, 0);

    // A fresh subscribe after that is unaffected.
    await handlers.get(CHAT_SUBSCRIBE_EVENT)!(request, (r: unknown) => replies.push(r));
    assert.deepEqual(replies[1], { ok: true });
    assert.deepEqual([...rooms], [chatPushRoom('village', 'frostfang-village')]);
});

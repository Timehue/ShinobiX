import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chatPushRoom, chatPushSlug, clanChatSlug, parseChatPush, parseChatPushRequest, villageChatSlug } from './chat-push.js';
import { clanBareSlug } from '../api/_utils.js';

describe('chat push rooms', () => {
    it('name the same room as the chat storage keys', () => {
        // api/village/chat.ts chatKey and api/_announce.ts build the tavern key
        // with exactly this rule; a drift would send hints to an empty room.
        for (const village of ['Stormveil Village', 'Ashen Leaf Village', 'Frostfang', 'Moon  shadow']) {
            assert.equal(`chat:village:${villageChatSlug(village)}`, `chat:village:${village.toLowerCase().replace(/\s+/g, '-')}`);
        }
        for (const clan of ['Storm Clan', ' Ash-Leaf  Clan! ', 'x']) assert.equal(clanChatSlug(clan), clanBareSlug(clan));
        assert.equal(chatPushSlug('village', '  Frostfang Village '), 'frostfang-village');
        assert.equal(chatPushRoom('clan', 'stormclan'), 'chat-push:clan:stormclan');
    });

    it('accept only a known channel and a bounded, usable name', () => {
        assert.deepEqual(parseChatPushRequest({ channel: 'village', key: ' Frostfang Village ' }),
            { channel: 'village', name: 'Frostfang Village', slug: 'frostfang-village' });
        for (const bad of [null, 'village', { channel: 'sector', key: 'x' }, { channel: 'clan', key: 7 },
            { channel: 'clan', key: '   ' }, { channel: 'clan', key: '!!!' }, { channel: 'village', key: 'x'.repeat(81) }]) {
            assert.equal(parseChatPushRequest(bad), null, JSON.stringify(bad));
        }
        assert.deepEqual(parseChatPush({ channel: 'clan', key: 'stormclan', ts: 5 }), { channel: 'clan', key: 'stormclan', ts: 5 });
        assert.deepEqual(parseChatPush({ channel: 'clan', key: 'stormclan' }), { channel: 'clan', key: 'stormclan', ts: 0 });
        assert.equal(parseChatPush({ channel: 'sector', key: 'x' }), null);
    });
});

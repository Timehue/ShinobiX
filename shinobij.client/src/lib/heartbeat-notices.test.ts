import { beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyHeartbeatNotices, exchangeSaleMessage, resetSaleNotificationSession } from './heartbeat-notices';
import { heartbeatNoticeAckFields, noteHeartbeatDelivery, resetNoticeAckState } from './notice-ack';
import type { Character } from '../types/character';
import type { ExchangeCurrency } from '../../../shared/sunscar-exchange';

const notice = (currency: ExchangeCurrency = 'fateShards', digit = 'a') => ({ kind: 'exchange-sale', by: 'buyer', sector: 0, at: 100, id: `sale-${digit}`, sale: {
    listingId: digit.repeat(32), seller: 'seller', assetName: 'Chromatic Sunrunner', quantity: 1, currency, price: 201, fee: 10, proceeds: 191,
} });
const character = { name: 'Seller', ryo: 10000, fateShards: 291 } as Character;
const store = new Map<string, string>();
const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
const fetchSave = async () => new Response(JSON.stringify({ character, _saveVersion: 7 }), { status: 200 });
beforeEach(() => { resetNoticeAckState(); resetSaleNotificationSession(); store.clear(); });

it('refreshes the authoritative wallet before announcing exact net proceeds', async () => {
    const events: string[] = [];
    noteHeartbeatDelivery({ pendingNotices: [notice()] });
    assert.equal(await applyHeartbeatNotices([notice()], { accountKey: 'Seller', isCurrent: () => true, visible: () => true, storage,
        fetch: async (url) => { assert.equal(url, '/api/save/seller'); events.push('fetch'); return fetchSave(); },
        commit: (next, version) => { assert.equal(next.fateShards, 291); assert.equal(version, 7); events.push('commit'); return true; },
        toast: message => { assert.match(message, /Chromatic Sunrunner sold.*191 Fate Shards after the 5% fee/); events.push('toast'); },
    }), 1);
    assert.deepEqual(events, ['fetch', 'commit', 'toast']);
    assert.deepEqual(heartbeatNoticeAckFields().ackNotices, ['sale-a']);
});

it('deduplicates redelivery and page reload by listing identity without re-reading the save', async () => {
    let reads = 0, toasts = 0;
    const options = { accountKey: 'seller', isCurrent: () => true, visible: () => true, storage,
        fetch: async () => { reads++; return fetchSave(); }, commit: () => true, toast: () => { toasts++; } };
    await applyHeartbeatNotices([notice(), notice()], options);
    await applyHeartbeatNotices([notice()], options);
    resetSaleNotificationSession(); resetNoticeAckState();
    await applyHeartbeatNotices([notice()], options);
    assert.equal(toasts, 1); assert.equal(reads, 1);
});

it('defers hidden-tab feedback and acknowledgement until the player returns', async () => {
    let reads = 0, toasts = 0;
    const options = { accountKey: 'seller', isCurrent: () => true, storage,
        fetch: async () => { reads++; return fetchSave(); }, commit: () => true, toast: () => { toasts++; } };
    noteHeartbeatDelivery({ pendingNotices: [notice()] });
    await applyHeartbeatNotices([notice()], { ...options, visible: () => false });
    assert.equal(reads, 0); assert.equal(toasts, 0); assert.deepEqual(heartbeatNoticeAckFields().ackNotices, []);
    noteHeartbeatDelivery({ pendingNotices: [notice()] });
    await applyHeartbeatNotices([notice()], { ...options, visible: () => true });
    assert.equal(toasts, 1); assert.deepEqual(heartbeatNoticeAckFields().ackNotices, ['sale-a']);
});

for (const failure of ['network', 'status', 'version', 'account', 'hidden-after-read', 'wrong-save']) it(`withholds acknowledgement and retries after ${failure}`, async () => {
    let current = true, visible = true, toasts = 0;
    const options = { accountKey: 'seller', isCurrent: () => current, visible: () => visible, storage, toast: () => { toasts++; } };
    noteHeartbeatDelivery({ pendingNotices: [notice()] });
    await applyHeartbeatNotices([notice()], { ...options,
        fetch: async () => {
            if (failure === 'network') throw new Error('offline');
            if (failure === 'status') return new Response('{}', { status: 503 });
            if (failure === 'account') current = false;
            if (failure === 'hidden-after-read') visible = false;
            if (failure === 'wrong-save') return new Response(JSON.stringify({ character: { ...character, name: 'SomeoneElse' }, _saveVersion: 8 }));
            return fetchSave();
        }, commit: () => failure !== 'version',
    });
    assert.equal(toasts, 0); assert.deepEqual(heartbeatNoticeAckFields().ackNotices, []);
    current = true; visible = true;
    await applyHeartbeatNotices([notice()], { ...options, fetch: fetchSave, commit: () => true });
    assert.equal(toasts, 1);
});

it('groups offline sales across both currencies into one receipt without hiding other notices', async () => {
    const messages: string[] = [], reports: string[] = [];
    const count = await applyHeartbeatNotices([notice(), notice('ryo', 'b'), { kind: 'merc-raid', by: 'Bandits', sector: 9, at: 2, id: 'raid' }], {
        accountKey: 'seller', isCurrent: () => true, visible: () => true, storage, fetch: fetchSave, commit: () => true,
        toast: message => messages.push(message), showOther: message => reports.push(message),
    });
    assert.equal(count, 3); assert.equal(messages.length, 1); assert.equal(reports.length, 1);
    assert.match(messages[0], /2 listings sold.*191 ryo and 191 Fate Shards after fees/);
    assert.match(reports[0], /Bandits raided/);
    assert.match(exchangeSaleMessage([notice('ryo').sale]), /191 ryo after the 5% fee/);
});

it('does not accept malformed or foreign-account sale receipts', async () => {
    const notices = [notice(), { ...notice(), id: 'bad', sale: { ...notice().sale, fee: 0 } }];
    noteHeartbeatDelivery({ pendingNotices: notices });
    const count = await applyHeartbeatNotices(notices, { accountKey: 'different', isCurrent: () => true, visible: () => true, storage,
        fetch: async () => { throw new Error('must not fetch'); }, commit: () => false, toast: () => assert.fail('must not toast') });
    assert.equal(count, 0); assert.deepEqual(heartbeatNoticeAckFields().ackNotices, []);
});

it('is wired into the global heartbeat with the current-account guard and versioned save commit', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
    assert.match(app, /await import\("\.\/lib\/heartbeat-notices"\).*applyHeartbeatNotices\(notices, \{ accountKey: heartbeatAccountKey, isCurrent: heartbeatIsCurrent, commit: commitVersionedCharacter \}/);
});

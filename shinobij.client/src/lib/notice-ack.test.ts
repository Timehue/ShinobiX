import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
    heartbeatNoticeAckFields,
    noteHeartbeatDelivery,
    noticeIdsOf,
    resetNoticeAckState,
    takeUnseenNotices,
    withholdNoticeAck,
} from './notice-ack';
import { applyOfflineNotices } from './offline-notices';

beforeEach(() => resetNoticeAckState());

test('every beat declares the protocol, and acknowledges exactly the latest delivery', () => {
    assert.deepEqual(heartbeatNoticeAckFields(), { noticeAck: true, exchangeSaleNotices: true, ackNotices: [] });

    noteHeartbeatDelivery({
        pendingHeal: { by: 'Medic', id: '1757138402000' },
        pendingNotices: [{ kind: 'sleeper-kill', by: 'A', sector: 1, at: 1, id: 'n1' }, { kind: 'merc-raid', by: 'B', sector: 2, at: 2, id: 'n2' }],
    });
    assert.deepEqual(heartbeatNoticeAckFields(), { noticeAck: true, exchangeSaleNotices: true, ackNotices: ['n1', 'n2'], ackHeal: 1757138402000 });

    // The next response carried nothing: the acks stop, they do not accumulate.
    noteHeartbeatDelivery({ pendingHeal: null });
    assert.deepEqual(heartbeatNoticeAckFields(), { noticeAck: true, exchangeSaleNotices: true, ackNotices: [] });

    // A legacy server (no ids) yields nothing to acknowledge.
    noteHeartbeatDelivery({ pendingHeal: { by: 'Medic' }, pendingNotices: [{ kind: 'sleeper-kill', by: 'A', sector: 1, at: 1 }] });
    assert.deepEqual(heartbeatNoticeAckFields(), { noticeAck: true, exchangeSaleNotices: true, ackNotices: [] });
});

test('a delivery that could not be shown is withheld from the next ack, and nothing else is', () => {
    // App withholds a delivery when the chunk holding the notice copy fails to
    // load. Acknowledging it anyway would make the server drop reports the
    // player never saw; the server re-sends anything left unacknowledged.
    const delivery = {
        pendingHeal: { by: 'Medic', id: '1757138402000' },
        pendingNotices: [{ kind: 'merc-raid', by: 'B', sector: 2, at: 2, id: 'n1' }, { kind: 'sleeper-kill', by: 'A', sector: 1, at: 1, id: 'n2' }],
    };
    noteHeartbeatDelivery(delivery);
    withholdNoticeAck([delivery.pendingNotices[0]]);
    assert.deepEqual(heartbeatNoticeAckFields(), { noticeAck: true, exchangeSaleNotices: true, ackNotices: ['n2'], ackHeal: 1757138402000 }, 'the heal and the other notice are still acknowledged');

    withholdNoticeAck(delivery.pendingNotices);
    assert.deepEqual(heartbeatNoticeAckFields(), { noticeAck: true, exchangeSaleNotices: true, ackNotices: [], ackHeal: 1757138402000 });

    // Junk and unknown ids change nothing.
    noteHeartbeatDelivery(delivery);
    withholdNoticeAck('nope');
    withholdNoticeAck([{ id: 'someone-else' }, { kind: 'merc-raid' }]);
    assert.deepEqual(heartbeatNoticeAckFields().ackNotices, ['n1', 'n2']);

    // The re-delivery is acknowledged normally once it can be shown.
    withholdNoticeAck(delivery.pendingNotices);
    noteHeartbeatDelivery(delivery);
    assert.deepEqual(heartbeatNoticeAckFields().ackNotices, ['n1', 'n2']);
});

test('noticeIdsOf keeps only string ids, once each', () => {
    assert.deepEqual(noticeIdsOf([{ id: 'a' }, { id: 'a' }, { id: 7 }, null, 'x', { id: '' }]), ['a']);
    assert.deepEqual(noticeIdsOf('nope'), []);
});

test('a re-delivered notice is shown once per session; id-less notices are always fresh', () => {
    const inbox = [
        { kind: 'sleeper-kill', by: 'Raider', sector: 7, at: 1, id: 'n1' },
        { kind: 'bounty-placed', by: 'Rival', sector: 0, at: 2, amount: 500, total: 500, id: 'n2' },
    ];
    assert.equal(takeUnseenNotices(inbox).length, 2);
    assert.equal(takeUnseenNotices(inbox).length, 0, 'the same ids again are not fresh');
    assert.equal(takeUnseenNotices([{ kind: 'merc-raid', by: 'M', sector: 3, at: 3 }]).length, 1, 'no id → always fresh');
    assert.equal(takeUnseenNotices([{ kind: 'merc-raid', by: 'M', sector: 3, at: 3 }]).length, 1);
});

test('the digest itself dedupes a lost-response re-delivery', () => {
    const shown: string[] = [];
    const inbox = [{ kind: 'sleeper-kill', by: 'Raider', sector: 7, at: Date.now(), id: 'dup-1' }];
    assert.equal(applyOfflineNotices(inbox, (m) => shown.push(m)), 1);
    assert.equal(applyOfflineNotices(inbox, (m) => shown.push(m)), 0, 'the same report is not shown twice');
    assert.equal(shown.length, 1);
});

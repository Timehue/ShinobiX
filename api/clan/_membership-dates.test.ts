import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateClanSaveWrite } from '../_clan-save-validate.js';

const founder = { callerName: 'akira', isAdmin: false };
const old = { name: 'Azure', village: 'Leaf', founderName: 'Akira', createdAt: Date.now() - 10 * 86_400_000,
    members: [{ name: 'Akira', isFounder: true }, { name: 'Rei' }] };

test('a new clan cannot backdate its server age while preserving its legacy display date', () => {
    const before = Date.now();
    const { next } = validateClanSaveWrite(null, { ...old, serverCreatedAt: 1, memberJoinedAt: { akira: 1 } }, founder);
    assert.ok(Number(next.serverCreatedAt) >= before);
    assert.ok(Number(next.memberJoinedAt?.akira) >= before);
    assert.equal(next.createdAt, old.createdAt);
});

test('existing members retain grandfathered dates but new members receive an unforgeable join stamp', () => {
    const before = Date.now();
    const { next } = validateClanSaveWrite(old, { ...old, members: [...old.members, { name: 'Newcomer' }],
        serverCreatedAt: 1, memberJoinedAt: { newcomer: 1, akira: 1 } }, founder);
    assert.equal(next.serverCreatedAt, old.createdAt);
    assert.equal(next.memberJoinedAt?.akira, old.createdAt);
    assert.equal(next.memberJoinedAt?.rei, old.createdAt);
    assert.ok(Number(next.memberJoinedAt?.newcomer) >= before);
    const stamped = validateClanSaveWrite(next, { ...next, memberJoinedAt: { newcomer: 1 }, serverCreatedAt: 1 }, founder).next;
    assert.deepEqual(stamped.memberJoinedAt, next.memberJoinedAt);
    assert.equal(stamped.serverCreatedAt, next.serverCreatedAt);
});

test('a removed member loses the membership stamp and cannot recover their old age on rejoin', () => {
    const stamped = validateClanSaveWrite(old, old, founder).next;
    const removed = validateClanSaveWrite(stamped, { ...stamped, members: [{ name: 'Akira' }] }, founder).next;
    assert.equal(removed.memberJoinedAt?.rei, undefined);
    const before = Date.now();
    const returned = validateClanSaveWrite(removed, { ...removed, members: old.members,
        memberJoinedAt: { rei: old.createdAt } }, founder).next;
    assert.ok(Number(returned.memberJoinedAt?.rei) >= before);
});

test('a scalar roster cannot erase authoritative members or their eligibility dates', () => {
    const stamped = validateClanSaveWrite(old, old, founder).next;
    const result = validateClanSaveWrite(stamped, { ...stamped, members: null } as unknown as Parameters<typeof validateClanSaveWrite>[1], founder);
    assert.deepEqual(result.next.members, stamped.members);
    assert.deepEqual(result.next.memberJoinedAt, stamped.memberJoinedAt);
    assert.ok(result.suppressed.includes('invalid members roster'));
});

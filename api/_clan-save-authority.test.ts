import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateClanSaveWrite } from './_clan-save-validate.js';

const member = { callerName: 'akira', isAdmin: false };
const founder = { callerName: 'kaze', isAdmin: false };
const admin = { callerName: '', isAdmin: true };
const clan = {
    name: 'Storm', founderName: 'Kaze', doctrine: 'none',
    members: [{ name: 'Kaze' }, { name: 'Akira' }, { name: 'Rei' }],
    roleOverrides: { Rei: 'Officer' },
    upgrades: { trainingGrounds: 2, warRoom: 1 },
};

function incoming(fields: Record<string, unknown>) {
    return fields as Parameters<typeof validateClanSaveWrite>[1];
}

describe('clan save appointed-role authority', () => {
    for (const role of ['Leader', 'Officer', 'Founder']) {
        it(`does not let an ordinary member appoint themselves ${role}`, () => {
            const { next } = validateClanSaveWrite(clan, {
                ...clan, roleOverrides: { ...clan.roleOverrides, akira: role },
            }, member);
            assert.deepEqual(next.roleOverrides, clan.roleOverrides);
        });
    }

    it('does not let an appointed officer promote themselves', () => {
        const previous = { ...clan, roleOverrides: { ...clan.roleOverrides, akira: 'Officer' } };
        const { next } = validateClanSaveWrite(previous, {
            ...previous, roleOverrides: { ...previous.roleOverrides, akira: 'Leader' },
        }, member);
        assert.deepEqual(next.roleOverrides, previous.roleOverrides);
    });

    it('retains a member self-clear while preserving every other appointment', () => {
        const previous = { ...clan, roleOverrides: { ...clan.roleOverrides, akira: 'Officer' } };
        const { next } = validateClanSaveWrite(previous, { ...previous, roleOverrides: {} }, member);
        assert.deepEqual(next.roleOverrides, clan.roleOverrides);
    });

    it('lets a member clear only their own role with an explicit null entry', () => {
        const previous = { ...clan, roleOverrides: { ...clan.roleOverrides, akira: 'Officer' } };
        const { next } = validateClanSaveWrite(previous, incoming({
            ...previous, roleOverrides: { Rei: 'Leader', akira: null },
        }), member);
        assert.deepEqual(next.roleOverrides, clan.roleOverrides);
    });

    it('recognizes a multi-word member when they clear their own appointment', () => {
        const previous = { ...clan, roleOverrides: { ...clan.roleOverrides, 'Aka Ito': 'Officer' } };
        const { next } = validateClanSaveWrite(previous, { ...previous, roleOverrides: {} }, {
            callerName: 'akaito', isAdmin: false,
        });
        assert.deepEqual(next.roleOverrides, clan.roleOverrides);
    });

    for (const value of [null, 'Leader', []]) {
        it(`does not let a malformed whole role map erase appointments: ${JSON.stringify(value)}`, () => {
            const { next } = validateClanSaveWrite(clan, incoming({ ...clan, roleOverrides: value }), member);
            assert.deepEqual(next.roleOverrides, clan.roleOverrides);
        });
    }

    it('does not interpret an omitted role map in a partial save as a self-clear', () => {
        const previous = { ...clan, roleOverrides: { ...clan.roleOverrides, akira: 'Officer' } };
        const { next } = validateClanSaveWrite(previous, { image: 'new-clan-art' }, member);
        assert.deepEqual(next.roleOverrides, previous.roleOverrides);
    });

    it('keeps the canonical founder able to appoint and demote members', () => {
        const appointed = validateClanSaveWrite(clan, { ...clan, roleOverrides: { Akira: 'Leader', Rei: 'Officer' } }, founder).next;
        assert.deepEqual(appointed.roleOverrides, { Akira: 'Leader', Rei: 'Officer' });
        const demoted = validateClanSaveWrite(appointed, { ...appointed, roleOverrides: { Rei: 'Officer' } }, founder).next;
        assert.deepEqual(demoted.roleOverrides, clan.roleOverrides);
    });

    it('a stored noncanonical Founder override cannot confer founder or leadership authority', () => {
        const previous = { ...clan, roleOverrides: { ...clan.roleOverrides, akira: 'Founder' } };
        const { next } = validateClanSaveWrite(previous, {
            ...previous,
            doctrine: 'warmonger',
            roleOverrides: { ...previous.roleOverrides, Rei: 'Leader' },
            recruitment: 'Unauthorized recruitment change',
        }, member);
        assert.equal(next.doctrine, clan.doctrine);
        assert.equal(next.roleOverrides?.Rei, 'Officer');
        assert.equal(next.recruitment, undefined);
    });

    it('preserves explicit admin role administration', () => {
        const { next } = validateClanSaveWrite(clan, { ...clan, roleOverrides: { Akira: 'Officer' } }, admin);
        assert.deepEqual(next.roleOverrides, { Akira: 'Officer' });
        assert.equal(validateClanSaveWrite(clan, incoming({ ...clan, roleOverrides: null }), admin).next.roleOverrides, null);
    });
});

describe('clan upgrades are purchased by the server', () => {
    for (const context of [member, founder]) {
        it(`rejects free upgrades by ${context.callerName}`, () => {
            const { next } = validateClanSaveWrite(clan, { ...clan, upgrades: { trainingGrounds: 50, warRoom: 50 } }, context);
            assert.deepEqual(next.upgrades, clan.upgrades);
        });
    }

    it('preserves a completed purchase when an older Clan Hall snapshot saves', () => {
        const current = { ...clan, upgrades: { ...clan.upgrades, trainingGrounds: 3 } };
        const { next } = validateClanSaveWrite(current, clan, founder);
        assert.deepEqual(next.upgrades, current.upgrades);
    });

    for (const value of [null, {}, [], 'max']) {
        it(`cannot erase purchased upgrades with ${JSON.stringify(value)}`, () => {
            assert.deepEqual(validateClanSaveWrite(clan, incoming({ ...clan, upgrades: value }), member).next.upgrades, clan.upgrades);
        });
    }

    it('preserves upgrades when a partial save omits them', () => {
        assert.deepEqual(validateClanSaveWrite(clan, { image: 'new-clan-art' }, member).next.upgrades, clan.upgrades);
    });

    it('creates a legitimate clan without granting any purchased buildings', () => {
        const { next } = validateClanSaveWrite(null, {
            name: 'New Storm', founderName: 'Akira', members: [{ name: 'Akira', isFounder: true }],
            upgrades: { trainingGrounds: 50, warRoom: 50 }, roleOverrides: {},
        }, member);
        assert.equal(next.founderName, 'Akira');
        assert.deepEqual(next.members, [{ name: 'Akira', isFounder: true }]);
        assert.equal(Object.values(next.upgrades ?? {}).some((level) => level !== 0), false);
    });

    it('accepts bootstrap zero-level defaults without inventing a cost or purchased level', () => {
        const { next } = validateClanSaveWrite(null, {
            name: 'New Storm', founderName: 'Akira', upgrades: { trainingGrounds: 0, warRoom: 0 },
        }, member);
        assert.equal(next.founderName, 'Akira');
        assert.equal(Number(next.upgrades?.trainingGrounds ?? 0), 0);
        assert.equal(Number(next.upgrades?.warRoom ?? 0), 0);
    });

    it('preserves explicit admin upgrade corrections and bootstrap', () => {
        const upgrades = { trainingGrounds: 5, warRoom: 8 };
        assert.deepEqual(validateClanSaveWrite(clan, { ...clan, upgrades }, admin).next.upgrades, upgrades);
        assert.deepEqual(validateClanSaveWrite(null, { name: 'New Storm', founderName: 'Akira', upgrades }, admin).next.upgrades, upgrades);
        assert.equal(validateClanSaveWrite(clan, incoming({ ...clan, upgrades: null }), admin).next.upgrades, null);
    });
});

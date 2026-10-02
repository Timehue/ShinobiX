/**
 * Settling a finished world PvP duel onto both fighters' saves
 * (settlePvpTerminalVitals in api/pvp/_vitals-settlement.ts).
 *
 * Each fighter's vitals and their receipt commit through mutatePlayerSave, so
 * these run against the global in-memory KV the shared writer uses. The
 * pure helpers are covered in _vitals-settlement.test.ts.
 */
import { after, before, beforeEach, describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import type { PvpFighter, PvpSession } from './session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

type Row = Record<string, unknown> & { character: Record<string, unknown>; _saveVersion?: number };

const NOW = 1_700_000_000_000;

let kv: typeof import('../_storage.js').kv;
let vitals: typeof import('./_vitals-settlement.js');

before(async () => {
    ({ kv } = await import('../_storage.js'));
    vitals = await import('./_vitals-settlement.js');
});

beforeEach(async () => {
    for (const pattern of ['save:rill', 'save:dopey', 'pvp:vitals:*', 'lock:*']) {
        for (const key of await kv.keys(pattern)) await kv.del(key);
    }
});

after(() => {
    delete process.env.SHINOBIX_QA_MEMORY_KV;
});

function fighter(name: string, over: Partial<PvpFighter> = {}): PvpFighter {
    return {
        name,
        hp: 50, maxHp: 100,
        chakra: 20, maxChakra: 50,
        stamina: 30, maxStamina: 60,
        shield: 0,
        statuses: [],
        character: {},
        pos: 0,
        ...over,
    };
}

function session(over: Partial<PvpSession> = {}): PvpSession {
    return {
        battleId: 'pvp-vitals-1',
        p1: fighter('Rill'),
        p2: fighter('Dopey'),
        round: 3,
        activePlayer: 'p1',
        ap: { p1: 100, p2: 100 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: [],
        status: 'done',
        winner: 'p1',
        continuousVitals: true,
        rewardAuthority: 'world',
        ...over,
    } as PvpSession;
}

function save(over: Record<string, unknown> = {}) {
    return {
        _saveVersion: 7,
        character: {
            name: 'Rill',
            hp: 100, maxHp: 100,
            chakra: 50, maxChakra: 50,
            stamina: 60, maxStamina: 60,
            ...over,
        },
    };
}

async function row(name: string): Promise<Row> {
    return (await kv.get<Row>(`save:${name}`))!;
}

/** Make the next compare-and-set of this save throw without committing. */
async function failingOnce<T>(saveKey: string, run: () => Promise<T>): Promise<T> {
    const original = kv.compareSet;
    let armed = true;
    kv.compareSet = async (key, expected, value, options) => {
        if (armed && key === saveKey) { armed = false; throw new Error('storage-down'); }
        return original.call(kv, key, expected, value, options);
    };
    try {
        return await run();
    } finally {
        kv.compareSet = original;
    }
}

describe('settlePvpTerminalVitals', { concurrency: false }, () => {
    const deps = (now = NOW) => ({ now });

    it('writes both fighters and bumps each save version', async () => {
        await kv.set('save:rill', save({ name: 'Rill', hp: 100 }));
        await kv.set('save:dopey', save({ name: 'Dopey', hp: 100 }));
        const s = session({
            p1: fighter('Rill', { hp: 42, chakra: 9, stamina: 4 }),
            p2: fighter('Dopey', { hp: 0 }),
            winner: 'p1',
        });

        await vitals.settlePvpTerminalVitals(kv, s, deps());

        const winner = await row('rill');
        const loser = await row('dopey');
        assert.equal(winner.character.hp, 42, 'winner keeps the damage he took');
        assert.equal(winner.character.hospitalized, undefined);
        assert.equal(loser.character.hp, 0);
        assert.equal(loser.character.hospitalized, true);
        assert.ok(Number(winner._saveVersion) > 7, 'winner save version bumped');
        assert.ok(Number(loser._saveVersion) > 7, 'loser save version bumped');
    });

    it('does nothing for a spar, which reset both fighters on entry', async () => {
        await kv.set('save:rill', save({ name: 'Rill', hp: 100 }));
        const s = session({
            p1: fighter('Rill', { hp: 3 }),
            winner: 'p2',
            continuousVitals: false,
            rewardAuthority: 'challenge',
        });

        await vitals.settlePvpTerminalVitals(kv, s, deps());

        const rill = await row('rill');
        assert.equal(rill.character.hp, 100, 'untouched');
        assert.equal(rill._saveVersion, 7, 'no version bump');
    });

    it('does nothing while the battle is still live', async () => {
        await kv.set('save:rill', save({ name: 'Rill', hp: 100 }));
        await vitals.settlePvpTerminalVitals(kv, session({ status: 'active', winner: null }), deps());
        assert.equal((await row('rill')).character.hp, 100);
    });

    it('is a no-op on replay AFTER the player has healed', async () => {
        // The load-bearing one. PvP reward completion legitimately replays the
        // terminal session for up to 48h, which spans a hospital discharge and
        // another fight. The frozen session would happily re-admit a healed
        // player; the per-fighter receipt is what stops it.
        await kv.set('save:dopey', save({ name: 'Dopey', hp: 100 }));
        const s = session({ p1: fighter('Rill'), p2: fighter('Dopey', { hp: 0 }), winner: 'p1' });

        await vitals.settlePvpTerminalVitals(kv, s, deps());
        assert.equal((await row('dopey')).character.hospitalized, true);

        // Discharged at the Hospital, back to full.
        const admitted = await row('dopey');
        await kv.set('save:dopey', { ...admitted, character: { ...admitted.character, hp: 100, hospitalized: false } });
        await vitals.settlePvpTerminalVitals(kv, s, deps(NOW + 3_600_000));

        const healed = await row('dopey');
        assert.equal(healed.character.hp, 100, 'replay must not re-KO a healed player');
        assert.equal(healed.character.hospitalized, false, 'replay must not re-admit');
    });

    it('records a receipt per fighter, keyed to the battle', async () => {
        await kv.set('save:rill', save({ name: 'Rill' }));
        await kv.set('save:dopey', save({ name: 'Dopey' }));
        const s = session();

        await vitals.settlePvpTerminalVitals(kv, s, deps());

        assert.ok(await kv.get(vitals.pvpVitalsReceiptKey(s.battleId, 'rill')));
        assert.ok(await kv.get(vitals.pvpVitalsReceiptKey(s.battleId, 'dopey')));
        // A DIFFERENT battle settles independently — the guard is per battle,
        // not a single "last settled" stamp that a later fight would clear.
        assert.equal(await kv.get(vitals.pvpVitalsReceiptKey('pvp-vitals-2', 'rill')), null);
    });

    it('a failed save write leaves no receipt anywhere, so the retry applies for real', async () => {
        await kv.set('save:rill', save({ name: 'Rill', hp: 100 }));
        const s = session({ p1: fighter('Rill', { hp: 11 }), p2: fighter('Ghost'), winner: 'p1' });

        await assert.rejects(() => failingOnce('save:rill', () => vitals.settlePvpTerminalVitals(kv, s, deps())), /storage-down/);
        const untouched = (await row('rill')).character;
        assert.equal(untouched.serverSettlementReceipts, undefined, 'no in-save receipt without the write');
        assert.equal(untouched.hp, 100);
        assert.equal(await kv.get(vitals.pvpVitalsReceiptKey(s.battleId, 'rill')), null, 'no compat marker without the write');

        await vitals.settlePvpTerminalVitals(kv, s, deps());
        assert.equal((await row('rill')).character.hp, 11);
    });

    it('a reply lost AFTER the save committed counts as settled, not as a failure', async () => {
        await kv.set('save:rill', save({ name: 'Rill', hp: 100 }));
        const s = session({ p1: fighter('Rill', { hp: 11 }), p2: fighter('Ghost'), winner: 'p1' });
        const original = kv.compareSet;
        let armed = true;
        kv.compareSet = async (key, expected, value, options) => {
            const result = await original.call(kv, key, expected, value, options);
            if (armed && key === 'save:rill') { armed = false; throw new Error('reply-lost'); }
            return result;
        };
        try {
            await vitals.settlePvpTerminalVitals(kv, s, deps());
        } finally {
            kv.compareSet = original;
        }
        assert.equal((await row('rill')).character.hp, 11);
        assert.ok(await kv.get(vitals.pvpVitalsReceiptKey(s.battleId, 'rill')), 'the compat marker follows the committed write');
    });

    it('writes the consequence and its proof in ONE save write — a crash after it cannot re-apply', async () => {
        // The old shape claimed a KV receipt BEFORE the save write; a process
        // death between the two left a standing claim over an unapplied
        // consequence. Now the receipt rides in the save itself.
        await kv.set('save:dopey', save({ name: 'Dopey', hp: 100 }));
        const s = session({ p1: fighter('Rill'), p2: fighter('Dopey', { hp: 0 }), winner: 'p1' });

        await vitals.settlePvpTerminalVitals(kv, s, deps());
        const settled = await row('dopey');
        const receipts = settled.character.serverSettlementReceipts as Array<{ value: Record<string, unknown> }>;
        assert.equal(settled.character.hospitalized, true);
        assert.equal(receipts?.[0]?.value?.kind, 'pvp-vitals', 'the proof lives in the same character snapshot');
        assert.equal(receipts?.[0]?.value?.battleId, s.battleId);

        // Simulate "process died after the save write, before the compat
        // marker": drop the marker, discharge the player, replay.
        await kv.del(vitals.pvpVitalsReceiptKey(s.battleId, 'dopey'));
        await kv.set('save:dopey', { ...settled, character: { ...settled.character, hp: 100, hospitalized: false } });
        await vitals.settlePvpTerminalVitals(kv, s, deps(NOW + 3_600_000));
        const healed = (await row('dopey')).character;
        assert.equal(healed.hp, 100, 'the in-save receipt alone stops the replay');
        assert.equal(healed.hospitalized, false);
    });

    it('skips a fighter with no save row, such as an NPC guard', async () => {
        await kv.set('save:rill', save({ name: 'Rill', hp: 100 }));
        const s = session({ p1: fighter('Rill', { hp: 25 }), p2: fighter('Village Guard'), winner: 'p1' });

        await vitals.settlePvpTerminalVitals(kv, s, deps());

        assert.equal((await row('rill')).character.hp, 25);
        assert.equal(await kv.get('save:village-guard'), null);
    });

    it('takes the two save locks one at a time, never held together', async () => {
        // Two players raiding each other concurrently: holding save:A while
        // waiting on save:B is the classic inverted-order deadlock.
        await kv.set('save:rill', save({ name: 'Rill' }));
        await kv.set('save:dopey', save({ name: 'Dopey' }));
        const originalSet = kv.set;
        const originalRelease = kv.delIfEqual;
        const held = new Set<string>();
        let maxHeld = 0;
        const order: string[] = [];
        kv.set = (async (key: string, value: unknown, options?: { nx?: boolean; ex?: number }) => {
            const result = await originalSet.call(kv, key, value, options);
            if (key.startsWith('lock:save:') && options?.nx && result) {
                order.push(key.slice('lock:'.length));
                held.add(key);
                maxHeld = Math.max(maxHeld, held.size);
            }
            return result;
        }) as typeof kv.set;
        kv.delIfEqual = (async (key: string, expected: unknown) => {
            held.delete(key);
            return originalRelease.call(kv, key, expected);
        }) as typeof kv.delIfEqual;
        try {
            await vitals.settlePvpTerminalVitals(kv, session(), deps());
        } finally {
            kv.set = originalSet;
            kv.delIfEqual = originalRelease;
        }
        assert.equal(maxHeld, 1, 'never holds two save locks at once');
        assert.deepEqual(order, ['save:rill', 'save:dopey']);
    });

    it('a replay of a settled fight takes no save lock and reads no save', async () => {
        // The finishing move settles vitals, then BOTH players' claims replay the
        // barrier. Each replay used to take the fail-closed save lock and read the
        // whole save just to find the marker; the marker alone answers it.
        await kv.set('save:rill', save({ name: 'Rill' }));
        await kv.set('save:dopey', save({ name: 'Dopey' }));
        await vitals.settlePvpTerminalVitals(kv, session(), deps());

        const originalGet = kv.get;
        const originalSet = kv.set;
        const saveReads: string[] = [];
        const locked: string[] = [];
        kv.get = (async (key: string) => {
            if (key.startsWith('save:')) saveReads.push(key);
            return originalGet.call(kv, key);
        }) as typeof kv.get;
        kv.set = (async (key: string, value: unknown, options?: unknown) => {
            if (key.startsWith('lock:')) locked.push(key);
            return originalSet.call(kv, key, value, options as never);
        }) as typeof kv.set;
        try {
            await vitals.settlePvpTerminalVitals(kv, session(), deps(NOW + 1_000));
        } finally {
            kv.get = originalGet;
            kv.set = originalSet;
        }
        assert.deepEqual(locked, []);
        assert.deepEqual(saveReads, []);
    });
});

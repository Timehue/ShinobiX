/**
 * Post-battle vitals + hospital admission for a world PvP duel
 * (api/pvp/_vitals-settlement.ts).
 *
 * The owner's rule, in one line: a knockout admits, losing admits — including
 * losing to the AFK/turn-deadline forfeit — and FLEEING is the one exit that
 * sends you back to your spot in the sector carrying your damage instead.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { _makeMemoryKv } from '../_storage.js';
import {
    PVP_HOSPITAL_DURATION_MS,
    applyPvpVitalsToCharacter,
    pvpFighterIsHospitalized,
    pvpSessionCarriesVitals,
    pvpVitalsReceiptKey,
    settlePvpTerminalVitals,
} from './_vitals-settlement.js';
import type { PvpFighter, PvpSession } from './session.js';

const NOW = 1_700_000_000_000;

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

describe('pvpSessionCarriesVitals', () => {
    it('settles a continuous engagement and leaves a fresh-start contest alone', () => {
        assert.equal(pvpSessionCarriesVitals(session({ continuousVitals: true })), true);
        // A spar/ranked/arena row reset both fighters to full on ENTRY, so
        // persisting its exit vitals would invent damage never charged.
        assert.equal(pvpSessionCarriesVitals(session({ continuousVitals: false, rewardAuthority: 'ranked' })), false);
    });

    it('falls back to world authority for rows sealed before the flag existed', () => {
        const legacy = session({ rewardAuthority: 'world' });
        delete (legacy as { continuousVitals?: boolean }).continuousVitals;
        assert.equal(pvpSessionCarriesVitals(legacy), true);

        const legacySpar = session({ rewardAuthority: 'challenge' });
        delete (legacySpar as { continuousVitals?: boolean }).continuousVitals;
        assert.equal(pvpSessionCarriesVitals(legacySpar), false, 'never guess a cost onto a legacy spar');
    });

    it('honours an explicit false even on a world row', () => {
        assert.equal(pvpSessionCarriesVitals(session({ continuousVitals: false })), false);
    });
});

describe('pvpFighterIsHospitalized', () => {
    it('admits a knocked-out fighter', () => {
        const s = session({ p2: fighter('Dopey', { hp: 0 }), winner: 'p1' });
        assert.equal(pvpFighterIsHospitalized(s, 'p2'), true);
    });

    it('admits the loser of a forfeit even at full HP', () => {
        // claim-afk-win / turn-deadline: the loser never dropped, they stopped
        // acting. This is how most abandoned duels actually end.
        const s = session({ p2: fighter('Dopey', { hp: 88 }), winner: 'p1' });
        assert.equal(pvpFighterIsHospitalized(s, 'p2'), true);
    });

    it('sends a fighter who FLED back to the sector, not the hospital', () => {
        const s = session({ p1: fighter('Rill', { hp: 40 }), winner: 'p2', fleedBy: 'p1' });
        assert.equal(pvpFighterIsHospitalized(s, 'p1'), false, 'fleeing already cost 10% max HP');
        assert.equal(pvpFighterIsHospitalized(s, 'p2'), false, 'the winner walks away');
    });

    it('still admits a fighter who fled at zero HP', () => {
        const s = session({ p1: fighter('Rill', { hp: 0 }), winner: 'p2', fleedBy: 'p1' });
        assert.equal(pvpFighterIsHospitalized(s, 'p1'), true, 'the knockout check is outcome-blind and comes first');
    });

    it('leaves the winner standing unless they also hit zero', () => {
        assert.equal(pvpFighterIsHospitalized(session({ winner: 'p1' }), 'p1'), false);
        // Mutual KO: a damage-over-time tick drops the winner on the same turn.
        const mutual = session({ p1: fighter('Rill', { hp: 0 }), p2: fighter('Dopey', { hp: 0 }), winner: 'p1' });
        assert.equal(pvpFighterIsHospitalized(mutual, 'p1'), true);
        assert.equal(pvpFighterIsHospitalized(mutual, 'p2'), true);
    });

    it('admits nobody on a draw fought to a standstill', () => {
        const s = session({ winner: 'draw' });
        assert.equal(pvpFighterIsHospitalized(s, 'p1'), false);
        assert.equal(pvpFighterIsHospitalized(s, 'p2'), false);
    });
});

describe('applyPvpVitalsToCharacter', () => {
    it('carries the survivor out at the vitals the fight left them', () => {
        const s = session({ p1: fighter('Rill', { hp: 37, chakra: 12, stamina: 5 }), winner: 'p1' });
        const next = applyPvpVitalsToCharacter(save().character, s, 'p1', NOW);
        assert.equal(next.hp, 37);
        assert.equal(next.chakra, 12);
        assert.equal(next.stamina, 5);
        assert.equal(next.hospitalized, undefined, 'a winner is not admitted');
    });

    it('admits a loser with the same 60s stay every other defeat path uses', () => {
        const s = session({ p2: fighter('Dopey', { hp: 0, chakra: 3, stamina: 1 }), winner: 'p1' });
        const next = applyPvpVitalsToCharacter(save({ name: 'Dopey' }).character, s, 'p2', NOW);
        assert.equal(next.hp, 0);
        assert.equal(next.hospitalized, true);
        assert.equal(next.hospitalizedAt, NOW);
        assert.equal(next.hospitalizedUntil, NOW + PVP_HOSPITAL_DURATION_MS);
        assert.equal(PVP_HOSPITAL_DURATION_MS, 60_000);
        assert.equal(next.chakra, 3, 'spent chakra is recorded either way');
    });

    it('clamps to the SAVE maxima, never the stale session ones', () => {
        // Session sealed before a level-down / gear change: its maxHp of 100 and
        // hp of 90 must not raise a save whose real ceiling is now 40.
        const s = session({ p1: fighter('Rill', { hp: 90, maxHp: 100, chakra: 44, stamina: 55 }), winner: 'p1' });
        const shrunk = save({ maxHp: 40, maxChakra: 10, maxStamina: 12 }).character;
        const next = applyPvpVitalsToCharacter(shrunk, s, 'p1', NOW);
        assert.equal(next.hp, 40);
        assert.equal(next.chakra, 10);
        assert.equal(next.stamina, 12);
    });

    it('leaves a fighter clinging on at exactly 1 HP on their feet', () => {
        const s = session({ p1: fighter('Rill', { hp: 1 }), winner: 'p1' });
        const next = applyPvpVitalsToCharacter(save().character, s, 'p1', NOW);
        assert.equal(next.hp, 1);
        assert.equal(next.hospitalized, undefined);
    });

    it('reads a sub-1 HP fraction as the knockout it is', () => {
        // Vitals are integral everywhere else, and both the admission check and
        // the write floor through the same num(). A fighter cannot end up
        // "alive at 0" because one of the two rounded differently.
        const s = session({ p1: fighter('Rill', { hp: 0.4 }), winner: 'p2' });
        assert.equal(pvpFighterIsHospitalized(s, 'p1'), true);
        const next = applyPvpVitalsToCharacter(save().character, s, 'p1', NOW);
        assert.equal(next.hp, 0);
        assert.equal(next.hospitalized, true);
    });

    it('preserves every unrelated character field', () => {
        const s = session({ winner: 'p1' });
        const next = applyPvpVitalsToCharacter(save({ ryo: 5_000, level: 22 }).character, s, 'p1', NOW);
        assert.equal(next.ryo, 5_000);
        assert.equal(next.level, 22);
        assert.equal(next.name, 'Rill');
    });
});

describe('settlePvpTerminalVitals', () => {
    function deps(now = NOW) {
        return { lock: <T>(_key: string, action: () => Promise<T>) => action(), now };
    }

    it('writes both fighters and bumps each save version', async () => {
        const store = _makeMemoryKv();
        await store.set('save:rill', save({ name: 'Rill', hp: 100 }));
        await store.set('save:dopey', save({ name: 'Dopey', hp: 100 }));
        const s = session({
            p1: fighter('Rill', { hp: 42, chakra: 9, stamina: 4 }),
            p2: fighter('Dopey', { hp: 0 }),
            winner: 'p1',
        });

        await settlePvpTerminalVitals(store, s, deps());

        const winner = (await store.get<Record<string, never>>('save:rill'))!;
        const loser = (await store.get<Record<string, never>>('save:dopey'))!;
        assert.equal((winner.character as Record<string, unknown>).hp, 42, 'winner keeps the damage he took');
        assert.equal((winner.character as Record<string, unknown>).hospitalized, undefined);
        assert.equal((loser.character as Record<string, unknown>).hp, 0);
        assert.equal((loser.character as Record<string, unknown>).hospitalized, true);
        assert.ok(Number(winner._saveVersion) > 7, 'winner save version bumped');
        assert.ok(Number(loser._saveVersion) > 7, 'loser save version bumped');
    });

    it('does nothing for a spar, which reset both fighters on entry', async () => {
        const store = _makeMemoryKv();
        await store.set('save:rill', save({ name: 'Rill', hp: 100 }));
        const s = session({
            p1: fighter('Rill', { hp: 3 }),
            winner: 'p2',
            continuousVitals: false,
            rewardAuthority: 'challenge',
        });

        await settlePvpTerminalVitals(store, s, deps());

        const row = (await store.get<Record<string, never>>('save:rill'))!;
        assert.equal((row.character as Record<string, unknown>).hp, 100, 'untouched');
        assert.equal(row._saveVersion, 7, 'no version bump');
    });

    it('does nothing while the battle is still live', async () => {
        const store = _makeMemoryKv();
        await store.set('save:rill', save({ name: 'Rill', hp: 100 }));
        await settlePvpTerminalVitals(store, session({ status: 'active', winner: null }), deps());
        const row = (await store.get<Record<string, never>>('save:rill'))!;
        assert.equal((row.character as Record<string, unknown>).hp, 100);
    });

    it('is a no-op on replay AFTER the player has healed', async () => {
        // The load-bearing one. PvP reward completion legitimately replays the
        // terminal session for up to 48h, which spans a hospital discharge and
        // another fight. The frozen session would happily re-admit a healed
        // player; the per-fighter receipt is what stops it.
        const store = _makeMemoryKv();
        await store.set('save:dopey', save({ name: 'Dopey', hp: 100 }));
        const s = session({ p1: fighter('Rill'), p2: fighter('Dopey', { hp: 0 }), winner: 'p1' });

        await settlePvpTerminalVitals(store, s, deps());
        assert.equal(((await store.get<Record<string, never>>('save:dopey'))!.character as Record<string, unknown>).hospitalized, true);

        // Discharged at the Hospital, back to full.
        await store.set('save:dopey', save({ name: 'Dopey', hp: 100, hospitalized: false }));
        await settlePvpTerminalVitals(store, s, deps(NOW + 3_600_000));

        const healed = (await store.get<Record<string, never>>('save:dopey'))!;
        assert.equal((healed.character as Record<string, unknown>).hp, 100, 'replay must not re-KO a healed player');
        assert.equal((healed.character as Record<string, unknown>).hospitalized, false, 'replay must not re-admit');
    });

    it('records a receipt per fighter, keyed to the battle', async () => {
        const store = _makeMemoryKv();
        await store.set('save:rill', save({ name: 'Rill' }));
        await store.set('save:dopey', save({ name: 'Dopey' }));
        const s = session();

        await settlePvpTerminalVitals(store, s, deps());

        assert.ok(await store.get(pvpVitalsReceiptKey(s.battleId, 'rill')));
        assert.ok(await store.get(pvpVitalsReceiptKey(s.battleId, 'dopey')));
        // A DIFFERENT battle settles independently — the guard is per battle,
        // not a single "last settled" stamp that a later fight would clear.
        assert.equal(await store.get(pvpVitalsReceiptKey('pvp-vitals-2', 'rill')), null);
    });

    it('releases its receipt when the save write fails, so a retry can still settle', async () => {
        const store = _makeMemoryKv();
        await store.set('save:rill', save({ name: 'Rill', hp: 100 }));
        const s = session({ p1: fighter('Rill', { hp: 11 }), p2: fighter('Ghost'), winner: 'p1' });
        let failNext = true;
        const flaky = {
            ...store,
            get: store.get.bind(store),
            compareSet: store.compareSet.bind(store),
            del: store.del.bind(store),
            set: async (key: string, value: unknown, opts?: unknown) => {
                if (failNext && key === 'save:rill') { failNext = false; throw new Error('storage-down'); }
                return (store.set as (k: string, v: unknown, o?: unknown) => Promise<unknown>)(key, value, opts);
            },
        } as unknown as Parameters<typeof settlePvpTerminalVitals>[0];

        await assert.rejects(() => settlePvpTerminalVitals(flaky, s, deps()), /storage-down/);
        assert.equal(await store.get(pvpVitalsReceiptKey(s.battleId, 'rill')), null, 'claim released');

        await settlePvpTerminalVitals(flaky, s, deps());
        assert.equal(((await store.get<Record<string, never>>('save:rill'))!.character as Record<string, unknown>).hp, 11);
    });

    it('writes the consequence and its proof in ONE save write — a crash after it cannot re-apply', async () => {
        // The old shape claimed a KV receipt BEFORE the save write; a process
        // death between the two left a standing claim over an unapplied
        // consequence. Now the receipt rides in the save itself.
        const store = _makeMemoryKv();
        await store.set('save:dopey', save({ name: 'Dopey', hp: 100 }));
        const s = session({ p1: fighter('Rill'), p2: fighter('Dopey', { hp: 0 }), winner: 'p1' });

        await settlePvpTerminalVitals(store, s, deps());
        const row = (await store.get<Record<string, never>>('save:dopey'))!;
        const character = row.character as Record<string, unknown>;
        const receipts = character.serverSettlementReceipts as Array<{ value: Record<string, unknown> }>;
        assert.equal(character.hospitalized, true);
        assert.equal(receipts?.[0]?.value?.kind, 'pvp-vitals', 'the proof lives in the same character snapshot');
        assert.equal(receipts?.[0]?.value?.battleId, s.battleId);

        // Simulate "process died after the save write, before the compat
        // marker": drop the marker, discharge the player, replay.
        await store.del(pvpVitalsReceiptKey(s.battleId, 'dopey'));
        await store.set('save:dopey', { ...row, character: { ...character, hp: 100, hospitalized: false } });
        await settlePvpTerminalVitals(store, s, deps(NOW + 3_600_000));
        const healed = (await store.get<Record<string, never>>('save:dopey'))!.character as Record<string, unknown>;
        assert.equal(healed.hp, 100, 'the in-save receipt alone stops the replay');
        assert.equal(healed.hospitalized, false);
    });

    it('a failed save write leaves no receipt ANYWHERE, so the retry applies for real', async () => {
        const store = _makeMemoryKv();
        await store.set('save:rill', save({ name: 'Rill', hp: 100 }));
        const s = session({ p1: fighter('Rill', { hp: 11 }), p2: fighter('Ghost'), winner: 'p1' });
        let failNext = true;
        const flaky = {
            ...store,
            get: store.get.bind(store),
            compareSet: store.compareSet.bind(store),
            del: store.del.bind(store),
            set: async (key: string, value: unknown, opts?: unknown) => {
                if (failNext && key === 'save:rill') { failNext = false; throw new Error('storage-down'); }
                return (store.set as (k: string, v: unknown, o?: unknown) => Promise<unknown>)(key, value, opts);
            },
        } as unknown as Parameters<typeof settlePvpTerminalVitals>[0];

        await assert.rejects(() => settlePvpTerminalVitals(flaky, s, deps()), /storage-down/);
        const untouched = (await store.get<Record<string, never>>('save:rill'))!.character as Record<string, unknown>;
        assert.equal(untouched.serverSettlementReceipts, undefined, 'no in-save receipt without the write');
        assert.equal(await store.get(pvpVitalsReceiptKey(s.battleId, 'rill')), null, 'no compat marker without the write');
    });

    it('skips a fighter with no save row, such as an NPC guard', async () => {
        const store = _makeMemoryKv();
        await store.set('save:rill', save({ name: 'Rill', hp: 100 }));
        const s = session({ p1: fighter('Rill', { hp: 25 }), p2: fighter('Village Guard'), winner: 'p1' });

        await settlePvpTerminalVitals(store, s, deps());

        assert.equal(((await store.get<Record<string, never>>('save:rill'))!.character as Record<string, unknown>).hp, 25);
        assert.equal(await store.get('save:village-guard'), null);
    });

    it('takes the two save locks one at a time, never held together', async () => {
        // Two players raiding each other concurrently: holding save:A while
        // waiting on save:B is the classic inverted-order deadlock.
        const store = _makeMemoryKv();
        await store.set('save:rill', save({ name: 'Rill' }));
        await store.set('save:dopey', save({ name: 'Dopey' }));
        let held = 0;
        let maxHeld = 0;
        const order: string[] = [];
        await settlePvpTerminalVitals(store, session(), {
            now: NOW,
            lock: async <T>(key: string, action: () => Promise<T>) => {
                order.push(key);
                held += 1;
                maxHeld = Math.max(maxHeld, held);
                try { return await action(); } finally { held -= 1; }
            },
        });
        assert.equal(maxHeld, 1, 'never holds two save locks at once');
        assert.deepEqual(order, ['save:rill', 'save:dopey']);
    });
});

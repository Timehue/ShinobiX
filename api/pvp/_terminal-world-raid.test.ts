/**
 * World-raid progression + village-war continuation settled from the terminal
 * barrier instead of from a browser claim (api/pvp/_terminal-world-raid.ts).
 *
 * The load-bearing property is NOT that it settles — it is that it never
 * throws. The barrier is awaited by the terminal MOVE, so a throw here fails
 * the killing blow's own response and every retry of it. claim-rewards stays
 * the authority that retries; this may only settle earlier, never block.
 */
import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { settleTerminalWorldRaid, MAX_RAID_REPORTS_PER_DAY } from './_terminal-world-raid.js';
import type { PvpFighter, PvpSession } from './session.js';

const CREATED = 1_700_000_000_000;
const ENDED = CREATED + 120_000;
const NOW = ENDED + 5_000;

function fighter(name: string): PvpFighter {
    return {
        name,
        hp: 50, maxHp: 100,
        chakra: 20, maxChakra: 50,
        stamina: 30, maxStamina: 60,
        shield: 0, statuses: [], character: { village: 'Leaf' }, pos: 0,
    };
}

function session(over: Partial<PvpSession> = {}): PvpSession {
    return {
        battleId: 'pvp-world-1',
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
        joined: { p1: true, p2: true },
        rewardAuthority: 'world',
        baseRewards: true,
        rewardSector: 12,
        worldAttacker: { side: 'p1', name: 'rill' },
        worldTerritoryEvidence: {
            version: 1, sector: 12, ownerClan: '', ownerVillage: 'Sand',
            raidDamage: 400, observedAt: CREATED,
        },
        createdAt: CREATED,
        endedAt: ENDED,
        ...over,
    } as PvpSession;
}

/** A stand-in raid result; only `territory` is read by the war settler. */
const TERRITORY = { amount: 400, proofId: 'p', playerName: 'rill', sector: 12, at: ENDED };
function raidResult() {
    return { territory: TERRITORY } as never;
}

function spies(over: { raid?: unknown; war?: unknown } = {}) {
    const calls: { raid: unknown[]; war: unknown[] } = { raid: [], war: [] };
    const deps = {
        now: NOW,
        settleRaid: (async (params: unknown) => {
            calls.raid.push(params);
            if (over.raid instanceof Error) throw over.raid;
            return (over.raid ?? raidResult());
        }) as never,
        settleVillageWar: (async (...args: unknown[]) => {
            calls.war.push(args);
            if (over.war instanceof Error) throw over.war;
            return (over.war ?? { status: 200, body: { ok: true, warGroundRewardEligible: true } });
        }) as never,
    };
    return { calls, deps };
}

describe('settleTerminalWorldRaid', () => {
    it('settles the raid, then hands its territory proof to the war row', async () => {
        const { calls, deps } = spies();
        const out = await settleTerminalWorldRaid(session(), deps);

        assert.equal(calls.raid.length, 1);
        assert.deepEqual(calls.raid[0], {
            playerName: 'rill',
            proofId: 'pvp-raid:pvp-world-1',
            proofAt: ENDED,
            sector: 12,
            dailyLimit: MAX_RAID_REPORTS_PER_DAY,
            territoryEvidence: session().worldTerritoryEvidence,
        });
        assert.equal(calls.war.length, 1);
        const warArgs = calls.war[0] as unknown[];
        assert.equal(warArgs[0], 'pvp-world-1');
        assert.equal(warArgs[1], 'rill', 'settles as the recorded winner');
        assert.deepEqual(warArgs[3], TERRITORY, 'the raid proof is passed through');
        assert.equal(out.villageWar?.status, 200);
    });

    it('proves the raid is settled from the SESSION alone — the reason it can run browserless', async () => {
        // Everything the settler needs (winner, proof id, terminal time, sector,
        // evidence) is read off the sealed row. No request body, no claim.
        const { calls, deps } = spies();
        await settleTerminalWorldRaid(session(), deps);
        const params = calls.raid[0] as Record<string, unknown>;
        assert.equal(params.proofAt, ENDED, 'terminal time comes from session.endedAt');
        assert.equal(params.sector, 12, 'sector comes from session.rewardSector');
    });

    it('settles nothing for a draw', async () => {
        // The war settler answers 409 "Battle not yet decided" for a draw, and
        // this runs on the terminal MOVE — so every drawn match would otherwise
        // take the deferral path on every replay.
        const { calls, deps } = spies();
        const out = await settleTerminalWorldRaid(session({ winner: 'draw' }), deps);
        assert.deepEqual(calls.raid, []);
        assert.deepEqual(calls.war, []);
        assert.deepEqual(out, {});
    });

    it('never throws when the war row refuses', async () => {
        const { calls, deps } = spies({ war: { status: 503, body: { error: 'still finalizing' } } });
        const out = await settleTerminalWorldRaid(session(), deps);
        assert.equal(calls.war.length, 1);
        assert.equal(out.villageWar, undefined, 'not recorded as settled');
    });

    it('never throws when the war settler itself blows up', async () => {
        const { deps } = spies({ war: new Error('storage-down') });
        const out = await settleTerminalWorldRaid(session(), deps);
        assert.equal(out.villageWar, undefined);
    });

    it('never throws when raid settlement fails, and defers the war row with it', async () => {
        const { calls, deps } = spies({ raid: new Error('raid-progression-save-missing') });
        const out = await settleTerminalWorldRaid(session(), deps);
        assert.equal(out.raid, undefined);
        assert.deepEqual(calls.war, [], 'a sealed raid with no proof must not reach the war row');
    });

    it('defers rather than offering the war row a sealed raid it cannot verify', async () => {
        // No sealed territory evidence => the settler cannot verify the proof and
        // answers 503 at the point of application. Leave the whole thing to the
        // claim instead of recording a weaker outcome.
        const { calls, deps } = spies();
        const noEvidence = session();
        delete (noEvidence as { worldTerritoryEvidence?: unknown }).worldTerritoryEvidence;
        await settleTerminalWorldRaid(noEvidence, deps);
        assert.deepEqual(calls.war, []);
    });

    it('defers when the sealed reward sector is out of range', async () => {
        const { calls, deps } = spies();
        await settleTerminalWorldRaid(session({ rewardSector: 99 }), deps);
        assert.deepEqual(calls.raid, [], 'out-of-range sector never reaches the raid settler');
        assert.deepEqual(calls.war, [], 'and so never reaches the war row unverified');
    });

    it('settles a non-world war battle with no raid proof at all', async () => {
        // A clan-war / challenge row is not a sealed World raid, so the war
        // settler has nothing to verify and may settle on its own.
        const { calls, deps } = spies();
        const out = await settleTerminalWorldRaid(session({
            rewardAuthority: 'challenge',
            progressionAuthorityVersion: 1,
            worldAttacker: undefined,
        }), deps);
        assert.deepEqual(calls.raid, [], 'no raid to settle');
        assert.equal(calls.war.length, 1);
        assert.equal((calls.war[0] as unknown[])[3], undefined, 'no territory proof offered');
        assert.equal(out.villageWar?.status, 200);
    });

    it('skips a battle with no progression authority', async () => {
        const { calls, deps } = spies();
        await settleTerminalWorldRaid(session({ joined: { p1: true, p2: false } }), deps);
        assert.deepEqual(calls.raid, []);
        assert.deepEqual(calls.war, []);
    });

    it('skips admin and pet-ranked battles', async () => {
        const admin = spies();
        await settleTerminalWorldRaid(session({ rewardAuthority: 'admin', worldAttacker: undefined }), admin.deps);
        assert.deepEqual(admin.calls.war, []);

        const pet = spies();
        await settleTerminalWorldRaid(session({
            rewardAuthority: 'ranked', ranked: true, rankedKind: 'pet', worldAttacker: undefined,
        }), pet.deps);
        assert.deepEqual(pet.calls.war, []);
    });

    it('settles nothing when the terminal stamp is malformed', async () => {
        const { calls, deps } = spies();
        await settleTerminalWorldRaid(session({ endedAt: CREATED - 1 }), deps);
        assert.deepEqual(calls.raid, []);
        assert.deepEqual(calls.war, []);

        const far = spies();
        await settleTerminalWorldRaid(session({ endedAt: NOW + 120_000 }), far.deps);
        assert.deepEqual(far.calls.raid, []);
    });
});

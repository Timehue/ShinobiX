import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, describe, it } from 'node:test';
import type { PvpSession } from './pvp/session.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let kv: typeof import('./_storage.js').kv;
let settle: typeof import('./world-state.js').settlePvpVillageWarContinuation;

const now = Date.now();
const today = new Date(now).toISOString().slice(0, 10);

function battle(
    battleId: string,
    overrides: Partial<PvpSession> = {},
): PvpSession {
    return {
        battleId,
        p1: { name: 'Winner', character: { village: 'Leaf' } },
        p2: { name: 'Loser', character: { village: 'Mist' } },
        status: 'done',
        winner: 'p1',
        rewardAuthority: 'challenge',
        baseRewards: true,
        joined: { p1: true, p2: true },
        realFighters: { p1: true, p2: true },
        round: 2,
        activePlayer: 'p1',
        ap: { p1: 1, p2: 1 },
        actionsThisTurn: 0,
        cooldowns: { p1: {}, p2: {} },
        log: [],
        createdAt: now - 5_000,
        endedAt: now - 1_000,
        ...overrides,
    } as unknown as PvpSession;
}

function war(overrides: Record<string, unknown> = {}) {
    return {
        id: 'leaf-vs-mist',
        villages: ['Leaf', 'Mist'],
        hp: { Leaf: 5_000, Mist: 5_000 },
        warGroundSector: 40,
        warGroundHp: 1_000,
        startedAt: now - 10_000,
        updatedAt: now - 10_000,
        lastDecayDate: today,
        ...overrides,
    };
}

async function putBattle(session: PvpSession): Promise<void> {
    await kv.set(`pvp:${session.battleId}`, session);
}

before(async () => {
    ({ kv } = await import('./_storage.js'));
    ({ settlePvpVillageWarContinuation: settle } = await import('./world-state.js'));
});

describe('server-owned PvP village-war continuation', () => {
    it('derives damage from the sealed battle, ignores post-fight village switches, and replays exact outcome', async () => {
        const session = battle('pvp-world-service-applied');
        await putBattle(session);
        await kv.set('save:winner', { character: { name: 'Winner', village: 'Cloud', storyTitle: 'Kage' } });
        await kv.set('save:loser', { character: { name: 'Loser', village: 'Sand', storyTitle: 'Kage' } });
        await kv.set('world:war:leaf-vs-mist', war());

        const first = await settle(session.battleId, 'winner');
        assert.equal(first.status, 200);
        assert.equal(first.body.settlement, 'applied');
        let row = await kv.get<Record<string, any>>('world:war:leaf-vs-mist');
        assert.equal(row?.hp?.Mist, 4_995, 'switched saves and forged titles resolve to sealed-village villager weight');

        const duplicate = await settle(session.battleId, 'winner');
        assert.equal(duplicate.status, 200);
        assert.equal(duplicate.body.replayed, true);
        row = await kv.get<Record<string, any>>('world:war:leaf-vs-mist');
        assert.equal(row?.hp?.Mist, 4_995);

        // Crash after war CAS but before the external receipt: embedded outcome
        // recreates the exact applied receipt without reprojecting damage.
        await kv.del(`pvp:war-continuation:winner:${session.battleId}`);
        const reconstructed = await settle(session.battleId, 'winner');
        assert.equal(reconstructed.status, 200);
        assert.equal(reconstructed.body.settlement, 'applied');
        assert.equal(reconstructed.body.replayed, true);
        row = await kv.get<Record<string, any>>('world:war:leaf-vs-mist');
        assert.equal(row?.hp?.Mist, 4_995);
    });

    it('never derives the home-defense multiplier from claim-time territory state', async () => {
        const session = battle('pvp-world-home-evidence-only', {
            rewardSector: 40,
            warRoleEvidence: {
                version: 1,
                sealedAt: now - 5_000,
                p1: { village: 'Leaf', role: { win: 30, loss: 50 } },
                p2: { village: 'Mist', role: { win: 5, loss: 0 } },
            },
        });
        await putBattle(session);
        await kv.set('world:war:leaf-vs-mist', war());
        await kv.set('world:territory:40', {
            sector: 40,
            ownerVillage: 'Leaf',
            hp: 20_000,
            updatedAt: now,
        });

        const result = await settle(session.battleId, 'winner');
        assert.equal(result.status, 200);
        const row = await kv.get<Record<string, any>>('world:war:leaf-vs-mist');
        assert.equal(
            row?.hp?.Mist,
            4_970,
            'a non-World session has no sealed sector owner proof, so current ownership cannot add 15%',
        );
    });

    it('preserves the 15% home-defense balance only from sealed World evidence', async () => {
        const session = battle('pvp-world-sealed-home-bonus', {
            rewardAuthority: 'world',
            rewardSector: 40,
            // The worldAttacker claim declares a clan, and sealedWorldRaidAttacker
            // requires any declared village/clan to match the sealed fighter
            // snapshot. The default fixture fighter carries no clan, so without
            // this the attacker resolves to null, the session stops counting as a
            // sealed World raid, and the home-defense multiplier silently never
            // applies — which is the guard working, not the bonus being missing.
            p1: { name: 'Winner', character: { village: 'Leaf', clan: 'LeafClan' } } as unknown as PvpSession['p1'],
            worldAttacker: { side: 'p1', name: 'winner', village: 'Leaf', clan: 'LeafClan' },
            worldTerritoryEvidence: {
                version: 1,
                sector: 40,
                ownerClan: 'LeafClan',
                ownerVillage: 'Leaf',
                raidDamage: 0,
                observedAt: now - 5_000,
            },
            warRoleEvidence: {
                version: 1,
                sealedAt: now - 5_000,
                p1: { village: 'Leaf', role: { win: 30, loss: 50 } },
                p2: { village: 'Mist', role: { win: 5, loss: 0 } },
            },
        });
        await putBattle(session);
        await kv.set('world:war:leaf-vs-mist', war());
        // The live row deliberately disagrees. Settlement must use the session
        // snapshot and keep the historical floor(30 * 1.15) = 34 swing.
        await kv.set('world:territory:40', {
            sector: 40,
            ownerVillage: 'Cloud',
            hp: 20_000,
            updatedAt: now,
        });
        const proofId = (await import('./missions/_raid-progression.js')).raidProgressionReceiptId(
            `pvp-raid:${session.battleId}`,
        );
        const result = await settle(session.battleId, 'winner', session, {
            proofId,
            playerName: 'winner',
            sector: 40,
            amount: 0,
            hpAfter: 20_000,
            destroyed: false,
            at: Number(session.endedAt),
            replayed: false,
        });
        assert.equal(result.status, 200);
        const row = await kv.get<Record<string, any>>('world:war:leaf-vs-mist');
        assert.equal(row?.hp?.Mist, 4_966);
    });

    it('rejects unsanctioned, unjoined, no-progression, pet-ranked, and admin sessions', async () => {
        const cases: Array<[string, Partial<PvpSession>]> = [
            ['unsanctioned', { rewardAuthority: undefined }],
            ['unjoined', { joined: { p1: true, p2: false } }],
            ['spar', { rewardAuthority: 'challenge', baseRewards: false, ranked: false }],
            ['pet', { rewardAuthority: 'ranked', ranked: true, rankedKind: 'pet', baseRewards: false }],
            ['admin', { rewardAuthority: 'admin', baseRewards: true }],
        ];
        for (const [label, overrides] of cases) {
            const session = battle(`pvp-world-reject-${label}`, overrides);
            await putBattle(session);
            await kv.set('world:war:leaf-vs-mist', war());
            const result = await settle(session.battleId, 'winner');
            assert.equal(result.status, 403, label);
            const row = await kv.get<Record<string, any>>('world:war:leaf-vs-mist');
            assert.equal(row?.hp?.Mist, 5_000, label);
        }
    });

    it('durably receipts same-village, no-war, predating, and overtaken battles as canonical no-ops', async () => {
        const sameVillage = battle('pvp-world-noop-same', {
            p2: { name: 'Loser', character: { village: 'Leaf' } } as unknown as PvpSession['p2'],
        });
        await putBattle(sameVillage);
        const same = await settle(sameVillage.battleId, 'winner');
        assert.equal(same.status, 200);
        assert.equal(same.body.settlement, 'not-applicable');
        assert.equal((await settle(sameVillage.battleId, 'winner')).body.replayed, true);

        const noWar = battle('pvp-world-noop-missing');
        await putBattle(noWar);
        await kv.del('world:war:leaf-vs-mist');
        assert.equal((await settle(noWar.battleId, 'winner')).body.settlement, 'not-applicable');

        const predating = battle('pvp-world-noop-predate', {
            createdAt: now - 20_000,
            endedAt: now - 15_000,
        });
        await putBattle(predating);
        await kv.set('world:war:leaf-vs-mist', war());
        assert.equal((await settle(predating.battleId, 'winner')).body.settlement, 'not-applicable');

        const overtaken = battle('pvp-world-noop-overtaken', { endedAt: now - 2_000 });
        await putBattle(overtaken);
        await kv.set('world:war:leaf-vs-mist', war({ endedAt: now - 1_000 }));
        const ended = await settle(overtaken.battleId, 'winner');
        assert.equal(ended.status, 200);
        assert.equal(ended.body.settlement, 'superseded');
        const row = await kv.get<Record<string, any>>('world:war:leaf-vs-mist');
        assert.equal(row?.hp?.Mist, 5_000);
    });

    it('applies every unseen eligible battle in exact-CAS arrival order, independent of terminal chronology', async () => {
        for (const [label, firstEndedAt, secondEndedAt] of [
            ['newer-first', now - 500, now - 1_000],
            ['older-first', now - 1_000, now - 500],
            ['equal', now - 750, now - 750],
        ] as const) {
            const first = battle(`pvp-world-order-${label}-a`, { createdAt: now - 5_000, endedAt: firstEndedAt });
            const second = battle(`pvp-world-order-${label}-b`, { createdAt: now - 5_000, endedAt: secondEndedAt });
            await putBattle(first);
            await putBattle(second);
            await kv.set('world:war:leaf-vs-mist', war());
            assert.equal((await settle(first.battleId, 'winner')).body.settlement, 'applied', label);
            assert.equal((await settle(second.battleId, 'winner')).body.settlement, 'applied', label);
            const row = await kv.get<Record<string, any>>('world:war:leaf-vs-mist');
            assert.equal(row?.hp?.Mist, 4_990, label);
        }
    });

    it('fails closed on malformed or cross-session external continuation receipts', async () => {
        const session = battle('pvp-world-receipt-binding');
        await putBattle(session);
        await kv.set('world:war:leaf-vs-mist', war());
        const key = `pvp:war-continuation:winner:${session.battleId}`;
        await kv.set(key, {
            version: 1,
            battleId: session.battleId,
            actorName: 'winner',
            outcome: 'applied',
            warId: 'sand-vs-cloud',
            settledAt: Number(session.endedAt) + 1,
            warGroundRewardEligible: false,
        });
        const conflict = await settle(session.battleId, 'winner');
        assert.equal(conflict.status, 503);
        assert.equal(conflict.body.war, undefined, 'receipt-provided war ids are never arbitrary read authority');
        assert.equal((await kv.get<Record<string, any>>('world:war:leaf-vs-mist'))?.hp?.Mist, 5_000);

        await kv.set(key, {
            version: 1,
            battleId: session.battleId,
            actorName: 'winner',
            outcome: 'not-applicable',
            settledAt: Number(session.endedAt),
            warGroundRewardEligible: false,
        });
        const underboundNoop = await settle(session.battleId, 'winner');
        assert.equal(underboundNoop.status, 503, 'cross-village no-op receipts must bind the sealed pair id');

        await kv.set(key, { version: 1, battleId: session.battleId, actorName: 'winner' });
        const malformed = await settle(session.battleId, 'winner');
        assert.equal(malformed.status, 503);
        assert.equal((await kv.get<Record<string, any>>('world:war:leaf-vs-mist'))?.hp?.Mist, 5_000);
    });

    it('fails closed when the embedded battle ledger or exact token value is malformed', async () => {
        const session = battle('pvp-world-embedded-malformed');
        await putBattle(session);
        await kv.set('world:war:leaf-vs-mist', war({ pvpBattleReceipts: [] }));
        const garbage = await settle(session.battleId, 'winner');
        assert.equal(garbage.status, 503);
        assert.equal((await kv.get<Record<string, any>>('world:war:leaf-vs-mist'))?.hp?.Mist, 5_000);

        const { stampEmbeddedWarBattleReplay } = await import('./_war-battle-receipt.js');
        const valid = stampEmbeddedWarBattleReplay(undefined, session.battleId, 'winner');
        const token = Object.keys(valid)[0]!;
        await kv.set('world:war:leaf-vs-mist', war({
            pvpBattleReceipts: { ...valid, [token]: 'forged-outcome' },
        }));
        const invalidExactToken = await settle(session.battleId, 'winner');
        assert.equal(invalidExactToken.status, 503);
        assert.equal((await kv.get<Record<string, any>>('world:war:leaf-vs-mist'))?.hp?.Mist, 5_000);
    });

    it('accepts an exact zero raid proof after target replacement without ground damage or capture', async () => {
        const session = battle('pvp-world-target-replaced', {
            rewardAuthority: 'world',
            rewardSector: 40,
            worldAttacker: { side: 'p1', name: 'winner', village: 'Leaf', clan: 'LeafClan' },
            worldTerritoryEvidence: {
                version: 1,
                sector: 40,
                ownerClan: 'MistClan',
                ownerVillage: 'Mist',
                raidDamage: 250,
                observedAt: now - 5_000,
            },
        } as Partial<PvpSession>);
        await putBattle(session);
        await kv.set('world:war:leaf-vs-mist', war());
        await kv.set('world:territory:40', { sector: 40, ownerClan: 'CloudClan', ownerVillage: 'Cloud', hp: 20_000 });
        const proofId = (await import('./missions/_raid-progression.js')).raidProgressionReceiptId(
            `pvp-raid:${session.battleId}`,
        );
        const result = await settle(session.battleId, 'winner', session, {
            proofId,
            playerName: 'winner',
            sector: 40,
            amount: 0,
            hpAfter: 20_000,
            destroyed: false,
            at: Number(session.endedAt),
            replayed: false,
        });
        assert.equal(result.status, 200);
        assert.equal(result.body.warGroundRewardEligible, false);
        const row = await kv.get<Record<string, any>>('world:war:leaf-vs-mist');
        assert.equal(row?.warGroundHp, 1_000);
        assert.equal(row?.capturedBy, undefined);
    });

    it('routes every present battleId before legacy absolute-row normalization', () => {
        const source = readFileSync('api/world-state.ts', 'utf8');
        const dispatch = source.search(/Object\.prototype\.hasOwnProperty\.call\([^\n]+, 'battleId'\)/);
        const legacyNormalize = source.indexOf("if (body?.kind === 'war')");
        assert.ok(dispatch >= 0 && legacyNormalize > dispatch);
        assert.match(source.slice(dispatch, legacyNormalize), /trim\(\).*400|Missing battle id/s);
    });
});

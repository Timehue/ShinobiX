import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyDungeonWardenSettlement,
    dungeonWardenTier,
    resolveDungeonAiFightAuthority,
} from './_ai-fight.js';

describe('sealed Dungeon Warden adapter', () => {
    it('reconstructs one stable Warden and ignores forged opponent data', () => {
        const character = { activeDungeonRun: { token: 'dungeonrun0001', entry: 'key', startedAt: 1 } };
        const a = resolveDungeonAiFightAuthority({ playerName: 'Kiri', character, dungeonRunToken: 'dungeonrun0001' });
        const b = resolveDungeonAiFightAuthority({ playerName: 'Kiri', character, dungeonRunToken: 'dungeonrun0001' });
        assert.equal(a.battleKind, 'dungeon');
        assert.equal(a.scaling.level, dungeonWardenTier('Kiri', 'dungeonrun0001'));
        assert.equal(a.opponentId, b.opponentId);
        assert.deepEqual(a.profile, b.profile);
        assert.throws(() => resolveDungeonAiFightAuthority({
            playerName: 'Kiri', character, dungeonRunToken: 'forgedrun00001',
        }), /matching active Dungeon run/);
    });

    it('requires a free discovery to be banked before combat', () => {
        const unbound = { activeDungeonRun: { token: 'freerun000001', entry: 'free', sector: 61 } };
        assert.throws(() => resolveDungeonAiFightAuthority({
            playerName: 'Kiri', character: unbound, dungeonRunToken: 'freerun000001',
        }), /exploration receipt/);
        const authority = resolveDungeonAiFightAuthority({
            playerName: 'Kiri',
            character: { activeDungeonRun: { ...unbound.activeDungeonRun, exploreReceiptId: 'exploreproof01' } },
            dungeonRunToken: 'freerun000001',
        });
        assert.equal(authority.dungeonRunToken, 'freerun000001');
    });

    it('allows loss/forfeit rematches, stamps one exact win, and never stamps a stale run', () => {
        const base = { activeDungeonRun: { token: 'dungeonrun0002', entry: 'key', startedAt: 1 } };
        const loss = applyDungeonWardenSettlement({
            character: base, dungeonRunToken: 'dungeonrun0002', opponentId: 'dungeon-warden-75',
            proofId: 'lossfightproof01', outcome: 'loss', now: 10,
        });
        assert.equal(loss.ok, true); if (!loss.ok) return;
        assert.notEqual((loss.character.activeDungeonRun as Record<string, unknown>).wardenDefeated, true);
        resolveDungeonAiFightAuthority({ playerName: 'Kiri', character: loss.character, dungeonRunToken: 'dungeonrun0002' });

        const win = applyDungeonWardenSettlement({
            character: loss.character, dungeonRunToken: 'dungeonrun0002', opponentId: 'dungeon-warden-75',
            proofId: 'winfightproof0001', outcome: 'win', now: 20,
        });
        assert.equal(win.ok, true); if (!win.ok) return;
        const active = win.character.activeDungeonRun as Record<string, unknown>;
        assert.equal(active.wardenDefeated, true);
        assert.equal(active.wardenProofId, 'winfightproof0001');
        const replay = applyDungeonWardenSettlement({
            character: win.character, dungeonRunToken: 'dungeonrun0002', opponentId: 'forged',
            proofId: 'winfightproof0001', outcome: 'win', now: 30,
        });
        assert.equal(replay.ok, true);
        const duplicate = applyDungeonWardenSettlement({
            character: win.character, dungeonRunToken: 'dungeonrun0002', opponentId: 'dungeon-warden-50',
            proofId: 'otherwinproof001', outcome: 'win', now: 30,
        });
        assert.equal(duplicate.ok, false);
        // A stale token settles consequence-only: the OTHER run is left untouched.
        const otherRun = { activeDungeonRun: { token: 'newdungeonrun01' } };
        const stale = applyDungeonWardenSettlement({
            character: otherRun, dungeonRunToken: 'dungeonrun0002',
            opponentId: 'dungeon-warden-75', proofId: 'winfightproof0001', outcome: 'win', now: 40,
        });
        assert.equal(stale.ok, true); if (!stale.ok) return;
        assert.deepEqual(stale.character, otherRun);
    });

    it('settles a Warden fight whose run was abandoned mid-fight instead of wedging it', () => {
        // Live 2026-09-23: the Dungeon VN under the fight caught Escape → Leave and
        // abandoned the run; every settle retry then 409'd and the fight never closed.
        for (const outcome of ['loss', 'forfeit', 'draw', 'win'] as const) {
            const character = { hp: 1728, activeDungeonRun: null };
            const settled = applyDungeonWardenSettlement({
                character, dungeonRunToken: 'dungeonrun0003', opponentId: 'dungeon-warden-75',
                proofId: 'abandonedproof01', outcome, now: 50,
            });
            assert.equal(settled.ok, true, outcome); if (!settled.ok) return;
            assert.deepEqual(settled.character, character, outcome);
        }
        assert.equal(applyDungeonWardenSettlement({
            character: { activeDungeonRun: null }, dungeonRunToken: '', opponentId: 'dungeon-warden-75',
            proofId: 'abandonedproof01', outcome: 'loss',
        }).ok, false);
    });

    it('ends a free explore-found run on flee or loss so the player is never stuck in it', () => {
        for (const outcome of ['forfeit', 'loss', 'draw'] as const) {
            const character = {
                activeDungeonRun: { token: 'freerun000002', entry: 'free', sector: 12, exploreReceiptId: 'exploreproof02' },
                serverFreeDungeonProbeReceipts: [
                    { requestId: 'probe00000001', day: '2026-09-23', sector: 12, found: true, token: 'freerun000002', at: 1 },
                    { requestId: 'probe00000000', day: '2026-09-23', sector: 3, found: false, token: '', at: 0 },
                ],
            };
            const settled = applyDungeonWardenSettlement({
                character, dungeonRunToken: 'freerun000002', opponentId: 'dungeon-warden-50',
                proofId: 'fleefightproof01', outcome, now: 50,
            });
            assert.equal(settled.ok, true); if (!settled.ok) return;
            assert.equal(settled.character.activeDungeonRun, null);
            const receipts = settled.character.serverFreeDungeonProbeReceipts as Array<Record<string, unknown>>;
            assert.equal(receipts[0]!.resolvedAt, 50);
            assert.equal(receipts[1]!.resolvedAt, undefined);
        }
        const win = applyDungeonWardenSettlement({
            character: { activeDungeonRun: { token: 'freerun000003', entry: 'free', sector: 12, exploreReceiptId: 'exploreproof03' } },
            dungeonRunToken: 'freerun000003', opponentId: 'dungeon-warden-50', proofId: 'winfightproof0003', outcome: 'win', now: 60,
        });
        assert.equal(win.ok, true); if (!win.ok) return;
        assert.equal((win.character.activeDungeonRun as Record<string, unknown>).wardenDefeated, true);
    });
});

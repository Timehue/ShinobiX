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

    it('allows loss/forfeit rematches, stamps one exact win, and rejects stale-run settlement', () => {
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
        const stale = applyDungeonWardenSettlement({
            character: { activeDungeonRun: { token: 'newdungeonrun01' } }, dungeonRunToken: 'dungeonrun0002',
            opponentId: 'dungeon-warden-75', proofId: 'winfightproof0001', outcome: 'win', now: 40,
        });
        assert.equal(stale.ok, false);
    });
});

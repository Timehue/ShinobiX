import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readArenaTab, rememberArenaTab, towerBattleRecoveryScreen } from './arena-navigation';
import { confirmRankedPvpContext, preparePvpResultReturn, pvpResultReturn } from './pvp-session';
import { clearSectorReopen, takeSectorReopen } from './sector-return';

describe('returning to the owning arena activity', () => {
    function withStorage(run: () => void) {
        const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
        const values = new Map<string, string>();
        Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
        } });
        try { run(); } finally {
            if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
            else Reflect.deleteProperty(globalThis, 'sessionStorage');
        }
    }

    it('returns ranked participants to Ranked even when another district tab was last used', () => withStorage(() => {
        rememberArenaTab('Player', 'district', 'petBattles');
        rememberArenaTab('Other', 'district', 'tournaments');
        sessionStorage.setItem('tournament-resume', 'old-event');
        const context = { mode: 'ranked' as const };
        const result = pvpResultReturn(context, 21);
        assert.equal(result.returnTarget, 'arenaDistrict');
        preparePvpResultReturn(result.returnTarget, context, 21, ' Player ');
        assert.equal(readArenaTab('player', 'district'), 'ranked');
        assert.equal(readArenaTab('Other', 'district'), 'tournaments');
        assert.equal(sessionStorage.getItem('tournament-resume'), null);
    }));

    it('repairs old or missing ranked context without overwriting spectator origins', () => {
        for (const context of [null, { mode: 'standard' as const }, { sectorAttack: true, sector: 21 }]) {
            assert.equal(pvpResultReturn(confirmRankedPvpContext(context), 21).returnTarget, 'arenaDistrict');
        }
        for (const context of [{ mode: 'ranked' as const }, { spectatingFromScreen: 'arenaDistrict' as const }, { spectatingFromSector: 21 }]) {
            assert.equal(confirmRankedPvpContext(context), context, 'confirmation must be idempotent and preserve spectator routing');
        }
    });

    it('preserves spectator navigation and hospital routing', () => withStorage(() => {
        rememberArenaTab('Player', 'district', 'spectate');
        preparePvpResultReturn('arenaDistrict', { mode: 'ranked', spectatingFromScreen: 'arenaDistrict' }, 21, 'Player');
        assert.equal(readArenaTab('Player', 'district'), 'spectate');
        const context = { mode: 'standard' as const, sectorAttack: true, sector: 21 };
        assert.equal(pvpResultReturn(context, 21, true).returnTarget, 'hospital');
        preparePvpResultReturn('hospital', context, 21, 'Player');
        assert.equal(readArenaTab('Player', 'district'), 'spectate');
    }));

    it('still reopens the original sector for field combat', () => withStorage(() => {
        clearSectorReopen();
        preparePvpResultReturn('worldMap', { mode: 'standard', fromField: true, sector: 21 }, 21, 'Player');
        assert.equal(takeSectorReopen(), 21);
    }));

    it('recovers ranked 2v2 and tournaments into their own district tabs', () => withStorage(() => {
        rememberArenaTab('Player', 'district', 'petBattles');
        sessionStorage.setItem('tournament-resume', 'old-event');
        assert.equal(towerBattleRecoveryScreen('Player', 'ranked-2v2'), 'arenaDistrict');
        assert.equal(sessionStorage.getItem('tournament-resume'), null);
        assert.equal(readArenaTab('Player', 'district'), 'ranked');
        assert.equal(towerBattleRecoveryScreen('Player', 'tournament'), 'arenaDistrict');
        assert.equal(readArenaTab('Player', 'district'), 'tournaments');
        assert.equal(sessionStorage.getItem('tournament-resume'), '1');
        assert.equal(towerBattleRecoveryScreen('Player', 'mpvp'), 'battleArena');
        assert.equal(towerBattleRecoveryScreen('Player', 'clan-war-mpvp'), 'battleArena');
        assert.equal(towerBattleRecoveryScreen('Player', undefined), 'battleTowers');
    }));
});

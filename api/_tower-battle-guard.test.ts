import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    findTowerBattleStartConflict,
    isTowerBattleLock,
    towerBattleActiveErrorBody,
} from './_tower-battle-guard.js';

function store(values: Record<string, unknown>, fail = false) {
    return {
        async get<T>(key: string): Promise<T | null> {
            if (fail) throw new Error('storage unavailable');
            return (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null) as T | null;
        },
    };
}

const towerLease = {
    battleId: 'tower-authoritative-run',
    kind: 'battleTowers',
    screen: 'battleTowers',
    startedAt: 123,
    meta: { runId: 'tower-authoritative-run' },
};

describe('shared Tower battle-start guard', () => {
    it('blocks only a well-formed Tower-owned lease and returns no private run data in the error', async () => {
        assert.equal(isTowerBattleLock(towerLease), true);
        const conflict = await findTowerBattleStartConflict(['bob', 'alice', 'alice'], store({
            'battle-lock:alice': { battleId: 'arena-1', kind: 'arena', screen: 'arena', startedAt: 1 },
            'battle-lock:bob': towerLease,
        }) as never);
        assert.equal(conflict?.playerName, 'bob');
        assert.deepEqual(towerBattleActiveErrorBody(), {
            error: 'Finish or recover your active Battle Towers run before starting another battle.',
            errorCode: 'tower-battle-active',
        });
        assert.doesNotMatch(JSON.stringify(towerBattleActiveErrorBody()), /tower-authoritative-run|alice|bob/);
    });

    it('preserves every unlocked, legacy-lock, and malformed-Tower path', async () => {
        assert.equal(await findTowerBattleStartConflict(['alice'], store({}) as never), null);
        assert.equal(await findTowerBattleStartConflict(['alice'], store({
            'battle-lock:alice': { battleId: 'arena-1', kind: 'arena', screen: 'arena', startedAt: 1 },
        }) as never), null);
        assert.equal(await findTowerBattleStartConflict(['alice'], store({
            'battle-lock:alice': { ...towerLease, meta: { runId: 'other' } },
        }) as never), null);
    });

    it('fails closed on an uncertain storage read', async () => {
        await assert.rejects(() => findTowerBattleStartConflict(['alice'], store({}, true) as never), /storage unavailable/);
    });

    it('guards every audited authoritative character-combat creation boundary', () => {
        const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
        const singlePlayerRoutes = [
            'api/story/spar-start.ts',
            'api/story/boss-start.ts',
            'api/missions/combat-start.ts',
            'api/missions/ai-fight-start.ts',
            'api/missions/raid-start.ts',
            'api/endless/wave-start.ts',
            'api/village/anbu-infiltration.ts',
        ];
        for (const file of singlePlayerRoutes) {
            const text = source(file);
            assert.match(text, /findTowerBattleStartConflict\(\[playerName\]\)/, file);
            assert.match(text, /towerBattleActiveErrorBody\(\)/, file);
        }

        const hollow = source('api/hollow-gate/combat-start.ts');
        assert.match(hollow, /combatMode === 'solo-pve' && await findTowerBattleStartConflict\(\[playerName\]\)/);
        const clanBoss = source('api/clan-boss/assault-start.ts');
        assert.match(clanBoss, /findTowerBattleStartConflict\(partySlugs\)/);
        const weeklyBoss = source('api/weekly-boss.ts');
        assert.match(weeklyBoss, /if \(kind === 'startFight' \|\| kind === 'resumeFight'\)/);
        assert.match(weeklyBoss, /const recoveryOnly = kind === 'resumeFight'/);
        assert.match(weeklyBoss, /if \(!recoveryOnly && !identity\.admin && await findTowerBattleStartConflict\(\[actorName\]\)\)/);

        const pvp = source('api/pvp/session.ts');
        const guard = pvp.indexOf('findTowerBattleStartConflict([p1Norm, p2Norm])');
        const hydrate = pvp.indexOf('Hydrate both fighters from authoritative saves');
        assert.ok(guard > 0 && hydrate > guard, 'PvP checks both real fighter identities before session hydration/publication');
    });
});

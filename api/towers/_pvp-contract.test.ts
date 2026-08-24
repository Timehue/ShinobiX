import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTowerPvpMatch, type TowerPvpFighterSeed } from './_pvp-session.js';
import { isPublicTowerRun, isSpireRun } from './_tower-store.js';
import { TOWER_PVP_FLOOR } from './_pvp-session.js';
import { GRID_H, GRID_W, MAX_ROUNDS } from '../combat-core/constants.js';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function fighter(slug: string): TowerPvpFighterSeed {
    return {
        slug,
        displayName: slug,
        skill: 1,
        character: { maxHp: 100, maxChakra: 50, maxStamina: 50, stats: {}, specialty: 'Taijutsu', jutsu: [] },
    };
}

describe('Tower MPvP additive isolation contract', () => {
    it('can never satisfy Story or Spire reward identity', () => {
        const match = createTowerPvpMatch({
            matchId: `tpvp-${'d'.repeat(32)}`,
            fighters: ['a', 'b', 'c', 'd'].map(fighter),
            seed: 1,
            now: 1,
        });
        assert.equal(isPublicTowerRun(match.combat), false);
        assert.equal(isSpireRun(match.combat), false);
        assert.equal(match.combat.rewardSettlementState, 'settled');
    });

    it('mounts all four isolated production routes', () => {
        const server = source('server.ts');
        for (const route of ['pvp-queue', 'pvp-state', 'pvp-action', 'pvp-settle']) {
            assert.match(server, new RegExp(`route\\('/towers/${route}'`));
            assert.match(server, new RegExp(`api/towers/${route}\\.js`));
        }
    });

    it('keeps progression/reward writers out of MPvP modules', () => {
        const combined = [
            '_pvp-session.ts', '_pvp-store.ts', '_pvp-action.ts', '_pvp-lifecycle.ts',
            'pvp-queue.ts', 'pvp-state.ts', 'pvp-action.ts', 'pvp-settle.ts',
        ].map(file => source(`api/towers/${file}`)).join('\n');
        for (const forbidden of [
            'settleFloorForMember', 'settleAssistForAlly', 'settleSpireForMember',
            'battleTowerBestFloor', 'battleTowerAscension', 'battleTowerRating',
            'firstClearKey', 'spireRewardKey', 'gainXp', 'writeSaveProjected',
        ]) assert.doesNotMatch(combined, new RegExp(forbidden), forbidden);
    });

    it('gates Team Arena on the shared PvP floor, server-side, before admission', () => {
        const queue = source('api/towers/pvp-queue.ts');
        // Team Arena is a BATTLE ARENA mode, so it gates like ranked/casual PvP
        // rather than on the level-30 Towers unlock it used to inherit. A direct
        // POST must not walk through a browser-only gate either way.
        assert.match(queue, /isBelowAttackableFloor\(level\)/, 'must use the shared PvP newcomer floor');
        assert.doesNotMatch(queue, /BATTLE_TOWERS_MIN_LEVEL/, 'the Towers unlock no longer applies');
        assert.match(queue, /identity\.admin && isBelowAttackableFloor/, 'keep the admin override');
        assert.match(queue, /pvp-level-locked/, 'a blocked join needs a machine-readable errorCode');
        const gateAt = queue.indexOf('isBelowAttackableFloor(level)');
        const joinAt = queue.indexOf('joinTowerPvpQueue(');
        assert.ok(gateAt > 0 && joinAt > gateAt, 'the level gate must precede queue admission');
    });

    it('keeps one shared source of truth for the Battle Towers unlock level', () => {
        // Client and server previously held independent `30` literals, so the
        // browser gate could drift out of agreement with the server.
        assert.match(source('shared/tower-pvp.ts'), /export const BATTLE_TOWERS_MIN_LEVEL = 30 as const;/);
        assert.match(source('api/towers/_story-eligibility.ts'),
            /STORY_TOWER_MIN_LEVEL: number = BATTLE_TOWERS_MIN_LEVEL/);
        const lobby = source('shinobij.client/src/screens/BattleTowersLobby.tsx');
        assert.match(lobby, /TOWER_MIN_LEVEL = BATTLE_TOWERS_MIN_LEVEL/);
        assert.doesNotMatch(lobby, /TOWER_MIN_LEVEL = 30/, 'the browser must not re-declare the level');
        assert.match(source('api/towers/start.ts'), /STORY_TOWER_MIN_LEVEL/, 'the Towers themselves still gate on it');
        assert.doesNotMatch(source('shinobij.client/src/components/TowerReadyRoomPanel.tsx'), /level 30/,
            'ready-room copy must interpolate the shared constant');
    });

    it('fights shinobi PvP on the canonical grid and round cap, not a Tower-specific board', () => {
        // 2v2 is shinobi PvP: same battlefield and same length as the 1v1 it is
        // scored beside. Only the ACTOR COUNT differs, which is the whole reason
        // the N-actor session wraps it.
        assert.equal(TOWER_PVP_FLOOR.map.width, GRID_W);
        assert.equal(TOWER_PVP_FLOOR.map.height, GRID_H);
        assert.equal(TOWER_PVP_FLOOR.roundBudget, MAX_ROUNDS,
            'a 2v2 must not end sooner than a 1v1 on the same grid');
        // Derived, not copied — a literal here is how the two drifted before.
        assert.match(source('api/towers/_pvp-session.ts'), /roundBudget: MAX_ROUNDS/);
    });

    it('routes every match response through the viewer projection', () => {
        for (const file of ['pvp-queue.ts', 'pvp-state.ts', 'pvp-action.ts', 'pvp-settle.ts']) {
            assert.match(source(`api/towers/${file}`), /projectTowerPvpMatchForViewer/,
                `${file} must not return the amber authority frame raw`);
        }
    });

    it('routes Story MPvE and exact 2v2 through one canonical-backed Tower reducer', () => {
        const storyAction = source('api/towers/action.ts');
        const pvpAction = source('api/towers/_pvp-action.ts');
        const engine = source('api/towers/_engine.ts');
        assert.match(storyAction, /import \{[^}]*applyAction[^}]*\} from '\.\/_engine\.js'/s);
        assert.match(pvpAction, /import \{[^}]*applyAction[^}]*\} from '\.\/_engine\.js'/s);
        assert.match(storyAction, /applyAction\(session, floor, action, rng\)/);
        assert.match(pvpAction, /applyAction\(match\.combat, TOWER_PVP_FLOOR, action, rng\)/);
        assert.match(engine, /applyJutsu as applyPvpJutsu[^\n]*from '\.\.\/pvp\/move\.js'/);
        assert.match(engine, /resolver:\s*applyPvpJutsu/);
        assert.doesNotMatch(storyAction, /from '\.\.\/pvp\/move\.js'/,
            'the public MPvE route cannot bypass the shared Tower reducer');
        assert.doesNotMatch(pvpAction, /from '\.\.\/pvp\/move\.js'/,
            'the exact-2v2 command service cannot bypass the shared Tower reducer');
        assert.doesNotMatch(storyAction, /tile:\s*Math\.floor\(Number\(body\.tile\)\)/,
            'the MPvE route must not normalize malformed fractional tiles before engine validation');
        assert.doesNotMatch(pvpAction, /tile:\s*Math\.floor\(Number\(input\.tile\)\)/,
            'the exact-2v2 service must not normalize malformed fractional tiles before engine validation');
    });

    it('protects ordinary Tower recovery from deleting an MPvP lease', () => {
        const myRun = source('api/towers/my-run.ts');
        // The branch must cover BOTH MPvP sub-modes and must run before the
        // Story session read: neither the open queue nor a clan-war 2v2 stores a
        // `tower:<runId>` row, so falling through reads null and confirmed-missing
        // recovery would release a live match's lease.
        const pvpBranch = myRun.indexOf('isMpvpLeaseMode(battleLease?.meta.mode)');
        const towerRead = myRun.indexOf('const session = await readSession(runId)');
        assert.ok(pvpBranch > 0 && pvpBranch < towerRead);
        assert.match(myRun, /pvpMatchId: battleLease!\.battleId/);
        assert.match(myRun, /pvpMatchKind/, 'recovery must say which surface owns the match');

        // The predicate lives in shared/ so the CLIENT can route on it too; the
        // server guard re-exports it, so both trees resolve ONE implementation.
        const guard = source('api/_tower-battle-guard.ts');
        assert.match(guard, /export \{ isMpvpLeaseMode \} from '\.\.\/shared\/tower-pvp'/,
            'the server guard must re-export the shared predicate, not fork a second copy');
        const shared = source('shared/tower-pvp.ts');
        assert.match(shared, /export function isMpvpLeaseMode/);
        for (const mode of ["'mpvp'", "'clan-war-mpvp'", "'ranked-2v2'"]) {
            assert.ok(shared.includes(mode), `isMpvpLeaseMode must cover ${mode}`);
        }
        // Boot recovery used to test `mode === "mpvp"` literally, so a clan-war
        // or ranked 2v2 lease fell through: the match id was written into the
        // co-op tower run key and the player landed in the Spire lobby while
        // their live match ran on without them.
        assert.match(source('shinobij.client/src/App.tsx'),
            /const arena2v2 = isMpvpLeaseMode\(bootLock\.meta\?\.mode\)/,
            'client boot recovery must route on the shared predicate, not one literal mode');
    });

    it('never lets one Tower surface drive another surface\'s match', () => {
        // The open queue and a clan-war 2v2 share this match store and reducer.
        // Without a binding check a war member could cancel their challenge match
        // through the public `leave`, or zero-settle it through the public settle.
        const store = source('api/towers/_pvp-store.ts');
        assert.match(store, /function bindingMismatch\(/);
        assert.match(store, /code: 'wrong-surface'/);
        const queue = source('api/towers/pvp-queue.ts');
        assert.equal(queue.split("requireBinding: 'public-queue'").length - 1, 2,
            'both public ready and public leave must pin their surface');
        assert.match(source('api/towers/pvp-settle.ts'), /settleTowerPvpMatch\(matchId, slug, \{\}, 'public-queue'\)/);
        // Public presence must refuse a bound match even through a leaked pointer.
        assert.match(store, /towerPvpBindingOf\(match\)\.kind === 'public-queue'/);
    });

    it('publishes non-sensitive realtime revision hints for the full lifecycle', () => {
        const notify = source('api/_realtime/notify.ts');
        const realtime = source('api/towers/_pvp-realtime.ts');
        assert.match(notify, /channel: 'pvp'/);
        for (const reason of ['queued', 'matched', 'ready', 'action', 'settled', 'closed']) {
            assert.match(notify, new RegExp(`'${reason}'`));
        }
        assert.doesNotMatch(realtime, /combat|character|inviteCode/,
            'socket payloads must stay revision-only');
    });

    it('exports a typed exact-2v2 client contract', () => {
        const contract = source('shared/tower-pvp.ts');
        assert.match(contract, /TOWER_PVP_TEAM_SIZE = 2/);
        assert.match(contract, /TOWER_PVP_MATCH_SIZE = 4/);
        assert.match(contract, /TowerPvpMatchView/);
        assert.match(contract, /viewer: \{ teamId: TowerPvpTeamId; actorId: string \}/);
        assert.match(contract, /policy: 'no-progression-v1'/);
        assert.match(contract, /'forfeit'/);
    });
});

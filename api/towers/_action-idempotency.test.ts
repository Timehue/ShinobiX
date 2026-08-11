import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    TOWER_MOVE_TOKEN_HISTORY,
    bumpTowerActionVersion,
    commitTowerActionMetadata,
    inspectTowerActionCommand,
    towerActionVersion,
} from './_action-idempotency.js';
import { isTowerActionType, TOWER_ACTION_TYPES } from './_engine.js';
import type { TowerSession } from './_tower-session.js';

const token = (n: number) => `tower-move-token-${String(n).padStart(4, '0')}`;
const session = (recentMoveTokens: string[] = [], actionVersion = 0) => ({
    recentMoveTokens,
    actionVersion,
} as unknown as TowerSession);

describe('Tower action idempotency and optimistic recovery', () => {
    it('recognizes a committed token before rejecting its now-stale version', () => {
        const current = session([token(1)], 7);
        assert.deepEqual(inspectTowerActionCommand(current, {
            moveToken: token(1),
            expectedVersion: 6,
        }), {
            status: 'replay',
            moveToken: token(1),
            currentVersion: 7,
        });
    });

    it('returns the authoritative version for stale and malformed commands', () => {
        const current = session([], 4);
        assert.deepEqual(inspectTowerActionCommand(current, {
            moveToken: token(2),
            expectedVersion: 3,
        }), {
            status: 'stale',
            moveToken: token(2),
            expectedVersion: 3,
            currentVersion: 4,
        });
        assert.equal(inspectTowerActionCommand(current, { moveToken: 'short' }).status, 'invalid-token');
        assert.equal(inspectTowerActionCommand(current, { expectedVersion: -1 }).status, 'invalid-version');
    });

    it('records a successful token once, bounds the ring, and versions server mutations', () => {
        const current = session(Array.from({ length: TOWER_MOVE_TOKEN_HISTORY }, (_, i) => token(i)), 9);
        assert.equal(commitTowerActionMetadata(current, token(99)), 10);
        assert.equal(current.recentMoveTokens.length, TOWER_MOVE_TOKEN_HISTORY);
        assert.equal(current.recentMoveTokens.at(-1), token(99));
        assert.equal(current.recentMoveTokens.includes(token(0)), false);
        assert.equal(bumpTowerActionVersion(current), 11);
        assert.equal(towerActionVersion(current), 11);
    });

    it('wires replay recovery before turn/session guards and commits only after apply', () => {
        const source = readFileSync(resolve(process.cwd(), 'api/towers/action.ts'), 'utf8');
        const inspect = source.indexOf('const command = inspectTowerActionCommand');
        const doneGuard = source.indexOf("if (session.status !== 'active')");
        const apply = source.indexOf('const result = applyAction');
        const commit = source.indexOf('commitTowerActionMetadata(session');
        assert.ok(inspect >= 0 && doneGuard > inspect, 'duplicate recovery precedes completed/turn rejection');
        assert.ok(apply > doneGuard && commit > apply, 'token/version metadata commits only after applyAction succeeds');
        assert.match(source, /moveToken:\s*body\.moveToken/);
        assert.match(source, /expectedVersion:\s*body\.expectedVersion/);
        assert.match(source, /token:\s*command\.moveToken/);
    });

    it('rejects an unknown action type before AFK advancement or engine application', () => {
        assert.equal(isTowerActionType('wait'), true, 'explicit wait remains valid');
        assert.equal(isTowerActionType('summon'), true);
        assert.equal(isTowerActionType('stale-client-action'), false);
        assert.equal(isTowerActionType(undefined), false);
        assert.deepEqual(TOWER_ACTION_TYPES, [
            'move', 'dash', 'attack', 'jutsu', 'weapon', 'item', 'heal', 'cleanse', 'clear', 'summon', 'wait',
        ]);
        const source = readFileSync(resolve(process.cwd(), 'api/towers/action.ts'), 'utf8');
        const validation = source.indexOf('if (!isTowerActionType(type))');
        const afk = source.indexOf('autoPassAfkHumans(session');
        const apply = source.indexOf('const result = applyAction');
        assert.ok(validation >= 0 && validation < afk && afk < apply,
            'unknown types fail before any turn mutation or action application');
        assert.match(source, /reason:\s*'invalid-action-type'/);
    });
});

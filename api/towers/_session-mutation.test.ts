import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { LockContendedError } from '../_lock.js';
import { isAfkHumanTurnDue, TURN_AFK_MS } from './_tower-mp.js';
import { projectTowerSettlementState } from './_settlement-projection.js';
import {
    withTowerSessionMutation,
    type TowerSessionLock,
} from './_session-mutation.js';
import type { TowerSession } from './_tower-session.js';

function serialLock(): TowerSessionLock {
    const tails = new Map<string, Promise<void>>();
    return async <T>(target: string, fn: () => Promise<T>, options: { failClosed?: boolean }): Promise<T> => {
        assert.equal(options.failClosed, true);
        const previous = tails.get(target) ?? Promise.resolve();
        let release!: () => void;
        const mine = new Promise<void>(resolveMine => { release = resolveMine; });
        const tail = previous.then(() => mine);
        tails.set(target, tail);
        await previous;
        try {
            return await fn();
        } finally {
            release();
            if (tails.get(target) === tail) tails.delete(target);
        }
    };
}

describe('Tower authoritative session mutation locking', () => {
    it('fails closed before action state or idempotency receipts can mutate', async () => {
        const state = { actionVersion: 4, recentMoveTokens: [] as string[] };
        let callbackRan = false;
        const contended: TowerSessionLock = async (target, _fn, options) => {
            assert.equal(target, 'tower:run-lock-test');
            assert.equal(options.failClosed, true);
            throw new LockContendedError(target);
        };

        await assert.rejects(
            () => withTowerSessionMutation('run-lock-test', async () => {
                callbackRan = true;
                state.actionVersion += 1;
                state.recentMoveTokens.push('should-not-commit');
            }, contended),
            LockContendedError,
        );
        assert.equal(callbackRan, false);
        assert.deepEqual(state, { actionVersion: 4, recentMoveTokens: [] });
    });

    it('serializes action and state mutations on the exact same run key', async () => {
        const lock = serialLock();
        const events: string[] = [];
        let releaseAction!: () => void;
        let actionEntered!: () => void;
        const entered = new Promise<void>(resolveEntered => { actionEntered = resolveEntered; });
        const paused = new Promise<void>(resolveAction => { releaseAction = resolveAction; });

        const action = withTowerSessionMutation('shared-run', async () => {
            events.push('action:start');
            actionEntered();
            await paused;
            events.push('action:commit');
        }, lock);
        await entered;
        const state = withTowerSessionMutation('shared-run', async () => {
            events.push('state:afk-pass');
        }, lock);
        await new Promise(resolveTick => setImmediate(resolveTick));
        assert.deepEqual(events, ['action:start'], 'state cannot inspect/mutate behind the held action lock');
        releaseAction();
        await Promise.all([action, state]);
        assert.deepEqual(events, ['action:start', 'action:commit', 'state:afk-pass']);
    });

    it('uses a pure AFK preflight and cannot create a phantom turn before locking', () => {
        const session = {
            status: 'active',
            activeIndex: 0,
            turnQueue: ['alice'],
            turnStartedAt: 1,
            actors: [{ id: 'alice', ai: false, hp: 10 }],
            log: [],
        } as unknown as TowerSession;
        const before = structuredClone(session);
        assert.equal(isAfkHumanTurnDue(session, 1 + TURN_AFK_MS), true);
        assert.deepEqual(session, before);
    });

    it('keeps settled terminal evidence monotonic across a slower retryable caller', async () => {
        let stored = {
            runId: 'settlement-run',
            status: 'done',
            rewardSettlementState: 'pending',
        } as unknown as TowerSession;
        const lock = serialLock();
        const deps = {
            lock,
            async read() { return structuredClone(stored); },
            async write(next: TowerSession) { stored = structuredClone(next); },
        };

        const committed = await projectTowerSettlementState('settlement-run', true, deps);
        assert.equal(committed?.rewardSettlementState, 'settled');
        const staleRetry = await projectTowerSettlementState('settlement-run', false, deps);
        assert.equal(staleRetry?.rewardSettlementState, 'settled');
        assert.equal(stored.rewardSettlementState, 'settled');
    });

    it('pins action/state/settle routes to the fail-closed shared contract', () => {
        const source = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
        const action = source('api/towers/action.ts');
        assert.match(action, /withTowerSessionMutation\(runId/);
        assert.match(action, /status\(503\)/);
        assert.match(action, /setHeader\('Retry-After'/);
        assert.match(action, /applied:\s*false,[\s\S]{0,80}reason:\s*'not-your-turn'/);

        const state = source('api/towers/state.ts');
        const preflight = state.indexOf('isAfkHumanTurnDue(session, now)');
        const lock = state.indexOf('withTowerSessionMutation(runId');
        const mutation = state.indexOf('autoPassAfkHumans(fresh, now)');
        assert.ok(preflight >= 0 && lock > preflight && mutation > lock,
            'state performs only a pure preflight before locking and fresh-reading');
        assert.doesNotMatch(state, /autoPassAfkHumans\(session,/);
        assert.match(state, /status\(503\)/);
        assert.match(state, /setHeader\('Retry-After'/);

        const settle = source('api/towers/settle.ts');
        assert.match(settle, /projectTowerSettlementState\(runId, stable\)/);
        assert.match(settle, /authoritativeSession\.rewardSettlementState === 'settled'/);
        assert.match(settle, /status\(503\).*settled:\s*false/s);
    });
});

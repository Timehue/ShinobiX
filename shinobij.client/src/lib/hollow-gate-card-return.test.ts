import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Character, HollowGateShrineRun } from '../types/character';
import { finishHollowGateCardAmbushFlow } from './hollow-gate-card-return';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const character = { name: 'diver', hp: 100, maxHp: 10000 } as Character;
const binding = { token: 'live-run', nodeId: 'floor:1:ambush:threat-v20', matchId: 'match' };
const board = [{ kind: 'empty' }] as HollowGateShrineRun['tiles'];

function harness() {
    const state = { run: { runToken: binding.token, floor: 1, tiles: board, threat: 100 } as HollowGateShrineRun,
        screen: 'hollowGateTiles', closed: 0, cleared: 0, commits: 0, current: true, logs: [] as string[] };
    return { state, params: { character, binding, isCurrent: () => state.current,
        commitCharacter: () => { state.commits++; return false; },
        setRun: (update: unknown) => { state.run = typeof update === 'function' ? update(state.run) : update; },
        closeMatch: () => { state.closed++; }, clearRun: () => { state.cleared++; state.run = null!; },
        pushLog: (line: string) => state.logs.push(line), setScreen: (screen: string) => { state.screen = screen; },
    } };
}

for (const won of [true, false]) test(`a sealed card ${won ? 'win' : 'loss'} returns to its board even when the save version is already adopted`, async () => {
    const h = harness();
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ ok: true, won,
        character: { ...character, hp: won ? 100 : 1, hollowGateRun: { runToken: binding.token, floor: 1, threat: 0 } },
        _saveVersion: 4, reward: { ryo: 12, auraDust: 1 },
    }) })) as typeof fetch;
    await finishHollowGateCardAmbushFlow(h.params);
    assert.equal(h.state.run.tiles, board);
    assert.equal(h.state.run.threat, 0);
    assert.equal(h.state.screen, 'hollowGateShrine');
    assert.equal(h.state.closed, 1);
    assert.equal(h.state.cleared, 0);
});

test('a failed Continue leaves the binding intact; an acknowledged replay returns without another local HP effect', async () => {
    const h = harness();
    globalThis.fetch = (async () => { throw new Error('lost response'); }) as typeof fetch;
    await assert.rejects(finishHollowGateCardAmbushFlow(h.params), /unreachable/);
    assert.equal(h.state.closed, 0);
    assert.equal(h.state.screen, 'hollowGateTiles');
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ ok: true, won: false, alreadyReported: true,
        character: { ...character, hp: 1, hollowGateRun: { runToken: binding.token } }, _saveVersion: 4,
    }) })) as typeof fetch;
    await finishHollowGateCardAmbushFlow(h.params);
    assert.equal(h.state.closed, 1);
    assert.match(h.state.logs[0], /already sealed/);
    assert.equal(character.hp, 100, 'the client never computes or applies recoil');
});

test('an authoritative ended/zero-HP card result closes the stale board and routes to hospital', async () => {
    const h = harness();
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ ok: true, won: false, ended: true,
        character: { ...character, hp: 0, hospitalized: true, hollowGateRun: null }, _saveVersion: 4,
    }) })) as typeof fetch;
    await finishHollowGateCardAmbushFlow(h.params);
    assert.equal(h.state.run, null);
    assert.equal(h.state.cleared, 1);
    assert.equal(h.state.screen, 'hospital');
    assert.equal(h.state.logs.length, 0);
});

test('an old card reply cannot affect a different account/run after an await', async () => {
    const h = harness();
    let answer!: (value: unknown) => void;
    globalThis.fetch = (() => new Promise(resolve => { answer = resolve; })) as typeof fetch;
    const pending = finishHollowGateCardAmbushFlow(h.params);
    h.state.current = false;
    answer({ ok: true, json: async () => ({ ok: true, won: true, character: { ...character, hollowGateRun: null } }) });
    await pending;
    assert.equal(h.state.commits, 0);
    assert.equal(h.state.closed, 0);
    assert.equal(h.state.cleared, 0);
    assert.equal(h.state.screen, 'hollowGateTiles');
});

test('a mismatched server run cannot be committed or close the current card binding', async () => {
    const h = harness();
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ ok: true, won: true,
        character: { ...character, hollowGateRun: { runToken: 'another-run' } }, _saveVersion: 4,
    }) })) as typeof fetch;
    await assert.rejects(finishHollowGateCardAmbushFlow(h.params), /saved rift changed/);
    assert.equal(h.state.commits, 0);
    assert.equal(h.state.closed, 0);
});

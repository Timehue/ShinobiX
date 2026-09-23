import assert from 'node:assert/strict';
import { test } from 'node:test';
import { _makeMemoryKv } from '../_storage.js';
import { onlineStore } from '../_realtime/online-store.js';
import { noteBattleStarted } from '../_realtime/battle-projection.js';
import { resolveBattleAuthority, battleAuthorityKeys, battleEvidenceFrom } from '../_realtime/battle-authority.js';
import { releasePvpTerminalPresence } from './_terminal-presence.js';
import type { PvpSession } from './session.js';

test('terminal cleanup invalidates cached battle evidence and preserves a later fight or attack', async () => {
    const store = _makeMemoryKv();
    const name = 'terminal-presence-owner';
    const session = { battleId: 'old-terminal', createdAt: Date.now(), status: 'active', winner: null,
        p1: { name }, p2: { name: 'terminal-presence-opponent' },
        realFighters: { p1: true, p2: false }, lastMoveAt: Date.now(),
    } as PvpSession;
    onlineStore.upsert({ name, sector: 53, character: null });
    noteBattleStarted(name);
    await store.set(`pvp:${session.battleId}`, session);
    const pointer = { version: 1, playerName: name, battleId: session.battleId, role: 'p1',
        createdAt: session.createdAt, phase: 'active' };
    await store.set(`pvp:pending-session:${name}`, JSON.stringify(pointer));
    const evidence = battleEvidenceFrom(await store.mget(...battleAuthorityKeys(name)));
    assert.equal((await resolveBattleAuthority(name, evidence, { kv: store })).inBattle, true);
    const terminal = { ...session, status: 'done', winner: 'draw' } as PvpSession;
    await store.set(`pvp:${session.battleId}`, terminal);
    onlineStore.setPendingAttacker(name, { name: session.p2.name });
    await releasePvpTerminalPresence(store, terminal);
    assert.ok(onlineStore.moveToTile(name, 10));
    assert.equal(onlineStore.get(name)?.pendingAttacker, null);

    onlineStore.setPendingAttacker(name, { name: 'another-attacker' });
    await releasePvpTerminalPresence(store, terminal);
    assert.deepEqual(onlineStore.get(name)?.pendingAttacker, { name: 'another-attacker' });

    noteBattleStarted(name);
    const newerPointer = JSON.stringify({ ...pointer, battleId: 'new-duel', createdAt: session.createdAt + 1 });
    await store.set(`pvp:pending-session:${name}`, newerPointer);
    await releasePvpTerminalPresence(store, terminal);
    assert.equal(onlineStore.moveToTile(name, 11), null);
    assert.equal(await store.get(`pvp:pending-session:${name}`), newerPointer);

    await store.del(`pvp:pending-session:${name}`);
    await store.set(`battle-lock:${name}`, { battleId: 'new-tower' });
    await releasePvpTerminalPresence(store, terminal);
    assert.equal(onlineStore.moveToTile(name, 11), null);
    onlineStore.remove(name);
});

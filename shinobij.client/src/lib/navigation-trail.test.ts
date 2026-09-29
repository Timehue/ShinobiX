import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previousScreen, visitScreen, readNavigationTrail, writeNavigationTrail, clearNavigationTrail } from './navigation-trail';

test('returning from a completed encounter prunes it instead of creating a Back loop', () => {
    let trail = visitScreen([], 'village');
    trail = visitScreen(trail, 'worldMap');
    trail = visitScreen(trail, 'pvpBattle');
    assert.equal(previousScreen(trail, 'pvpBattle', 'village'), 'worldMap');
    trail = visitScreen(trail, 'worldMap');
    trail = visitScreen(trail, 'inventory');
    trail = visitScreen(trail, 'worldMap');
    assert.deepEqual(trail, ['village', 'worldMap']);
    assert.equal(previousScreen(trail, 'worldMap', 'village'), 'village');
});

test('transient profiles and battle records return to their actual origin', () => {
    assert.equal(previousScreen(['worldMap', 'tavern'], 'userView', 'village'), 'tavern');
    assert.equal(previousScreen(['centralHub', 'profile'], 'battleLog', 'village'), 'profile');
    assert.equal(previousScreen([], 'inventory', 'worldMap'), 'worldMap');
});

test('navigation survives refresh per account and discards broken or one-use routes', () => {
    const values = new Map<string, string>();
    const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
    } });
    try {
        writeNavigationTrail('Ninja', { screen: 'userView', trail: ['worldMap', 'tavern'] });
        assert.deepEqual(readNavigationTrail(' NINJA '), { screen: 'tavern', trail: ['worldMap', 'tavern'] });
        assert.equal(readNavigationTrail('Other'), null);
        writeNavigationTrail('Ninja', { screen: 'pets', trail: ['worldMap', 'home', 'pets'] });
        assert.equal(readNavigationTrail('Ninja')?.screen, 'pets');
        clearNavigationTrail('Ninja');
        assert.equal(readNavigationTrail('Ninja'), null);
        values.set('navigation.v1:ninja', '{broken');
        assert.equal(readNavigationTrail('Ninja'), null);
    } finally {
        if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
        else Reflect.deleteProperty(globalThis, 'sessionStorage');
    }
});

test('restricted browser storage never prevents a location fallback', () => {
    assert.doesNotThrow(() => writeNavigationTrail('Ninja', { screen: 'inventory', trail: ['worldMap', 'inventory'] }));
    assert.equal(readNavigationTrail('Ninja'), null);
});

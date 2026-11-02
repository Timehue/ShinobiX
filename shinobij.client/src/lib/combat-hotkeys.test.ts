import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_ACTIONS, DEFAULT_COMBAT_BINDINGS, bindingConflict, bindingLabel, combatBindingKey, combatJutsuSlotIds, equipmentHotkey, jutsuHotkey, keyFromEvent, normalizeBindings, readCombatBindings, saveCombatBindings } from './combat-hotkeys';

test('registry covers every requested slot with unique basic defaults', () => {
    assert.equal(COMBAT_ACTIONS.length, 30);
    const defaults = Object.values(DEFAULT_COMBAT_BINDINGS).filter(Boolean);
    assert.equal(new Set(defaults).size, defaults.length);
    assert.equal(DEFAULT_COMBAT_BINDINGS.endTurn, 'w');
    for (let i = 1; i <= 15; i++) assert.equal(DEFAULT_COMBAT_BINDINGS[`jutsu${i}`], '');
    assert.equal(bindingConflict(DEFAULT_COMBAT_BINDINGS, 'jutsu1', 'a')?.label, 'Attack');
    assert.equal(bindingConflict(DEFAULT_COMBAT_BINDINGS, 'attack', 'a'), undefined);
    assert.equal(bindingConflict(DEFAULT_COMBAT_BINDINGS, 'jutsu1', ''), undefined);
});
test('malformed preferences and reserved keys cannot create duplicate actions', () => {
    assert.deepEqual(normalizeBindings(null), DEFAULT_COMBAT_BINDINGS);
    assert.deepEqual(normalizeBindings([]), DEFAULT_COMBAT_BINDINGS);
    const bindings = normalizeBindings({ attack: 'shift+q', jutsu1: 'shift+q', item1: 'escape', item2: 'ctrl+r', item3: 12, deselect: '' });
    assert.equal(bindings.jutsu1, 'shift+q');
    assert.equal(bindings.attack, '');
    assert.equal(bindings.item1, '');
    assert.equal(bindings.item2, '');
    assert.equal(bindings.item3, '');
    assert.equal(bindings.deselect, 'escape');
});
test('keyboard normalization accepts Shift and rejects repeats, composition, browser modifiers', () => {
    const event = { key: 'A', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, repeat: false, isComposing: false };
    assert.equal(keyFromEvent(event), 'shift+a');
    assert.equal(keyFromEvent({ ...event, key: '!' }), 'shift+1');
    assert.equal(keyFromEvent({ ...event, key: ' ', shiftKey: false }), 'space');
    for (const key of ['[', ']', '\\', '-', '=', '/', ';', "'", '.', ',', '`']) assert.equal(keyFromEvent({ ...event, key, shiftKey: false }), key);
    assert.equal(keyFromEvent({ ...event, key: 'ArrowUp', shiftKey: false }), 'arrowup');
    assert.equal(bindingLabel('shift+arrowleft'), 'Shift+ArrowLeft');
    assert.equal(keyFromEvent({ ...event, key: 'Enter', shiftKey: false }), 'enter');
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey', 'repeat', 'isComposing']) assert.equal(keyFromEvent({ ...event, [modifier]: true }), null);
    for (const key of ['Tab', 'F5', 'Shift', 'Dead', 'Unidentified']) assert.equal(keyFromEvent({ ...event, key }), null);
});
test('slot identities retain empty positions and do not assign armor or throwables to the weapon slot', () => {
    const ids = Array.from({ length: 15 }, (_, i) => i === 3 ? '' : `technique-${i}`);
    for (let i = 0; i < 15; i++) if (i !== 3) assert.equal(jutsuHotkey(ids[i], ids), `jutsu${i + 1}`);
    assert.equal(jutsuHotkey('', ids), undefined);
    assert.equal(jutsuHotkey('absent', ids), undefined);
    const equipment = { hand: 'blade', item1: 'pill', item3: 'smoke', potion: 'tonic', body: 'armor', thrown: 'dart' };
    for (const [id, action] of [['blade', 'weapon'], ['pill', 'item1'], ['smoke', 'item3'], ['tonic', 'item4']]) assert.equal(equipmentHotkey(id, equipment), action);
    assert.equal(equipmentHotkey('dart', equipment), undefined);
    assert.equal(equipmentHotkey('armor', equipment), undefined);
    assert.equal(equipmentHotkey('old-pill', { item: 'old-pill' }), 'item1');
    assert.equal(equipmentHotkey('old-pill', { item1: '', item: 'old-pill' }), 'item1');
    assert.equal(equipmentHotkey('blade', { weapon: 'blade' }), 'weapon');
    assert.equal(equipmentHotkey('blade', { hand: '', weapon: 'blade' }), 'weapon');
    assert.equal(equipmentHotkey('blade', { hand: 123, weapon: 'blade' }), 'weapon');
    assert.equal(equipmentHotkey('other-blade', { hand: 'blade', weapon: 'other-blade' }), undefined);
});
test('fight slot order uses the sealed snapshot and falls back for sessions without slot metadata', () => {
    const jutsu = [{ id: 'second' }, { id: 'first' }, { id: 'legacy-test-signature' }];
    const slots = combatJutsuSlotIds(['deleted-technique', 'first', '', 'first', 'second', null], jutsu);
    assert.equal(jutsuHotkey('first', slots), 'jutsu1');
    assert.equal(jutsuHotkey('second', slots), 'jutsu2');
    assert.equal(jutsuHotkey('legacy-test-signature', slots), undefined);
    assert.deepEqual(combatJutsuSlotIds(undefined, jutsu), ['second', 'first']);
    assert.deepEqual(combatJutsuSlotIds([], jutsu), ['second', 'first']);
    assert.deepEqual(combatJutsuSlotIds(['first', 'not-in-fight'], jutsu), ['first', 'second']);
    assert.deepEqual(combatJutsuSlotIds([], [{ id: 'legacy-test-signature' }]), []);
});
test('preferences persist per player, reset, unbind, and tolerate storage failures', () => {
    const storage = new Map<string, string>();
    const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    try {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } });
        Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
        saveCombatBindings('KeyPlayer', { ...DEFAULT_COMBAT_BINDINGS, jutsu15: 'shift+5', attack: '' });
        assert.equal(readCombatBindings('keyplayer').jutsu15, 'shift+5');
        assert.equal(readCombatBindings('keyplayer').attack, '');
        assert.equal(readCombatBindings('DifferentPlayer').jutsu15, '');
        assert.ok(storage.has(combatBindingKey('KEYPLAYER')));
        saveCombatBindings('KeyPlayer', { ...DEFAULT_COMBAT_BINDINGS });
        assert.deepEqual(readCombatBindings('KeyPlayer'), DEFAULT_COMBAT_BINDINGS);
        storage.set(combatBindingKey('broken'), '{invalid');
        assert.deepEqual(readCombatBindings('broken'), DEFAULT_COMBAT_BINDINGS);
        storage.set(combatBindingKey('quota-keys'), JSON.stringify(DEFAULT_COMBAT_BINDINGS));
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null, setItem() { throw new Error('Quota exceeded'); } } });
        saveCombatBindings('quota-keys', { ...DEFAULT_COMBAT_BINDINGS, weapon: 'q' });
        assert.equal(readCombatBindings('quota-keys').weapon, 'q');
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Unavailable'); } });
        saveCombatBindings('offline-keys', { ...DEFAULT_COMBAT_BINDINGS, weapon: 'q' });
        assert.equal(readCombatBindings('offline-keys').weapon, 'q');
    } finally {
        if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
        if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window');
    }
});

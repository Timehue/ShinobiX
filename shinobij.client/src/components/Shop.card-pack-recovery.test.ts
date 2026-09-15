import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { after, afterEach, beforeEach, test } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Character } from '../types/character';

// Render the actual Shop component in Node. Only stylesheet imports are inert;
// the separate real Express browser regression verifies interaction and layout.
const cssHook = registerHooks({
    load(url, context, nextLoad) {
        if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
        return nextLoad(url, context);
    },
});
// The root tsx runner uses classic JSX; Vite supplies the automatic JSX runtime.
// Provide that render-only binding in this isolated test process, then restore it.
const originalReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
const { Shop, GrandMarketplace } = await import('./Shop');
after(() => {
    cssHook.deregister();
    if (originalReact) Object.defineProperty(globalThis, 'React', originalReact);
    else Reflect.deleteProperty(globalThis, 'React');
});

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
let storage: Map<string, string>;
beforeEach(() => {
    storage = new Map();
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: {
        getItem: (key: string) => storage.get(key) ?? null,
    } });
});
afterEach(() => {
    if (originalStorage) Object.defineProperty(globalThis, 'sessionStorage', originalStorage);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
});

function fixture(extra: Partial<Character> = {}): Character {
    return {
        name: 'packshoprender', level: 3, ryo: 0, fateShards: 0, chroniclePoints: 0,
        starterCardsClaimed: true, tileCards: [], inventory: [], equipment: {},
        ...extra,
    } as Character;
}

function renderedPackButton(character: Character, tier: 'standard' | 'epic' | 'legendary') {
    const html = renderToStaticMarkup(createElement(tier === 'standard' ? Shop : GrandMarketplace, {
        character, creatorItems: [], creatorCards: [], onBack() {}, onVersionedCharacter: () => true,
    }));
    const label = { standard: 'Basic Card Pack', epic: 'Elite Pack', legendary: 'Legendary Pack' }[tier];
    const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
        .find((entry) => entry[2].replace(/<[^>]*>/g, '').includes(label));
    assert.ok(button, `${label} must be an existing rendered control`);
    const text = button[2].replace(/<[^>]*>/g, '');
    if (tier === 'epic') {
        assert.match(text, /Elite Pack — 1 card \(top-tier Rare or Epic\)/);
        assert.doesNotMatch(text, /guaranteed Epic/i);
    }
    return { disabled: /\bdisabled(?:=|\s|$)/.test(button[1]), text };
}

for (const tier of ['standard', 'epic', 'legendary'] as const) {
    test(`${tier}: an exhausted wallet enables only the existing pending-pack recovery control`, () => {
        const character = fixture();
        assert.equal(renderedPackButton(character, tier).disabled, true);
        storage.set(`shinobix.card-pack:${JSON.stringify({ playerName: character.name, packType: tier })}`, 'valid_pending_pack_123456');
        const pending = renderedPackButton(character, tier);
        assert.equal(pending.disabled, false);
        assert.match(pending.text, /Recover/);
        assert.match(pending.text, tier === 'standard' ? /100 Chronicle Points/ : tier === 'epic' ? /10 Fate Shards/ : /30 Fate Shards/);
        for (const other of ['standard', 'epic', 'legendary'] as const) {
            if (other !== tier) assert.equal(renderedPackButton(character, other).disabled, true);
        }
    });
}

test('malformed or another account pending state cannot enable an unfunded pack', () => {
    const character = fixture();
    storage.set(`shinobix.card-pack:${JSON.stringify({ playerName: character.name, packType: 'standard' })}`, 'bad');
    storage.set(`shinobix.card-pack:${JSON.stringify({ playerName: 'another-player', packType: 'standard' })}`, 'valid_pending_pack_123456');
    const button = renderedPackButton(character, 'standard');
    assert.equal(button.disabled, true);
    assert.doesNotMatch(button.text, /Recover/);
});

test('ordinary funded purchases retain their enabled controls and purchase wording', () => {
    const character = fixture({ chroniclePoints: 100, fateShards: 30 });
    for (const tier of ['standard', 'epic', 'legendary'] as const) {
        const button = renderedPackButton(character, tier);
        assert.equal(button.disabled, false);
        assert.doesNotMatch(button.text, /Recover/);
    }
});

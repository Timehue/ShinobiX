import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, test } from 'node:test';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Character } from '../types/character';
import type { CardPackType } from '../lib/card-pack';
import { cacheVillageElders, resetVillageElders } from '../lib/village-elder-focus';
import { CARD_PACK_TYPES, applyCardPackOpen } from '../../../api/card-clash/_pack';
import { packArtUrl, packTheme } from '../lib/card-pack-reveal';

// Vite supplies the automatic JSX runtime; the node test runner needs this
// render-only binding for components compiled with the classic transform.
const originalReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
const { ChroniclePackGallery } = await import('./ChroniclePackGallery');
after(() => {
    if (originalReact) Object.defineProperty(globalThis, 'React', originalReact);
    else Reflect.deleteProperty(globalThis, 'React');
});

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
let storage: Map<string, string>;
beforeEach(() => {
    resetVillageElders();
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
        name: 'packhallrender', level: 20, ryo: 0, fateShards: 0, chroniclePoints: 0,
        starterCardsClaimed: true, tileCards: [], inventory: [], equipment: {},
        ...extra,
    } as Character;
}

function renderedGallery(character: Character) {
    return renderToStaticMarkup(createElement(ChroniclePackGallery, {
        character, cardsById: {}, onVersionedCharacter: () => true,
    }));
}

function renderedPackButton(character: Character, type: CardPackType) {
    const html = renderedGallery(character);
    const article = html.match(new RegExp(`<article class="chronicle-pack chronicle-pack--${type}"[\\s\\S]*?<\\/article>`))?.[0];
    assert.ok(article, `${type} pack must appear in the Card Hall gallery`);
    const button = article.match(/<button\b([^>]*)>([\s\S]*?)<\/button>/);
    assert.ok(button, `${type} pack must have an opening control`);
    return { disabled: /\bdisabled(?:=|\s|$)/.test(button[1]), text: button[2].replace(/<[^>]*>/g, '') };
}

for (const type of CARD_PACK_TYPES) {
    test(`${type}: an exhausted wallet enables only a pending-pack recovery control`, () => {
        const character = fixture();
        assert.equal(renderedPackButton(character, type).disabled, true);
        storage.set(`shinobix.card-pack:${JSON.stringify({ playerName: character.name, packType: type })}`, 'valid_pending_pack_123456');
        const pending = renderedPackButton(character, type);
        assert.equal(pending.disabled, false);
        assert.match(pending.text, /Recover/);
        assert.match(pending.text, type === 'epic' ? /10 Fate Shards/ : type === 'legendary' ? /30 Fate Shards/ : type === 'epic-five' ? /35 Fate Shards/ : type === 'legendary-five' ? /100 Fate Shards/ : /100 Chronicle Points/);
    });
}

test('every server pack has exactly one gallery listing with the same cinematic label and artwork', () => {
    const html = renderedGallery(fixture({ fateShards: 100, chroniclePoints: 100 }));
    assert.equal((html.match(/<article\b/g) ?? []).length, CARD_PACK_TYPES.length);
    for (const type of CARD_PACK_TYPES) {
        const article = html.match(new RegExp(`<article class="chronicle-pack chronicle-pack--${type}"[\\s\\S]*?<\\/article>`))?.[0];
        assert.ok(article, type);
        assert.ok(article.includes(`src="${packArtUrl(type)}"`), `${type} must use the same art in the gallery and foil`);
        assert.ok(article.includes(`<h3>${packTheme(type).label}</h3>`), `${type} must use the same label in the gallery and cinematic`);
        assert.equal(renderedPackButton(fixture({ fateShards: 100, chroniclePoints: 100 }), type).disabled, false);
        const serverDraw = applyCardPackOpen({ fateShards: 100, chroniclePoints: 100, tileCards: [] }, type, () => 0);
        assert.equal(serverDraw.ok, true);
        if (serverDraw.ok) {
            const currency = serverDraw.currency === 'fateShards' ? 'Fate Shards' : 'Chronicle Points';
            assert.ok(renderedPackButton(fixture(), type).text.includes(`${serverDraw.cost} ${currency}`), `${type} price must match the server`);
            assert.ok(article.includes(`<span>${serverDraw.cards.length} ${serverDraw.cards.length === 1 ? 'card' : 'cards'}</span>`), `${type} card count must match the server`);
        }
    }
});

test('malformed or another account pending state cannot enable an unfunded pack', () => {
    const character = fixture();
    storage.set(`shinobix.card-pack:${JSON.stringify({ playerName: character.name, packType: 'fire' })}`, 'bad');
    storage.set(`shinobix.card-pack:${JSON.stringify({ playerName: 'another-player', packType: 'fire' })}`, 'valid_pending_pack_123456');
    assert.equal(renderedPackButton(character, 'fire').disabled, true);
});

for (const [type, cost] of [['epic-five', 35], ['legendary-five', 100]] as const) {
    test(`${type}: purchase requires its full price and displays five guaranteed cards`, () => {
        assert.equal(renderedPackButton(fixture({ fateShards: cost - 1 }), type).disabled, true);
        assert.equal(renderedPackButton(fixture({ fateShards: cost }), type).disabled, false);
        assert.match(renderedGallery(fixture()), /5 random Epic cards/);
        assert.match(renderedGallery(fixture()), /5 random Legendary cards/);
        const discounted = Math.floor(cost * .95);
        cacheVillageElders('Pack test village', ['', 'Rin', ''], Date.now() + 86400000);
        const tradeCharacter = fixture({ village: 'Pack test village', fateShards: discounted, elderFocus: 'trade' });
        assert.equal(renderedPackButton(tradeCharacter, type).disabled, false);
        assert.match(renderedPackButton(tradeCharacter, type).text,
            new RegExp(`${discounted} Fate Shards`));
    });
}

test('the gallery shows all six illustrated Basic packs and states the draw rules', () => {
    const html = renderedGallery(fixture({ chroniclePoints: 100, fateShards: 30 }));
    for (const type of ['standard', 'fire', 'water', 'earth', 'wind', 'lightning'] as const) {
        assert.equal(renderedPackButton(fixture({ chroniclePoints: 100 }), type).disabled, false);
        assert.match(html, new RegExp(`/chronicle/packs/${type === 'standard' ? 'random' : type}\\.webp`));
    }
    assert.match(html, /Elemental packs draw only matching-element Monsters/);
    assert.match(html, /The Random Pack draws from every eligible Basic card/);
    assert.match(html, /every card is equally likely/);
    assert.match(html, /duplicates can appear within a pack or across packs regardless of owned copies/);
    assert.match(html, /Elite draws a Marketplace Rare or Epic/);
    assert.match(html, /Legendary is always Legendary/);
    const odds = html.indexOf('chronicle-pack-gallery__odds');
    const firstPack = html.indexOf('<article');
    assert.ok(odds >= 0 && firstPack > odds, 'draw rules must precede the first pack purchase control');
});

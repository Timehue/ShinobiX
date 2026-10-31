import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
    BRIGHTNESS_DEFAULT,
    BRIGHTNESS_MAX,
    BRIGHTNESS_MIN,
    applyDisplayBrightness,
    brightnessFilter,
    getDisplayBrightness,
    setDisplayBrightness,
} from './display-brightness.ts';

const stored = new Map<string, string>();
const rootStyle = { filter: '' };

Object.assign(globalThis, {
    localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => { stored.set(key, value); },
    },
    document: { documentElement: { style: rootStyle } },
});

beforeEach(() => {
    stored.clear();
    rootStyle.filter = '';
});

test('the default level applies no filter at all', () => {
    assert.equal(brightnessFilter(BRIGHTNESS_DEFAULT), 'none');
    applyDisplayBrightness();
    assert.equal(rootStyle.filter, '');
});

test('lighter eases contrast before brightening so shadows lift', () => {
    assert.equal(brightnessFilter(140), 'contrast(0.860) brightness(1.4)');
});

test('darker only dims', () => {
    assert.equal(brightnessFilter(80), 'brightness(0.8)');
});

test('a corrupt or out-of-range stored value cannot black out the game', () => {
    stored.set('displayBrightness.v1', 'not-a-number');
    assert.equal(getDisplayBrightness(), BRIGHTNESS_DEFAULT);
    stored.set('displayBrightness.v1', '0');
    assert.equal(getDisplayBrightness(), BRIGHTNESS_MIN);
    stored.set('displayBrightness.v1', '9000');
    assert.equal(getDisplayBrightness(), BRIGHTNESS_MAX);
});

test('setting a level saves it and applies it, and the default clears the filter', () => {
    setDisplayBrightness(130);
    assert.equal(getDisplayBrightness(), 130);
    assert.match(rootStyle.filter, /brightness\(1\.3\)/);
    setDisplayBrightness(BRIGHTNESS_DEFAULT);
    assert.equal(rootStyle.filter, '');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { sharedAvatarFor } from './shared-avatar';

test('a spaced display name finds the row its creator published under the display name', () => {
    assert.equal(sharedAvatarFor({ 'avatar:kaede morrow': 'data:img' }, 'Kaede Morrow'), 'data:img');
    assert.equal(sharedAvatarFor({ 'avatar:kaede morrow': 'data:img' }, ' Kaede Morrow '), 'data:img');
});

test('a row published under the account slug is found too', () => {
    assert.equal(sharedAvatarFor({ 'avatar:kaedemorrow': 'data:slug' }, 'Kaede Morrow'), 'data:slug');
});

test('the display-name row wins when both spellings exist', () => {
    assert.equal(sharedAvatarFor({ 'avatar:kaede morrow': 'data:name', 'avatar:kaedemorrow': 'data:slug' }, 'Kaede Morrow'), 'data:name');
});

test('a caller holding only the account slug still finds the display-name row', () => {
    // Ranked, spectate and other server records carry safeName(name), which
    // cannot be turned back into "kaede morrow".
    const images = { 'jutsu:x': 'data:jutsu', 'avatar:ada': 'data:ada', 'avatar:kaede morrow': 'data:name' };
    assert.equal(sharedAvatarFor(images, 'kaedemorrow'), 'data:name');
    assert.equal(sharedAvatarFor(images, 'KaedeMorrow'), 'data:name');
    assert.equal(sharedAvatarFor(images, 'ada'), 'data:ada');
    assert.equal(sharedAvatarFor(images, 'kaede'), '');
});

test('a new bucket object is re-indexed, so a portrait published later shows up', () => {
    const before = { 'avatar:ada': 'data:ada' };
    assert.equal(sharedAvatarFor(before, 'kaedemorrow'), '');
    const after = { ...before, 'avatar:kaede morrow': 'data:name' };
    assert.equal(sharedAvatarFor(after, 'kaedemorrow'), 'data:name');
});

test('a name with no slug characters still uses its exact key', () => {
    assert.equal(sharedAvatarFor({ 'avatar:忍者': 'data:kanji' }, '忍者'), 'data:kanji');
    assert.equal(sharedAvatarFor({ 'avatar:忍者': 'data:kanji' }, '影'), '');
});

test('no row gives an empty string, so callers fall back to the character field', () => {
    assert.equal(sharedAvatarFor({}, 'Kaede Morrow'), '');
    assert.equal(sharedAvatarFor(undefined, 'Kaede Morrow'), '');
});

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

test('no row gives an empty string, so callers fall back to the character field', () => {
    assert.equal(sharedAvatarFor({}, 'Kaede Morrow'), '');
    assert.equal(sharedAvatarFor(undefined, 'Kaede Morrow'), '');
});

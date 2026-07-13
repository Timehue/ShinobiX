"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _mutate_player_save_js_1 = require("./_mutate-player-save.js");
(0, node_test_1.describe)('_mutate-player-save', () => {
    (0, node_test_1.it)('bumps the stored player save version', () => {
        const current = { _saveVersion: 7, character: { name: 'Old', ryo: 10 } };
        const nextCharacter = { name: 'Old', ryo: 20 };
        const out = (0, _mutate_player_save_js_1.versionedPlayerRecord)(current, nextCharacter);
        node_assert_1.strict.equal(out._saveVersion, 8);
        node_assert_1.strict.equal(out.record._saveVersion, 8);
        node_assert_1.strict.equal(out.record.character, nextCharacter);
    });
    (0, node_test_1.it)('does not mutate the input save record', () => {
        const current = { _saveVersion: 2, character: { name: 'Old', ryo: 10 } };
        (0, _mutate_player_save_js_1.versionedPlayerRecord)(current, { name: 'Old', ryo: 20 });
        node_assert_1.strict.equal(current._saveVersion, 2);
        node_assert_1.strict.deepEqual(current.character, { name: 'Old', ryo: 10 });
    });
    (0, node_test_1.it)('starts absent versions at one', () => {
        const out = (0, _mutate_player_save_js_1.versionedPlayerRecord)({ character: { name: 'Old' } }, { name: 'Old' });
        node_assert_1.strict.equal(out._saveVersion, 1);
    });
    (0, node_test_1.it)('applies an atomic top-level record patch with the character mutation', () => {
        const current = { _saveVersion: 3, activeTraining: { token: 'abc' }, character: { name: 'Old', stamina: 10 } };
        const out = (0, _mutate_player_save_js_1.versionedPlayerRecord)(current, { name: 'Old', stamina: 5 }, { activeTraining: null });
        node_assert_1.strict.equal(out._saveVersion, 4);
        node_assert_1.strict.equal(out.record.activeTraining, null);
        node_assert_1.strict.deepEqual(out.record.character, { name: 'Old', stamina: 5 });
        node_assert_1.strict.deepEqual(current.activeTraining, { token: 'abc' });
    });
});

"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _name__js_1 = require("./[name].js");
const _titles_registry_js_1 = require("../_titles-registry.js");
const sanitize = (incoming, existing) => (0, _name__js_1.sanitizeCharacterSave)({ character: incoming }, existing ? { character: existing } : null).character;
const SERVER_TITLE = 'Eternal Duel Sovereign';
const ACH_TITLE = 'Season Champion';
const FREE_TITLE = 'Wandering Blade';
(0, node_test_1.test)('title registry still distinguishes strict, earned, and free-text titles', () => {
    strict_1.default.equal((0, _titles_registry_js_1.isServerCreditedTitle)(SERVER_TITLE), true);
    strict_1.default.equal((0, _titles_registry_js_1.isKnownEarnedTitle)(ACH_TITLE), true);
    strict_1.default.equal((0, _titles_registry_js_1.isServerCreditedTitle)(ACH_TITLE), false);
    strict_1.default.equal((0, _titles_registry_js_1.isKnownEarnedTitle)(FREE_TITLE), false);
});
(0, node_test_1.test)('generic saves preserve the committed title and paid cosmetics', () => {
    const existing = { customTitle: ACH_TITLE, customTitleStyle: 'ember', customTitleIcon: '⭐', earnedTitles: [ACH_TITLE] };
    const out = sanitize({ customTitle: FREE_TITLE, customTitleStyle: 'royal', customTitleIcon: '🔥' }, existing);
    strict_1.default.equal(out.customTitle, ACH_TITLE);
    strict_1.default.equal(out.customTitleStyle, 'ember');
    strict_1.default.equal(out.customTitleIcon, '⭐');
});
(0, node_test_1.test)('incoming ownership proofs cannot authorize a title change', () => {
    const out = sanitize({ customTitle: SERVER_TITLE, legacy: { titles: [SERVER_TITLE] }, serverTitles: [SERVER_TITLE] }, { customTitle: '' });
    strict_1.default.equal(out.customTitle, '');
});
(0, node_test_1.test)('first save cannot bootstrap a custom title or paid cosmetics', () => {
    const out = sanitize({ customTitle: FREE_TITLE, customTitleStyle: 'ember', customTitleIcon: '⭐' }, null);
    strict_1.default.equal(out.customTitle, undefined);
    strict_1.default.equal(out.customTitleStyle, undefined);
    strict_1.default.equal(out.customTitleIcon, undefined);
});

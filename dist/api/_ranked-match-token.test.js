"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _ranked_match_token_js_1 = require("./_ranked-match-token.js");
// The token's security rests on the KEY: it must identify the unordered pair of
// fighters on a specific ladder, so a token minted for (A,B) on the player
// ladder is found regardless of which fighter creates the session, and can NOT
// be confused with a different pair or the pet ladder. mint/consume are thin
// kv.set/kv.del wrappers (kv.del's row count gives the atomic single-use check),
// so the key derivation is the load-bearing logic to pin down here.
(0, node_test_1.test)('rankedMatchTokenKey is independent of fighter order', () => {
    strict_1.default.equal((0, _ranked_match_token_js_1.rankedMatchTokenKey)('Alice', 'Bob', 'player'), (0, _ranked_match_token_js_1.rankedMatchTokenKey)('Bob', 'Alice', 'player'));
});
(0, node_test_1.test)('rankedMatchTokenKey separates the player and pet ladders', () => {
    strict_1.default.notEqual((0, _ranked_match_token_js_1.rankedMatchTokenKey)('Alice', 'Bob', 'player'), (0, _ranked_match_token_js_1.rankedMatchTokenKey)('Alice', 'Bob', 'pet'));
});
(0, node_test_1.test)('rankedMatchTokenKey canonicalizes names via safeName', () => {
    // safeName lowercases and strips non [a-z0-9-_]; display casing / spaces /
    // punctuation must resolve to the same key as the stored slug.
    strict_1.default.equal((0, _ranked_match_token_js_1.rankedMatchTokenKey)('Alice', 'Bob', 'player'), (0, _ranked_match_token_js_1.rankedMatchTokenKey)('  ALICE ', 'B!o!b', 'player'));
});
(0, node_test_1.test)('rankedMatchTokenKey distinguishes different pairs', () => {
    strict_1.default.notEqual((0, _ranked_match_token_js_1.rankedMatchTokenKey)('alice', 'bob', 'player'), (0, _ranked_match_token_js_1.rankedMatchTokenKey)('alice', 'carol', 'player'));
});
(0, node_test_1.test)('rankedMatchTokenKey has the expected shape', () => {
    // Sorted slugs, ladder in the middle segment.
    strict_1.default.equal((0, _ranked_match_token_js_1.rankedMatchTokenKey)('Bob', 'Alice', 'player'), 'pvp:ranked-match-token:player:alice:bob');
});

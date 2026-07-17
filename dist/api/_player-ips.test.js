"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const node_assert_1 = require("node:assert");
const _player_ips_js_1 = require("./_player-ips.js");
// The heartbeat re-stamp throttle: a (player, ip/fp) pair is written to storage
// at most once per window. The invariant that protects anti-alt detection is
// that NEW pairs always write on first sight and the throttle only skips a
// redundant TTL refresh — never changes what is recorded.
(0, node_test_1.describe)('_shouldStamp — player-ip re-stamp throttle', () => {
    (0, node_test_1.beforeEach)(() => (0, _player_ips_js_1._resetPlayerIpStampMemo)());
    (0, node_test_1.it)('writes on first sight of a pair', () => {
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)('player-ip:rin:1.2.3.4', 1_000), true);
    });
    (0, node_test_1.it)('skips a redundant write inside the window, writes again after it', () => {
        const key = 'player-ip:rin:1.2.3.4';
        const WINDOW = 5 * 60_000;
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)(key, 0), true); // first sight → write
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)(key, 1_000), false); // 1s later → skip
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)(key, WINDOW - 1), false); // still inside window → skip
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)(key, WINDOW + 1), true); // window elapsed → write (TTL refresh)
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)(key, WINDOW + 2), false); // and the window restarts
    });
    (0, node_test_1.it)('a different ip or fp for the same player always writes immediately', () => {
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)('player-ip:rin:1.1.1.1', 0), true);
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)('player-ip:rin:2.2.2.2', 0), true); // new ip → write
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)('player-fp:rin:deadbeef', 0), true); // new fp → write
    });
    (0, node_test_1.it)('a cleared memo (process restart) re-stamps rather than dropping a write', () => {
        const key = 'player-ip:rin:1.2.3.4';
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)(key, 0), true);
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)(key, 1_000), false);
        (0, _player_ips_js_1._resetPlayerIpStampMemo)(); // simulate restart
        node_assert_1.strict.equal((0, _player_ips_js_1._shouldStamp)(key, 2_000), true); // strictly more writes, never fewer
    });
});

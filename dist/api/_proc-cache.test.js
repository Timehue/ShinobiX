"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _proc_cache_js_1 = require("./_proc-cache.js");
(0, node_test_1.test)('serves the cached value within the TTL (one build)', async () => {
    (0, _proc_cache_js_1.__clearProcCache)();
    let t = 1000;
    const now = () => t;
    let builds = 0;
    const build = async () => { builds++; return builds; };
    const a = await (0, _proc_cache_js_1.cachedFor)('k1', 100, build, now);
    t = 1050; // still inside the 100ms window
    const b = await (0, _proc_cache_js_1.cachedFor)('k1', 100, build, now);
    strict_1.default.equal(a, 1);
    strict_1.default.equal(b, 1);
    strict_1.default.equal(builds, 1);
});
(0, node_test_1.test)('rebuilds after the TTL elapses', async () => {
    (0, _proc_cache_js_1.__clearProcCache)();
    let t = 1000;
    const now = () => t;
    let builds = 0;
    const build = async () => { builds++; return builds; };
    await (0, _proc_cache_js_1.cachedFor)('k2', 100, build, now);
    t = 1100; // exactly at the boundary → stale
    const b = await (0, _proc_cache_js_1.cachedFor)('k2', 100, build, now);
    strict_1.default.equal(b, 2);
    strict_1.default.equal(builds, 2);
});
(0, node_test_1.test)('single-flights concurrent builds (one underlying read)', async () => {
    (0, _proc_cache_js_1.__clearProcCache)();
    const now = () => 1000;
    let builds = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const build = () => { builds++; return gate; };
    const p1 = (0, _proc_cache_js_1.cachedFor)('k3', 100, build, now);
    const p2 = (0, _proc_cache_js_1.cachedFor)('k3', 100, build, now);
    release(7);
    const [a, b] = await Promise.all([p1, p2]);
    strict_1.default.equal(a, 7);
    strict_1.default.equal(b, 7);
    strict_1.default.equal(builds, 1);
});
(0, node_test_1.test)('does not cache a rejected build', async () => {
    (0, _proc_cache_js_1.__clearProcCache)();
    const now = () => 1000;
    let calls = 0;
    const build = async () => { calls++; if (calls === 1)
        throw new Error('boom'); return calls; };
    await strict_1.default.rejects((0, _proc_cache_js_1.cachedFor)('k4', 1000, build, now));
    const v = await (0, _proc_cache_js_1.cachedFor)('k4', 1000, build, now); // retries with a live read
    strict_1.default.equal(v, 2);
    strict_1.default.equal(calls, 2);
});
(0, node_test_1.test)('invalidateProcCache forces the next read to rebuild', async () => {
    (0, _proc_cache_js_1.__clearProcCache)();
    const now = () => 1000;
    let builds = 0;
    const build = async () => { builds++; return builds; };
    await (0, _proc_cache_js_1.cachedFor)('k5', 100000, build, now);
    (0, _proc_cache_js_1.invalidateProcCache)('k5');
    const v = await (0, _proc_cache_js_1.cachedFor)('k5', 100000, build, now);
    strict_1.default.equal(v, 2);
    strict_1.default.equal(builds, 2);
});

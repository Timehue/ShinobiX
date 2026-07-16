"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const _storage_js_1 = require("./_storage.js");
(0, node_test_1.describe)('isolated QA memory KV', () => {
    (0, node_test_1.it)('preserves JSON isolation and supports NX, counters, patterns, and hashes', async () => {
        const kv = (0, _storage_js_1._makeMemoryKv)();
        const source = { nested: { value: 1 } };
        strict_1.default.equal(await kv.set('save:one', source, { nx: true }), 'OK');
        source.nested.value = 99;
        strict_1.default.deepEqual(await kv.get('save:one'), { nested: { value: 1 } });
        strict_1.default.equal(await kv.set('save:one', { overwritten: true }, { nx: true }), null);
        strict_1.default.equal(await kv.incr('counter'), 1);
        strict_1.default.equal(await kv.incr('counter'), 2);
        strict_1.default.deepEqual((await kv.keys('save:*')).sort(), ['save:one']);
        strict_1.default.deepEqual(await kv.mget('save:one', 'missing'), [{ nested: { value: 1 } }, null]);
        strict_1.default.equal(await kv.hset('registry', { one: 1, two: 2 }), 2);
        strict_1.default.equal(await kv.hset('registry', { two: 22, three: 3 }), 1);
        strict_1.default.deepEqual((await kv.hkeys('registry')).sort(), ['one', 'three', 'two']);
        strict_1.default.equal(await kv.hdel('registry', 'one', 'missing'), 1);
        strict_1.default.deepEqual(await kv.hgetall('registry'), { two: 22, three: 3 });
    });
    (0, node_test_1.it)('expires TTL entries and lets NX reclaim them', async () => {
        const kv = (0, _storage_js_1._makeMemoryKv)();
        const realNow = Date.now;
        let now = 1_000_000;
        Date.now = () => now;
        try {
            strict_1.default.equal(await kv.set('lease', 'first', { ex: 2, nx: true }), 'OK');
            now += 2_001;
            strict_1.default.equal(await kv.get('lease'), null);
            strict_1.default.equal(await kv.set('lease', 'second', { nx: true }), 'OK');
            strict_1.default.equal(await kv.get('lease'), 'second');
        }
        finally {
            Date.now = realNow;
        }
    });
});

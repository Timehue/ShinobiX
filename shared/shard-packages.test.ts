import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SHARD_PACKAGES,
    shardPackage,
    shardBonusPercent,
    shardPackageForProvider,
    PROVIDER_PACKAGE_IDS,
} from './shard-packages.js';

test('every package has a unique id, positive shards and a positive price', () => {
    const ids = new Set<string>();
    for (const pack of SHARD_PACKAGES) {
        assert.ok(!ids.has(pack.id), `duplicate package id ${pack.id}`);
        ids.add(pack.id);
        assert.ok(pack.shards > 0, `${pack.id} must credit shards`);
        assert.ok(pack.usd > 0, `${pack.id} must have a price`);
        assert.ok(Number.isInteger(pack.shards), `${pack.id} shards must be whole`);
    }
    assert.equal(ids.size, SHARD_PACKAGES.length);
});

test('tiers are ordered and never get worse value as they get bigger', () => {
    // A bigger tier that gave a worse rate would be a trap for the player.
    for (let i = 1; i < SHARD_PACKAGES.length; i += 1) {
        const prev = SHARD_PACKAGES[i - 1]!;
        const pack = SHARD_PACKAGES[i]!;
        assert.ok(pack.usd > prev.usd, `${pack.id} should cost more than ${prev.id}`);
        assert.ok(pack.shards > prev.shards, `${pack.id} should give more than ${prev.id}`);
        assert.ok(
            pack.shards / pack.usd >= prev.shards / prev.usd,
            `${pack.id} gives a worse shards-per-dollar rate than ${prev.id}`,
        );
    }
});

test('⛔ the advertised bonus never exceeds the value actually delivered', () => {
    // The regression this exists for: the original tier sheet advertised the
    // $4.99 tier as "10% EXTRA" when it really gave 6%. Overstating value on a
    // paid product is a false claim, so the number is derived and rounded DOWN.
    const base = SHARD_PACKAGES[0]!;
    const baseRate = base.shards / base.usd;
    for (const pack of SHARD_PACKAGES) {
        const claimed = shardBonusPercent(pack);
        const actual = ((pack.shards / pack.usd) / baseRate - 1) * 100;
        assert.ok(claimed <= actual + 1e-9, `${pack.id} claims ${claimed}% but delivers ${actual.toFixed(1)}%`);
        assert.ok(Number.isInteger(claimed), `${pack.id} bonus should be a whole percent`);
    }
});

test('the base tier advertises no bonus', () => {
    assert.equal(shardBonusPercent(SHARD_PACKAGES[0]!), 0);
});

test('unknown package ids resolve to null, never a default', () => {
    // Falling back to a default package would let a bad id mint shards.
    assert.equal(shardPackage('shards-155')?.shards, 155);
    assert.equal(shardPackage('shards-999999'), null);
    assert.equal(shardPackage(''), null);
    assert.equal(shardPackage('__proto__'), null);
});

test('provider lookup returns null while the id tables are unfilled', () => {
    // Until the dashboards are configured a rail simply cannot sell — which is
    // the safe failure. Taking money for a package the server cannot resolve
    // back to a shard amount is the outcome this prevents.
    assert.equal(shardPackageForProvider('tebex', 'anything'), null);
    assert.equal(shardPackageForProvider('play', 'anything'), null);
});

test('provider lookup resolves a configured id back to its package', () => {
    const table = PROVIDER_PACKAGE_IDS.tebex!;
    try {
        // Exercised with a temporary entry so the test still proves the mapping
        // works before the real dashboards exist.
        table['shards-155'] = 'test-pkg-150';
        assert.equal(shardPackageForProvider('tebex', 'test-pkg-150')?.shards, 155);
        assert.equal(shardPackageForProvider('tebex', 'test-pkg-151'), null);
    } finally {
        delete table['shards-155'];
    }
});

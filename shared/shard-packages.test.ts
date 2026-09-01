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

test('an unrecognised provider id resolves to null, never a default', () => {
    // A rail that cannot resolve an id simply cannot sell — the safe failure.
    // Taking money for a package the server cannot map back to a shard amount
    // is the outcome this prevents.
    assert.equal(shardPackageForProvider('tebex', 'anything'), null);
    assert.equal(shardPackageForProvider('tebex', ''), null);
    // Play has no products yet, so every id is unknown there.
    assert.equal(shardPackageForProvider('play', 'anything'), null);
});

test('⛔ each live Tebex id is paired with the tier the buyer paid for', () => {
    /*
     * THE PAIRING IS THE PAYOUT. The webhook resolves the id Tebex reports to a
     * row in the catalogue and credits THAT row's shards. A mis-filed id means
     * the customer is charged one tier and credited another — a $100 buyer
     * receiving 35 shards — and nothing else in the system would notice.
     *
     * The ids are not sequential with the tiers, so they cannot be checked by
     * eye. Read from the dashboard 2026-09-01; re-read the package pages before
     * changing any line here.
     */
    const LIVE: Record<string, number> = {
        '7651603': 35,
        '7651606': 155,
        '7651608': 420,
        '7651609': 900,
    };
    for (const [tebexId, shards] of Object.entries(LIVE)) {
        assert.equal(
            shardPackageForProvider('tebex', tebexId)?.shards, shards,
            `Tebex package ${tebexId} must credit ${shards} shards`,
        );
    }
    // Every tier sellable, and no two tiers sharing an id.
    const configured = Object.values(PROVIDER_PACKAGE_IDS.tebex ?? {});
    assert.equal(configured.length, SHARD_PACKAGES.length, 'every tier needs an id or it cannot be sold');
    assert.equal(new Set(configured).size, configured.length, 'two tiers share a Tebex id');
    // 7651601 is the SUBSCRIPTION; it must never map to a shard tier.
    assert.equal(shardPackageForProvider('tebex', '7651601'), null);
});

test('provider lookup resolves a configured id back to its package', () => {
    const table = PROVIDER_PACKAGE_IDS.tebex!;
    // ⛔ RESTORE, do not delete. This cleanup used `delete`, which was harmless
    // while the table was empty and destructive once it held real ids: it
    // stripped shards-155's mapping for every test that ran afterwards, so the
    // live tier would silently stop resolving mid-suite.
    const original = table['shards-155'];
    try {
        table['shards-155'] = 'test-pkg-150';
        assert.equal(shardPackageForProvider('tebex', 'test-pkg-150')?.shards, 155);
        assert.equal(shardPackageForProvider('tebex', 'test-pkg-151'), null);
    } finally {
        if (original === undefined) delete table['shards-155'];
        else table['shards-155'] = original;
    }
});

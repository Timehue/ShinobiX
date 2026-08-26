import assert from 'node:assert/strict';
import test from 'node:test';
import { sectorContractFor, contractSectorsForDay } from '../shared/sector-contracts.js';
import {
    NO_CONTRACT, contractClaimKey, contractProgressKey, sectorContractStatus,
} from './_sector-contracts.js';

const DAY = '2026-08-25';
const POSTED = contractSectorsForDay(DAY)[0];
const CONTRACT = sectorContractFor(POSTED, DAY)!;

test('an unposted sector has no contract and nothing is claimable', () => {
    assert.deepEqual(sectorContractStatus(null, 999, 0), NO_CONTRACT);
    assert.equal(NO_CONTRACT.claimable, false);
});

test('progress below the target is never claimable', () => {
    const status = sectorContractStatus(CONTRACT, CONTRACT.target - 1, 0);
    assert.equal(status.progress, CONTRACT.target - 1);
    assert.equal(status.claimed, false);
    assert.equal(status.claimable, false);
});

test('meeting the target makes it claimable exactly once', () => {
    const ready = sectorContractStatus(CONTRACT, CONTRACT.target, 0);
    assert.equal(ready.claimable, true);
    assert.equal(ready.claimed, false);

    // Once the claim key is written, no amount of further progress re-opens it.
    const paid = sectorContractStatus(CONTRACT, CONTRACT.target * 5, 1_700_000_000_000);
    assert.equal(paid.claimed, true);
    assert.equal(paid.claimable, false);
});

test('garbage progress and claim values degrade to zero, never to a payout', () => {
    for (const junk of [undefined, null, '', 'lots', Number.NaN, -50, {}, []]) {
        const status = sectorContractStatus(CONTRACT, junk, junk);
        assert.equal(status.progress >= 0, true, String(junk));
        assert.equal(status.claimable, false, `progress ${String(junk)} must not be claimable`);
    }
});

test('a claim timestamp that is any positive number counts as claimed', () => {
    assert.equal(sectorContractStatus(CONTRACT, CONTRACT.target, 1).claimed, true);
    assert.equal(sectorContractStatus(CONTRACT, CONTRACT.target, 0).claimed, false);
});

test('storage keys are namespaced per player, sector and day so they cannot collide', () => {
    assert.equal(contractProgressKey('Kaze', 12, DAY), `world:contract:Kaze:12:${DAY}`);
    assert.equal(contractClaimKey('Kaze', 12, DAY), `world:contract-claim:Kaze:12:${DAY}`);
    // Different day, different sector and different player must all separate.
    assert.notEqual(contractProgressKey('Kaze', 12, DAY), contractProgressKey('Kaze', 12, '2026-08-26'));
    assert.notEqual(contractProgressKey('Kaze', 12, DAY), contractProgressKey('Kaze', 13, DAY));
    assert.notEqual(contractProgressKey('Kaze', 12, DAY), contractProgressKey('Rin', 12, DAY));
    // The progress key must never equal the claim key for the same triple.
    assert.notEqual(contractProgressKey('Kaze', 12, DAY), contractClaimKey('Kaze', 12, DAY));
});

test('a night contract stops accepting work in daylight but keeps what it banked', () => {
    const NIGHT_DAY = '2026-08-26';
    const nightSector = contractSectorsForDay(NIGHT_DAY).find((s) => sectorContractFor(s, NIGHT_DAY)!.nightOnly);
    assert.ok(nightSector, 'the fixture day must post at least one night contract');
    const contract = sectorContractFor(nightSector, NIGHT_DAY)!;
    const noon = Date.UTC(2026, 7, 26, 12);
    const midnight = Date.UTC(2026, 7, 26, 23);

    assert.equal(sectorContractStatus(contract, 0, 0, noon).acceptingWork, false);
    assert.equal(sectorContractStatus(contract, 0, 0, midnight).acceptingWork, true);

    // Work banked at night stays claimable at noon — the window gates EARNING,
    // not collecting, so a player is never told to wake up to be paid.
    const banked = sectorContractStatus(contract, contract.target, 0, noon);
    assert.equal(banked.claimable, true);
    assert.equal(banked.acceptingWork, false);
});

test('an ordinary contract accepts work at every hour', () => {
    const DAY2 = '2026-08-26';
    const plain = contractSectorsForDay(DAY2).find((s) => !sectorContractFor(s, DAY2)!.nightOnly)!;
    const contract = sectorContractFor(plain, DAY2)!;
    for (const hour of [0, 6, 12, 18, 23]) {
        assert.equal(sectorContractStatus(contract, 0, 0, Date.UTC(2026, 7, 26, hour)).acceptingWork, true, `hour ${hour}`);
    }
});

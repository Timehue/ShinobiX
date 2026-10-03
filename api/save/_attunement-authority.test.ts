import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { buyHollowGateAttunement, HOLLOW_GATE_ATTUNEMENT_NODES } from '../hollow-gate/_attunement.js';
import { hollowGateDeathRetention } from '../hollow-gate/_ledger.js';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

let sanitizeCharacterSave: typeof import('./[name].js').sanitizeCharacterSave;
before(async () => {
    ({ sanitizeCharacterSave } = await import('./[name].js'));
});

const maxRanks = Object.fromEntries(Object.entries(HOLLOW_GATE_ATTUNEMENT_NODES).map(([id, node]) => [id, node.maxRank]));
const fullPrice = Object.values(HOLLOW_GATE_ATTUNEMENT_NODES).reduce((total, node) =>
    total + node.baseCost * node.maxRank * (node.maxRank + 1) / 2, 0);

test('generic saves cannot buy or revoke Hollow Gate attunements under any ledger rollout setting', () => {
    const previous = process.env.STRICT_RAW_SAVE_LEDGER;
    try {
        for (const flag of [undefined, '0', '1']) {
            if (flag === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
            else process.env.STRICT_RAW_SAVE_LEDGER = flag;
            const stored = { character: { hollowShards: 0, hollowGateAttunement: { cartographer: 1 } } };
            for (const requested of [maxRanks, {}, null]) {
                const result = sanitizeCharacterSave({ character: { hollowGateAttunement: requested } }, stored);
                assert.deepEqual((result.character as Record<string, unknown>).hollowGateAttunement, { cartographer: 1 }, `flag=${flag}`);
            }
            const unpaid = sanitizeCharacterSave({ character: { hollowGateAttunement: maxRanks } }, { character: { hollowShards: 0 } });
            assert.equal((unpaid.character as Record<string, unknown>).hollowGateAttunement, undefined);
            assert.equal(hollowGateDeathRetention(unpaid.character as Record<string, unknown>), 0.5);
        }
    } finally {
        if (previous === undefined) delete process.env.STRICT_RAW_SAVE_LEDGER;
        else process.env.STRICT_RAW_SAVE_LEDGER = previous;
    }
    assert.equal(fullPrice, 760, 'the rejected all-node grant would bypass 760 Hollow Shards');
});

test('a purchased attunement remains authoritative when the autosave echoes an old rank', () => {
    const purchased = buyHollowGateAttunement({ hollowShards: 120, hollowGateAttunement: {} }, 'extra-dive');
    assert.equal(purchased.ok, true);
    if (!purchased.ok) throw new Error('purchase failed');
    assert.equal(purchased.character.hollowShards, 0);
    const result = sanitizeCharacterSave({ character: { hollowGateAttunement: {} } }, { character: purchased.character });
    assert.deepEqual((result.character as Record<string, unknown>).hollowGateAttunement, { 'extra-dive': 1 });
});

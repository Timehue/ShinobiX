import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.SHINOBIX_QA_MEMORY_KV = '1';

/*
 * /api/village/war-structure refusal copy.
 *
 * The endpoint keeps `error` as the MACHINE CODE (callers and
 * village-stores-endpoints.test.ts key off it) and adds `message`, the sentence
 * the War Map and the Town Hall actually print. Before this, both screens
 * rendered the raw code, so a short treasury told a Kage "insufficient-seals".
 */

let structureUpgradeErrorMessage: typeof import('./war-structure.js').structureUpgradeErrorMessage;

before(async () => {
    ({ structureUpgradeErrorMessage } = await import('./war-structure.js'));
});

const CODES = ['insufficient-seals', 'insufficient-wr', 'materials-required', 'max-level', 'unknown-structure', 'not-per-war'];

describe('structureUpgradeErrorMessage', () => {
    it('humanises every refusal the handler can return', () => {
        assert.equal(structureUpgradeErrorMessage('insufficient-seals', { cost: 800 }), 'The treasury is short — 800 Honor Seals needed.');
        assert.equal(structureUpgradeErrorMessage('insufficient-wr', { cost: 250 }), 'The war pool is short — 250 War Resources needed.');
        assert.equal(structureUpgradeErrorMessage('max-level', { structure: 'watchtower' }), 'Watchtower is already at its maximum level.');
        assert.equal(
            structureUpgradeErrorMessage('materials-required', { need: 400, have: 399 }),
            'The stores are short — 400 materials needed, and 399 are stocked.',
        );
    });

    it('never leaks a machine code into the sentence', () => {
        for (const code of [...CODES, 'something-nobody-anticipated']) {
            const msg = structureUpgradeErrorMessage(code, { structure: 'supplyDepot', cost: 1200, need: 400, have: 10 });
            assert.doesNotMatch(msg, /-/, `"${msg}" still reads like a code`);
            assert.match(msg, /\.$/, `"${msg}" is not a sentence`);
        }
    });

    it('uses the canonical stock names — never "material points", "craft points", "pts" or "supplies"', () => {
        for (const code of CODES) {
            const msg = structureUpgradeErrorMessage(code, { structure: 'treasuryVault', cost: 5, need: 5, have: 0 });
            assert.doesNotMatch(msg, /material points|craft points|\bpts\b|supplies/i, msg);
        }
    });

    it('names the structure when it knows it and stays generic when it does not', () => {
        assert.equal(structureUpgradeErrorMessage('max-level', { structure: 'warAcademy' }), 'War Academy is already at its maximum level.');
        assert.equal(structureUpgradeErrorMessage('max-level', {}), 'That structure is already at its maximum level.');
        assert.equal(structureUpgradeErrorMessage('max-level', { structure: 'not-a-structure' }), 'That structure is already at its maximum level.');
    });

    it('floors junk amounts to a readable zero rather than "NaN"', () => {
        assert.equal(structureUpgradeErrorMessage('insufficient-seals', {}), 'The treasury is short — 0 Honor Seals needed.');
        assert.equal(structureUpgradeErrorMessage('insufficient-wr', { cost: -12 }), 'The war pool is short — 0 War Resources needed.');
        assert.doesNotMatch(structureUpgradeErrorMessage('materials-required', { need: Number.NaN, have: undefined }), /NaN|undefined/);
    });

    it('groups thousands so a 2,400-material bill is readable', () => {
        assert.match(structureUpgradeErrorMessage('materials-required', { need: 2400, have: 1100 }), /2,400 materials needed, and 1,100 are stocked/);
    });
});

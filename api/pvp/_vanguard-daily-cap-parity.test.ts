import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DAILY_SEAL_CAP, PER_TARGET_DAILY_CAP } from './_vanguard-rewards.js';
import {
    VANGUARD_DAILY_SEAL_CAP as CLIENT_CONSTANT_CAP,
    VANGUARD_PER_TARGET_DAILY_CAP as CLIENT_CONSTANT_PER_TARGET,
} from '../../shinobij.client/src/constants/profession.js';
import { VANGUARD_DAILY_SEAL_CAP as CLIENT_LOGIC_CAP } from '../../shinobij.client/src/professionLogic.js';
import { PROFESSION_INFO } from '../../shinobij.client/src/data/professions.js';

// The Vanguard Hub meter, the profession overview copy and the client reward
// projection all read the client constant, while the server pays and caps from
// DAILY_SEAL_CAP. They drifted once (server 150, client 50), so a Vanguard
// saw "80 / 50" while the server was still paying seals.
describe('Vanguard daily Honor Seal cap: client display matches the server', () => {
    it('the client constants equal the server caps', () => {
        assert.equal(CLIENT_CONSTANT_CAP, DAILY_SEAL_CAP);
        assert.equal(CLIENT_LOGIC_CAP, DAILY_SEAL_CAP);
        assert.equal(CLIENT_CONSTANT_PER_TARGET, PER_TARGET_DAILY_CAP);
    });

    it('the profession overview quotes the real daily cap', () => {
        const vanguard = PROFESSION_INFO.find((info) => info.id === 'vanguard');
        const rankOne = vanguard?.rankHighlights.find((entry) => entry.rank === 'Rank 1');
        assert.ok(rankOne, 'the Vanguard Rank 1 highlight exists');
        assert.match(rankOne.perk, new RegExp(`daily seal cap ${DAILY_SEAL_CAP}\\b`));
    });
});
